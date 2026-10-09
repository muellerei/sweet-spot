// The host puts "context-relay:" in front of a log line and of what the command returns itself (measured), so none of these lines starts with the name. The hold's own lines keep it: where they show is not measured.
// What the mod says about a decision. Every line names the context size: a person who sees "postponed" wants to know how close the limit is.

import type { BusyReason, DeferReason, Decision } from './decide'

const BUSY: Record<BusyReason, string> = {
  subagent: 'a subagent is running',
  'background-task': 'a background task is running',
  'one-shot-timer': 'a timer that fires once is set',
}

const DEFERRED: Record<DeferReason, string> = { ...BUSY, 'min-gap': 'the minimum gap since the last attempt has not passed' }

// `none` has nothing to say and is not asked.
export const reportOf = (decision: Exclude<Decision, { kind: 'none' }>): string => {
  switch (decision.kind) {
    case 'defer':
      return `handoff postponed, ${DEFERRED[decision.reason]}, context ${decision.tokens} tokens`
    case 'dry-run':
      return `dry run, would hand over now, context ${decision.tokens} tokens${overrode(decision.forced)}`
    case 'act':
      return `handing over now, context ${decision.tokens} tokens${overrode(decision.forced)}`
  }
}

export const HANDED_OVER = 'handed over, the fresh session carries on from the handoff'

export const REDELIVERED = 'redelivered, the fresh session carries on from the handoff'

export const REDELIVERING = 'redelivering the handoff'

export const NOTHING_TO_REDELIVER = 'nothing to redeliver'

const USAGE = 'use `/context-relay redeliver` to submit again the handoff that did not reach the fresh session'

// An argument the command does not know is named, so that a guess like `wait 10000` does not read as a hint about something else.
export const usageFor = (args: string): string => (args.trim() === '' ? USAGE : `unknown argument "${args}", ${USAGE}`)

export const fellBackLine = (reason: string): string => `the handoff through the command failed (${reason}), handing over with a fork of the history instead`

export const HANDOFF_UNDER_WAY = 'a handoff is under way, try again when it is done'

export const REDELIVER_UNDER_WAY = 'a redelivery is under way'

export const offLine = (errors: readonly string[]): string => `off: ${errors.join('; ')}`

export const unregisteredLine = (reason: string): string => `could not register its command (${reason})`

export const CANCELLED = 'handoff cancelled, the session is as it was'

export const failedLine = (reason: string): string => `handoff failed, ${reason}`

export const unreadLine = (reason: string): string => `could not check for a handoff (${reason})`

// The emergency brake: past it the handoff goes ahead although work is running.
const overrode = (forced: BusyReason | undefined): string => (forced === undefined ? '' : `, although ${BUSY[forced]} (emergency brake)`)
