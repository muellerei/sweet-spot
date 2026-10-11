// The countdown as it runs: it begins at a pause, ticks the band, and runs out into the handover, unless "Not now" moves the handover
// back first. The countdown lives in the mod's state, not in the band, which only draws it.

import { deadlineOf, isLate, secondsLeft, type Countdown, type Start } from './countdown'
import type { Decision, Snapshot } from './decide'
import type { Level } from './log'
import { decidedOf } from './report'
import type { State } from './state'

// What the countdown asks of the session. As with `Io` in `relay.ts`, the host follows `$` only into functions of the file that declares
// `register`, so the calls on `$` are made there and this module gets them as functions.
export type CountdownIo = {
  now: () => Promise<number>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  // The tick that redraws the band; the deadline does not hang on it.
  every: (ms: number, fn: () => void) => { cancel: () => void }
  surfaces: () => Promise<readonly string[]>
  // What the prompt holds.
  prompt: () => Promise<string>
  // Draws the band again.
  redraw: () => void
  toast: (text: string) => void
  log: (level: Exclude<Level, 'off'>, text: string) => void
}

// What the command or a press of "Not now" answers, and the diagnostic lines about it, which the handler writes after its read of the log
// level. A line never holds what was typed.
export type Answer = { text: string; lines?: [Exclude<Level, 'off'>, string][] }

// The band is drawn on these surfaces only; a session with none of them (VS Code, mobile, a headless run) would count down unseen.
const DRAWN_ON = ['terminal', 'desktop']

const TICK_MS = 1000

// What the end of a countdown needs: the session read again for a fresh judgment (all of the snapshot but the time, which the end reads
// last), the judgment, the handover it carries out, with the time and the turn count it was judged at, and the message for a handover
// postponed, said as at a pause.
export type Expiry = {
  look: () => Promise<Omit<Snapshot, 'now'>>
  judge: (snapshot: Snapshot) => Decision
  carry: (decision: Countdown['decision'], now: number, turns: number) => void
  postpone: (decision: Extract<Decision, { kind: 'defer' }>) => void
}

// Begins a countdown of `seconds` that ends in `expiry`. False where nobody would see the band: the caller hands over at once, as without a
// countdown. Where the surfaces are is read at each start, not once per session.
//
// The countdown with the button does not begin over a draft in the prompt: the handover waits for the next pause. Such a pause counts as
// deferred, and so does one whose countdown begins, until a handover begins; two of them give the countdown that typing does not stop
// (`kindAt`), so that whoever types at every pause is not pushed to the emergency brake, which does not wait for running work. That one and
// the countdown at the brake hand over with a draft, which stays in the prompt.
//
// A pause while a countdown runs (a second stop of the same answer, with no turn between) leaves it as it is: begun again, its deadline
// would move back at each such stop, and its end judges afresh anyway.
export const begin = async (io: CountdownIo, state: State, seconds: number, start: Start, expiry: Expiry): Promise<boolean> => {
  if (state.countdown !== undefined) {
    io.log('debug', 'countdown: runs already')
    return true
  }
  const surfaces = await io.surfaces()
  if (!surfaces.some(s => DRAWN_ON.includes(s))) {
    io.log('debug', 'countdown: none, no screen draws the band')
    return false
  }
  const draft = start.kind === 'button' && (await io.prompt()).trim() !== ''
  const now = await io.now()
  // Begun meanwhile by a second stop, which read the session after this one: that one stands.
  if (state.countdown !== undefined) return true
  const before = state.deferred?.pauses ?? 0
  state.deferred = { pauses: before + 1, from: state.deferred?.from ?? start.decision.tokens }
  if (draft) {
    io.log('debug', `countdown: none, a draft waits in the prompt, deferred pauses ${before}`)
    return true
  }
  const deadline = deadlineOf(now, seconds)
  let timers: { cancel: () => void }[] = []
  const countdown: Countdown = {
    ...start,
    deadline,
    shown: secondsLeft(deadline, now),
    survey: false,
    remaining: undefined,
    stop: () => {
      timers.forEach(t => t.cancel())
      timers = []
    },
    run: from => {
      timers = [
        io.after(Math.max(0, countdown.deadline - from), () => void runOut(io, state, countdown, expiry)),
        io.every(TICK_MS, () => void tick(io, state, countdown)),
      ]
    },
  }
  state.countdown = countdown
  countdown.run(now)
  io.log('info', `countdown: starts, ${seconds} s, method ${countdown.method}, kind ${countdown.kind}, deferred pauses ${before}`)
  // The announcement at the brake comes once: it spends the later handover as it begins, and if it ends without a handover the next pause
  // at the brake hands over at once.
  if (countdown.kind === 'brake' && state.later !== undefined) {
    state.later = undefined
    io.log('debug', 'later: spent by the countdown at the emergency brake')
  }
  io.redraw()
  return true
}

// Why a countdown ended without a handover: typing (`edit`), a submit, a turn, the command `later` or `asap`, the end of the session, a
// compact the mod did not start, text in the prompt when it ran out (`prompt`), or a clock that ran out long past the deadline (`late`).
export type EndReason = 'edit' | 'submit' | 'turn' | 'command' | 'session' | 'compact' | 'prompt' | 'late'

// The diagnostic line for it, which a handler writes after its read of the log level.
export const endedLine = (reason: EndReason) => `countdown: ended, ${reason}`

// Ends the running countdown without a handover and takes the band down; false when none runs. Synchronous, so that a handler ends it
// before its first wait: the end of the countdown checks after each of its own waits that it still runs.
export const end = (io: CountdownIo, state: State): boolean => {
  const countdown = state.countdown
  if (countdown === undefined) return false
  countdown.stop()
  state.countdown = undefined
  io.redraw()
  return true
}

// A survey came up in the band or went, which only the drawing sees (`hasSurvey`). Each draw reports it and only a change is taken up: a
// change redraws, which a report that changes nothing must not do, and the band draws at every tick. It writes the mod's own state, not
// `$.state`, which the host refuses while a render hook draws, and does not wait: the clock is read afterwards, in `settle`.
//
// A survey holds the countdown: no time counts while it shows, and when it goes the countdown goes on with the time it had left. The band
// yields to it meanwhile, so the button is gone and its key no press: it is typed, as any key.
export const surveyed = (io: CountdownIo, state: State, survey: boolean): void => {
  const countdown = state.countdown
  if (countdown === undefined || countdown.survey === survey) return
  countdown.survey = survey
  void settle(io, state, countdown)
}

// Brings the countdown in line with the survey, whatever else came first: a survey that went before its clock was read leaves the
// countdown running as it was. A clock that cannot be read ends it, as at the end of a countdown, rather than leave one that counts beneath
// a survey or one held for good.
const settle = async (io: CountdownIo, state: State, countdown: Countdown) => {
  let now: number
  try {
    now = await io.now()
  } catch {
    if (state.countdown !== countdown) return
    end(io, state)
    io.log('warn', 'countdown: could not read the clock at a survey')
    return
  }
  if (state.countdown !== countdown) return
  if (countdown.survey && countdown.remaining === undefined) {
    countdown.stop()
    countdown.remaining = Math.max(0, countdown.deadline - now)
    io.log('debug', `countdown: held, survey, ${secondsLeft(countdown.deadline, now)} s left`)
    io.redraw()
  } else if (!countdown.survey && countdown.remaining !== undefined) {
    countdown.deadline = now + countdown.remaining
    countdown.remaining = undefined
    countdown.shown = secondsLeft(countdown.deadline, now)
    countdown.run(now)
    io.log('debug', `countdown: goes on, survey gone, ${countdown.shown} s left`)
    io.redraw()
  }
}

// Each act checks after its wait that the countdown it belongs to still runs: one that ended or was replaced meanwhile is left alone.
const tick = async (io: CountdownIo, state: State, countdown: Countdown) => {
  const now = await io.now()
  if (state.countdown !== countdown) return
  countdown.shown = secondsLeft(countdown.deadline, now)
  io.redraw()
}

// The end is not one step: it waits on the prompt, the session and the clock, and anything that ends the countdown meanwhile (typing, a
// submit, a turn, `later`, `asap`) ends it synchronously, before its own first wait. So the check that this countdown still runs comes after the
// last wait, and the handover is set going in the same step (`carry` sets `handingOver`); a countdown gone by then is left alone.
//
// A survey that came up meanwhile holds the countdown here as well: it is left as it is, and its deadline, by then reached, runs out again
// when the survey goes.
const runOut = async (io: CountdownIo, state: State, countdown: Countdown, expiry: Expiry) => {
  const stands = () => state.countdown === countdown && !countdown.survey
  let read: { draft: string; seen: Omit<Snapshot, 'now'>; now: number }
  try {
    // The countdown with the button began with an empty prompt: text there now came by a way that raises no edit (the history, Tab on a
    // suggestion, another mod's `$.prompt.fill`). The other two hand over with a draft, which stays in the prompt.
    const draft = countdown.kind === 'button' ? await io.prompt() : ''
    const seen = await expiry.look()
    read = { draft, seen, now: await io.now() }
  } catch {
    if (!stands()) return
    end(io, state)
    io.log('warn', 'countdown: could not read the session when it ran out')
    return
  }
  if (!stands()) return
  end(io, state)
  const { draft, seen, now } = read
  const reason = draft.trim() !== '' ? 'prompt' : isLate(countdown.deadline, now) ? 'late' : undefined
  if (reason !== undefined) {
    io.log('debug', endedLine(reason))
    return
  }
  // Judged afresh: the context may no longer be past the threshold, or a subagent may run (one past the brake hands over all the same, as
  // at a pause). Background tasks and one-shot timers are not read again: the stop that ended the answer reported them, and they change
  // only in a turn, which ends the countdown. A turn holds the handover at any countdown, also the one at the brake: none can go in the
  // middle of one. Its start ends the countdown, but a turn that started while the countdown began, before there was one to end, still runs.
  const judged = expiry.judge({ ...seen, now })
  const decision =
    judged.kind !== 'none' && judged.kind !== 'defer' && state.answerRunning
      ? { kind: 'defer' as const, reason: 'turn' as const, tokens: judged.tokens }
      : judged
  if (decision.kind === 'none' || decision.kind === 'defer') {
    io.log('debug', `countdown: ran out, ${decidedOf(decision)}`)
    if (decision.kind === 'defer') expiry.postpone(decision)
    return
  }
  io.log('info', 'countdown: ran out')
  expiry.carry(decision, now, seen.turns)
}

// "Not now": ends the countdown and moves the handover back as `later` with no number does, through `moveBack`, the command's own path,
// and answers as it does, in a toast only: nothing goes to the transcript. A press with no countdown running counts for nothing, except
// during a handover: the digit comes as an edit about 0.4 s before its press, and a countdown that ran out in between has started one. That
// press is answered as `later` is then.
export const press = async (io: CountdownIo, state: State, moveBack: () => Promise<Answer>): Promise<NonNullable<Answer['lines']>> => {
  const ended = end(io, state)
  if (!ended && !state.handingOver) return []
  const answer = await moveBack()
  io.toast(answer.text)
  const lines = answer.lines ?? []
  return ended ? [['debug', 'countdown: moved back by Not now'], ...lines] : lines
}
