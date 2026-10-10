// A pause is the end of an answer, and two events say it between them: `classic.Stop` says the answer is over, `turn.complete` says how the
// turn ended. The host sends the stop first (docs/host-behaviour.md, Events and their order), and either order is taken. This is the one place that knows
// the pairing, so that the hooks only record what they saw and the judge asks once.

// What `classic.Stop` brings that the mod reads.
export type Stop = { background_tasks?: { status: string }[]; session_crons?: { recurring: boolean }[] }

export type TurnEnd = 'answer' | 'aborted' | 'error' | 'refusal'

export type Pairing = {
  // A stop that has not been judged. The stop does not say how the turn ended, so it waits for `turn.complete`, which does.
  stop: Stop | undefined
  // How the main loop's last turn ended. Kept after the judgment until the next turn begins, so a second stop in the same turn is judged
  // against it at once. Only an answer may trigger.
  end: TurnEnd | undefined
}

export const freshPairing = (): Pairing => ({ stop: undefined, end: undefined })

export const turnStarted = (p: Pairing) => {
  p.stop = undefined
  p.end = undefined
}

export const stopSeen = (p: Pairing, stop: Stop) => {
  p.stop = stop
}

export const endSeen = (p: Pairing, end: TurnEnd) => {
  p.end = end
}

// The stop and its turn's end once both are in, and the stop is spent; until then, what is still missing.
export const judgeable = (p: Pairing): { stop: Stop; end: TurnEnd } | { waitingFor: 'the stop' | 'the end of the turn' } => {
  if (p.stop === undefined) return { waitingFor: 'the stop' }
  if (p.end === undefined) return { waitingFor: 'the end of the turn' }
  const stop = p.stop
  p.stop = undefined
  return { stop, end: p.end }
}
