// The last exchanges: the user's last requests, each with Claude's final answer to it, recorded from the hooks as the session goes and put word
// for word into the fresh session's first message, after the handoff. No host here: `register.tsx` makes the calls and hands the results in.
// Kept in memory only, for one session: a reload, a restart or `/resume` starts empty, and the prompt's own point about the end of the
// conversation still carries it then.

import type { TurnEnd } from './pairing'

// The kinds of origin that are the user's own: Enter at the terminal (typed or queued) and Remote Control. Everything else is not a request:
// a plugin's message (among them the previous handoff and the user's handoff command), a background task's notice, a schedule, a peer.
export const USER_ORIGINS: readonly string[] = ['composer', 'bridge']

// Read through these, not off the event: the types of Claude Code 2.1.296, which the CI still checks against, have no `agentId` on
// `turn.start` (a subagent's turn) and no `isMeta` on `prompt.submit` (a prompt the host made itself).
export const ofMainLoop = (e: { turnId: string; agentId?: string }): boolean => e.agentId === undefined
export const byUser = (e: { origin: { kind: string }; isMeta?: boolean }): boolean => USER_ORIGINS.includes(e.origin.kind) && e.isMeta !== true

// `text` is how it shows in the attachment; `match` the text as submitted, which the `turn.start` of a turn it waited for carries again.
// `typedOver`: submitted over a running turn; `atRest`: submitted with none running, so it started the turn it belongs to.
export type Request = { text: string; match: string; typedOver?: true; atRest?: true }
export type Exchange = { turnId: string; requests: Request[]; answer: string; ended: TurnEnd }

// `running` is the turn of the main loop under way and `open` the requests that belong to it; `next` the requests whose turn had already
// ended when they were recorded, for the turn that starts next. `lastEnded` is the turn that ended last, exchange or not; `startText` the
// text the running turn started with, and `before` the turn that had ended last when it started.
export type Recorded = {
  session: string | undefined
  exchanges: Exchange[]
  running: string | undefined
  open: Request[]
  next: Request[]
  lastEnded: string | undefined
  startText: string | undefined
  before: string | undefined
}

export const freshRecorded = (): Recorded => ({
  session: undefined,
  exchanges: [],
  running: undefined,
  open: [],
  next: [],
  lastEnded: undefined,
  startText: undefined,
  before: undefined,
})

// A session other than the one recorded (a /clear, /resume, the fresh session after a handoff) starts empty. The turn under way stays: it
// is the new session's. A session id that could not be read changes nothing.
export const inSession = (r: Recorded, session: string | undefined): Recorded =>
  session === undefined || session === r.session ? r : { ...restarted(r), session }

// After the mod's own /clear: empty, with the turn that may already run in the fresh session.
export const restarted = (r: Recorded): Recorded => ({ ...freshRecorded(), running: r.running, open: r.open })

type Submitted = { text: string; command?: { name: string; args: string }; attachments?: readonly { type: string }[] }

// A slash command as typed, not as the skill it expands to; an attachment as a line of its kind, never its name or bytes.
export const requestOf = (e: Submitted): string => {
  const head = e.command === undefined ? e.text : `/${e.command.name}${e.command.args === '' ? '' : ` ${e.command.args}`}`
  return [head, ...(e.attachments ?? []).map(a => `[${a.type}]`)].join('\n')
}

// Recorded after `next(e)`, which resolves once the request's turn has started, or once it is queued over the running one
// (docs/host-behaviour.md, Requests and turns). With no turn id it belongs to the turn under way; with none under way it started no turn
// and is dropped (not seen: a local command raises no submit). With the id of the running turn it belongs there for now; with the id of a
// turn that has ended, to the next.
export const submitted = (r: Recorded, request: Request, turnId: string | undefined): Recorded => {
  if (turnId === undefined) return r.running === undefined ? r : { ...r, open: [...r.open, { ...request, atRest: true }] }
  const over = { ...request, typedOver: true as const }
  return turnId === r.running ? { ...r, open: [...r.open, over] } : { ...r, next: [...r.next, over] }
}

export const started = (r: Recorded, turnId: string, text: string): Recorded => ({
  ...r,
  running: turnId,
  open: r.next,
  next: [],
  startText: text,
  before: r.lastEnded,
})

// A turn of the main loop with at least one request becomes an exchange; the attachment shows its answer only when it ended in one. `keep`
// is at least 1: with `last_exchanges` 0 nothing is recorded at all.
//
// A request typed over a turn without a tool call waits for that turn to end and starts the next with its own text (measured). So a turn
// that started with the text of a request typed over the turn that ended just before it, and that holds no request of its own typed at
// rest, takes that request, and any after it, from the exchange of the turn before; an exchange left with no request falls away. Decided
// here and not at the start: the same text typed again at rest starts a turn with that text too, and only its request shows it.
// A slash command starts its turn with the expanded text and stays.
export const ended = (r: Recorded, turnId: string, reason: TurnEnd, answer: string, keep: number): Recorded => {
  if (turnId !== r.running) return r
  let exchanges = r.exchanges
  let open = r.open
  const last = exchanges.at(-1)
  const at =
    last !== undefined && last.turnId === r.before && !open.some(q => q.atRest) ? last.requests.findIndex(q => q.typedOver && q.match === r.startText) : -1
  if (last !== undefined && at >= 0) {
    const stays = last.requests.slice(0, at)
    exchanges = stays.length === 0 ? exchanges.slice(0, -1) : [...exchanges.slice(0, -1), { ...last, requests: stays }]
    open = [...last.requests.slice(at), ...open]
  }
  if (open.length > 0) exchanges = [...exchanges, { turnId, requests: open, answer, ended: reason }].slice(-keep)
  return { ...r, exchanges, running: undefined, open: [], lastEnded: turnId, startText: undefined, before: undefined }
}

// Each text whole up to `LONGEST` characters; a longer one keeps its first and last `KEPT` and says how many it left out, so a shortened text
// is always shorter than it was. 4,000 left 323 of 327 answers whole in the 40 latest transcripts of this project (median 1,102); at most
// five exchanges of two texts keep the attachment near 36,000 characters, far below what a fresh session starts with.
const LONGEST = 4_000
const KEPT = 1_750

const NO_ANSWER: Record<Exclude<TurnEnd, 'answer'>, string> = {
  aborted: 'The turn was interrupted.',
  refusal: 'The model refused.',
  error: 'The turn ended with an error.',
}

const INTRO =
  'The last exchanges with the user in the previous session, word for word, oldest first, for reference only. The handoff above says what to do next.'
const OUTRO = 'End of the verbatim exchanges.'

// A closing tag of the attachment inside a text is made visibly harmless, in any case and with spaces, so no text can end its part early.
const harmless = (text: string) => text.replace(/<\/\s*(previous-exchange|request|answer|no-answer)\s*>/gi, '<\\/$1>')

// Counted in code points, so a character outside the basic plane is never cut in two.
const shortened = (text: string): { text: string; cut: boolean } => {
  const chars = Array.from(text)
  if (chars.length <= LONGEST) return { text, cut: false }
  const left = chars.length - 2 * KEPT
  return { text: `${chars.slice(0, KEPT).join('')}\n[… ${left} characters left out …]\n${chars.slice(-KEPT).join('')}`, cut: true }
}

// The attachment with how many texts were shortened, for the diagnostic line; empty when there is no exchange.
export const attachment = (exchanges: readonly Exchange[]): { text: string; shortened: number } => {
  if (exchanges.length === 0) return { text: '', shortened: 0 }
  let cuts = 0
  const part = (raw: string) => {
    const s = shortened(raw)
    if (s.cut) cuts++
    return harmless(s.text)
  }
  const blocks = exchanges.map(x => {
    const request = `<request>\n${part(x.requests.map(q => q.text).join('\n\n'))}\n</request>`
    const answer = x.ended === 'answer' ? `<answer>\n${part(x.answer)}\n</answer>` : `<no-answer>${NO_ANSWER[x.ended]}</no-answer>`
    return `<previous-exchange>\n${request}\n${answer}\n</previous-exchange>`
  })
  return { text: [INTRO, ...blocks, OUTRO].join('\n'), shortened: cuts }
}
