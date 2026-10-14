// What the mod keeps between one stop and the next. One object, made afresh each time the plugin loads: a reload (a changed setting, a
// hot reload) starts from nothing, and what must survive a reload does not belong here.

import type { CompactCheck } from './compact-check'
import type { Countdown } from './countdown'
import type { Asap, Attempt, Later } from './decide'
import type { Lifetime } from './idle-handoff'
import type { LevelMemo } from './log'
import { freshPairing, type Pairing } from './pairing'

// How the awaited turn of the handoff command ended: with its answer, or without one and why.
export type Ended = { answer: string; rejected?: true } | { failure: string; cancelled?: true }

// A handoff written in a pause and not yet handed over; in a dry run only the time it would have been written.
// `since` is the end of the answer the pause began after.
export type IdlePrepared = { kind: 'real'; text: string; file?: string; since: number } | { kind: 'simulated'; since: number }

// A handover runs, the handoff after a long pause is being written, or the message that came back after it is judged: either way the
// session is the mod's for the moment.
export const underWay = (state: { handingOver: boolean; preparing: boolean; returning: boolean }): boolean =>
  state.handingOver || state.preparing || state.returning

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
  // The next handover moved back by `/sweet-spot later`, until it is spent or the context shrinks below where it was asked. Kept here
  // only: a reload forgets it, like a change in /config.
  later: Later | undefined
  // A handover asked for with `/sweet-spot asap`, until a handover begins (spent, whether it goes through or not). Kept here only, like `later`.
  asap: Asap | undefined
  // What the last stop of the main loop said about background tasks and timers, which nothing else reads: `asap` at rest judges from it. It goes
  // at the start of a turn and at the end of the session, when it no longer holds, and then what runs is not known.
  lastStop: { backgroundTasks: number; oneShotTimers: number } | undefined
  // The step that starts the handover of `asap` at rest is planned and has not begun; a second `asap` must not plan another.
  asapScheduled: boolean
  // A redelivery is under way: a second one would submit the message twice.
  redelivering: boolean
  // From the start of a turn of the main loop to its end, however it ended. The command runs at once while an answer runs (it is
  // `immediate`), and a redelivery, which submits a message, waits for it.
  answerRunning: boolean
  // Set once a handoff has succeeded: the context it left, and how many pauses of the fresh session were logged against it. Only a debug line reads it.
  afterHandoff: { before: number; pauses: number } | undefined
  // Whether the last compact was enough, found out at the first tool call or pause after it (`compact-check.ts`). Not kept across a reload, like the rest: at worst
  // one compact more follows.
  compactCheck: CompactCheck
  // The countdown before an automatic handover, while it runs. A reload drops it, and with it the handover it would have started.
  countdown: Countdown | undefined
  // The pauses past the threshold where no handover began, a draft waited or the countdown begun there ended without one, and the context
  // at the first of them. Two give a countdown that typing does not stop. Typing does not end it: only a handover that began, a later
  // handover asked for (the command or Not now) and a context that shrank below `from`.
  deferred: { pauses: number; from: number } | undefined
  // The session `/clear` made for a handoff of the mod. Unlike `pendingIn` it stays once the handoff is in: the first request of that session
  // is the handoff, which is not what the project starts with, and must not become its baseline.
  deliveredInto: string | undefined
  // True while the handoff after a long pause is written. It holds what `handingOver` holds (see `underWay`): the mod's own work is no pause
  // and no turn of the person's.
  preparing: boolean
  // True from the message that came back after the handoff was written, which takes it at once, until that message is judged: a second
  // message meanwhile is held and never sees the handoff. A switch to a fresh session hands on to `handingOver`.
  returning: boolean
  // What the handoff after a long pause knows of the session (idle-handoff.ts). `touch` is when the main loop last read or wrote the cache:
  // the start of its last request. `read` is due at the first turn of every session, since a /clear does not reload the mod but ends what
  // was known. `fresh`: the session began with no conversation (a start or a /clear), so its first request is the project's baseline.
  idle: {
    // The step that writes the handoff, planned at the end of an answer; and the handoff written, until the person comes back or the pause ends.
    timer: { cancel: () => void } | undefined
    prepared: IdlePrepared | undefined
    // The pause ended while the handoff was being written (a turn not the command's, a compact, a change of model): why, so that the handoff
    // that comes is dropped.
    endedWhilePreparing: string | undefined
    // The step that shows the band once the handoff written has gone cold, and whether it shows.
    coldTimer: { cancel: () => void } | undefined
    coldShown: boolean
    // After a warm return the first request of the next turn shows whether the handoff written really kept the cache: it is checked
    // against the context at the return (`checkAgainst`), not against the request, which may carry a long message of its own. One
    // that missed it means it did not: from then on in the session (`doubted`) writing the handoff no longer moves the touch.
    checkAgainst: number | undefined
    doubted: boolean
    touch: number | undefined
    lifetime: Lifetime | undefined
    baseline: number | undefined
    read: boolean
    fresh: boolean
    baselineDue: boolean
    transcript: string | undefined
    unreadSaid: boolean
  }
}

export const freshIdle = (): State['idle'] => ({
  timer: undefined,
  prepared: undefined,
  endedWhilePreparing: undefined,
  coldTimer: undefined,
  coldShown: false,
  checkAgainst: undefined,
  doubted: false,
  touch: undefined,
  lifetime: undefined,
  baseline: undefined,
  read: true,
  fresh: false,
  baselineDue: false,
  transcript: undefined,
  unreadSaid: false,
})

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
  later: undefined,
  asap: undefined,
  lastStop: undefined,
  asapScheduled: false,
  redelivering: false,
  answerRunning: false,
  afterHandoff: undefined,
  compactCheck: undefined,
  countdown: undefined,
  deferred: undefined,
  deliveredInto: undefined,
  preparing: false,
  returning: false,
  idle: freshIdle(),
  logLevel: 'off',
  badLogLevel: undefined,
})
