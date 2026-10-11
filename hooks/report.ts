// The host puts "sweet-spot:" in front of a log line and of what the command returns itself, so none of these lines starts with the name. The hold's own lines carry it; `hold.ts` says why.
// What the mod says about a decision. Every line names the context size: a person who sees "postponed" wants to know how close the limit is.

import type { Method } from './config'
import type { BusyReason, DeferReason, Decision } from './decide'

const BUSY: Record<BusyReason, string> = {
  subagent: 'a subagent is running',
  'background-task': 'a background task is running',
  'one-shot-timer': 'a timer that fires once is set',
}

const DEFERRED: Record<DeferReason, string> = { ...BUSY, 'min-gap': 'the minimum gap since the last attempt has not passed', turn: 'an answer is running' }

// `none` has nothing to say and is not asked. `method` is the way that is tried first: a compact is not a handoff, and the line says which.
export const reportOf = (decision: Exclude<Decision, { kind: 'none' }>, method: Method): string => {
  const compact = method === 'builtin-compact'
  switch (decision.kind) {
    case 'defer':
      return `${compact ? 'compact' : 'handoff'} postponed, ${DEFERRED[decision.reason]}, context ${decision.tokens} tokens`
    case 'dry-run':
      return `dry run, would ${compact ? 'compact' : 'hand over'} now, context ${decision.tokens} tokens${overrode(decision.forced)}`
    case 'act':
      return `${compact ? 'compacting' : 'handing over'} now, context ${decision.tokens} tokens${overrode(decision.forced)}`
  }
}

// How a diagnostic line names a decision: the pause line and the end of a countdown say it the same way.
export const decidedOf = (decision: Decision): string => `decided ${decision.kind}${decision.kind === 'defer' ? ` (${decision.reason})` : ''}`

export const HANDED_OVER = 'handed over, the fresh session carries on from the handoff'

export const COMPACTED = 'compacted, the session carries on'

export const REDELIVERED = 'redelivered, the fresh session carries on from the handoff'

export const REDELIVERING = 'redelivering the handoff'

export const NOTHING_TO_REDELIVER = 'nothing to redeliver'

const USAGE =
  'use `/sweet-spot later [tokens]` to move the next handover back, or `/sweet-spot redeliver` to submit again the handoff that did not reach the fresh session'

// An argument the command does not know is named, so that a guess like `wait 10000` does not read as a hint about something else.
export const usageFor = (args: string): string => (args.trim() === '' ? USAGE : `unknown argument "${args}", ${USAGE}`)

// The change from one way to the other, with the reason the first one failed.
const FAILED: Record<Method, (reason: string) => string> = {
  'external-command': reason => `the handoff through the command failed (${reason})`,
  'internal-handoff': reason => `the handoff the mod writes failed (${reason})`,
  'builtin-compact': reason => `the compact failed (${reason})`,
}
const INSTEAD: Record<Method, string> = {
  'external-command': 'the command is used instead',
  'internal-handoff': 'the mod writes the handoff instead',
  'builtin-compact': 'compacting instead',
}
export const fellBackLine = (reason: string, from: Method, to: Method): string => `${FAILED[from](reason)}, ${INSTEAD[to]}`

export const HANDOFF_UNDER_WAY = 'a handover is in progress, try again when it is done'

export const REDELIVER_UNDER_WAY = 'a redelivery is under way'

export const ANSWER_RUNNING = 'an answer is running, try again when it is done'

export const offLine = (errors: readonly string[]): string => `off: ${errors.join('; ')}`

export const unregisteredLine = (reason: string): string => `could not register its command (${reason})`

export const CANCELLED = 'cancelled, the session is as it was'

export const failedLine = (reason: string): string => `handover failed, ${reason}`

export const unreadLine = (reason: string): string => `could not check for a handoff (${reason})`

export const contextUnreadLine = (reason: string): string => `could not read the context size (${reason})`

export const CONTEXT_UNKNOWN = 'context size unknown, try again after the next answer'

// The emergency brake: past it the handoff goes ahead although work is running.
const overrode = (forced: BusyReason | undefined): string => (forced === undefined ? '' : `, although ${BUSY[forced]} (emergency brake)`)
