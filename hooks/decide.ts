// Whether to hand over now. Pure: the caller takes the snapshot, acts on the answer, and keeps the record of the last attempt.

import type { Config } from './config'

export type Attempt = { at: number; turns: number }

export type Snapshot = {
  // Input side of the last answer; undefined in a fresh session and after /clear.
  tokens: number | undefined
  window: number
  backgroundTasks: number
  oneShotTimers: number
  subagents: number
  now: number
  turns: number
  lastAttempt: Attempt | undefined
}

// Work that wakes the session again; /clear in the middle of it would lose it.
export type BusyReason = 'subagent' | 'background-task' | 'one-shot-timer'

export type DeferReason = BusyReason | 'min-gap'

// `act` and `dry-run` ("would hand over") carry `forced`: the work the emergency brake handed over despite.
export type Decision =
  | { kind: 'none' }
  | { kind: 'defer'; reason: DeferReason; tokens: number }
  | { kind: 'act'; tokens: number; forced?: BusyReason }
  | { kind: 'dry-run'; tokens: number; forced?: BusyReason }

// Past the threshold the context may grow this far while work runs, and never beyond 90 percent of the window.
const BRAKE_EXTRA = 150_000

// Not a setting: 80 percent of the window, so that the handoff itself still fits. Whole numbers, because 0.8 has no exact binary form.
export const effectiveThreshold = (threshold: number, window: number): number => Math.min(threshold, Math.floor((window * 4) / 5))

// Counted from the threshold in force, which a small window has already lowered.
export const brakeOf = (threshold: number, window: number): number => Math.min(Math.floor((window * 9) / 10), threshold + BRAKE_EXTRA)

const busyReason = (s: Snapshot): BusyReason | undefined =>
  s.subagents > 0 ? 'subagent' : s.backgroundTasks > 0 ? 'background-task' : s.oneShotTimers > 0 ? 'one-shot-timer' : undefined

// Over when the minutes or the turns have passed, so a count of turns that starts over with a fresh session cannot hold the lock for good.
// Kept after a failure as after a success: a handoff that fails every time must not retry at every stop.
const withinGap = (s: Snapshot, config: Config): boolean =>
  s.lastAttempt !== undefined && s.now - s.lastAttempt.at < config.minGapMinutes * 60_000 && s.turns - s.lastAttempt.turns < config.minGapTurns

// The statuses after which a task no longer wakes the session.
const FINAL = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'canceled', 'error'])

export const activeTasks = (tasks: readonly { status: string }[] | undefined): number => (tasks ?? []).filter(t => !FINAL.has(t.status)).length

// A recurring timer is a standing loop: it would not end by waiting.
export const oneShots = (crons: readonly { recurring: boolean }[] | undefined): number => (crons ?? []).filter(c => !c.recurring).length

export const decide = (snapshot: Snapshot, config: Config): Decision => {
  const { tokens, window } = snapshot
  const threshold = effectiveThreshold(config.threshold, window)
  if (tokens === undefined || tokens < threshold) return { kind: 'none' }
  const busy = busyReason(snapshot)
  if (busy !== undefined && tokens < brakeOf(threshold, window)) return { kind: 'defer', reason: busy, tokens }
  if (withinGap(snapshot, config)) return { kind: 'defer', reason: 'min-gap', tokens }
  return { kind: config.dryRun ? 'dry-run' : 'act', tokens, ...(busy === undefined ? {} : { forced: busy }) }
}
