// What the mod keeps between one stop and the next. One object, made afresh each time the plugin loads: a reload (a changed setting, a
// hot reload) starts from nothing, and what must survive a reload does not belong here.

import type { CompactCheck } from './compact-check'
import type { Attempt } from './decide'
import type { LevelMemo } from './log'
import { freshPairing, type Pairing } from './pairing'

// How the awaited turn of the handoff command ended: with its answer, or without one and why.
export type Ended = { answer: string; rejected?: true } | { failure: string; cancelled?: true }

// The log level of the latest read (`LevelMemo`), which every handler that logs makes at its start; a line written outside a handler, as
// from a timer, goes by it.
export type State = LevelMemo & {
  // Not kept across a reload, on purpose: a reload is the person changing a setting or the developer reloading the mod, and an unattended
  // session cannot cause one, so the gap still limits every loop that can run without anyone there. A person who reloads after a failed
  // handoff wants the next try at once, which a kept record would hold back for minutes.
  // `turns` is the user's prompt count of the transcript, which a /clear starts over (docs/host-behaviour.md, `/clear` and the session).
  // `decide` ends the gap by minutes as well as by turns, so a count that fell cannot hold the lock for good.
  lastAttempt: Attempt | undefined
  // The stop of the main loop and the end of its turn, which are judged together.
  pairing: Pairing
  // What the stop last said, so that a long wait or a repeated failure is said once and not at every stop: the reason of a postponement, or
  // the line of a failure to check. Cleared by anything else the stop says (or by nothing to say), so that what returns is said again.
  said: string | undefined
  // The message about invalid settings and the command are introduced once per load, whether the load came with a session start or into a session that was
  // already running.
  introduced: boolean
  // True from the decision to hand over until the handoff has succeeded or failed. The command's own turn ends in a stop of its own, which
  // is no pause to act on (nor to report as postponed), whatever the gap says.
  handingOver: boolean
  // Set while the end of the command's turn is awaited; `own` is the first turn that starts after the wait began: the command's.
  // `rejected`: the user declined a permission in that turn (Esc or "No"), seen by the `tool.call` hook.
  turnWait: { own: string | undefined; rejected?: true; end: (result: Ended) => void } | undefined
  // What the person typed while the handoff ran, in order, and has not been put in yet: what went into the first message (or the pending
  // one) is taken out.
  held: string[]
  // The store key of the first message that has not reached the fresh session. Kept here as well as in the store so that a redelivery only ever
  // touches this session's own message and never one that another session left behind.
  pending: string | undefined
  // The session `/clear` made, where that pending message belongs: `redeliver` submits it nowhere else. Unset where it could not be read, and for
  // typing that was parked without a `/clear`.
  pendingIn: string | undefined
  // A redelivery is under way: a second one would submit the message twice.
  redelivering: boolean
  // Set once a handoff has succeeded: the context it left, and how many pauses of the fresh session were logged against it. Only a debug line reads it.
  afterHandoff: { before: number; pauses: number } | undefined
  // Whether the last compact was enough, found out at the pauses after it (`compact-check.ts`). Not kept across a reload, like the rest: at worst
  // one compact more follows.
  compactCheck: CompactCheck
}

export const freshState = (): State => ({
  lastAttempt: undefined,
  pairing: freshPairing(),
  said: undefined,
  introduced: false,
  handingOver: false,
  turnWait: undefined,
  held: [],
  pending: undefined,
  pendingIn: undefined,
  redelivering: false,
  afterHandoff: undefined,
  compactCheck: undefined,
  logLevel: 'off',
  badLogLevel: undefined,
})
