// Whether to hand over now. Pure: the caller takes the snapshot, acts on the answer, and keeps the record of the last attempt.

import type { Config } from './config'
import type { TaskSummary } from './pairing'
import { standing } from './standing'

export type Attempt = { at: number; turns: number }

// A handover moved back by `/sweet-spot later`: asked at a context of `from`, to hand over at `until`. `until` is kept as asked, not
// capped: the cap comes from the window, which can change before the pause that judges it.
export type Later = { from: number; until: number }

// A handover asked for with `/sweet-spot asap`, at a context of `from`: it lifts the threshold and the minimum gap for the next handover, and
// nothing else. Work that is running still holds it back, below the emergency brake.
export type Asap = { from: number }

export type Snapshot = {
  // Input side of the last answer; undefined in a fresh session and after /clear.
  tokens: number | undefined
  window: number
  // Waiting tasks: running, standing ones excluded. A dev server never ends, and nothing waits for its result.
  backgroundTasks: number
  // Running tasks that never end by themselves; they hold nothing back, and the pause line names how many there are.
  standingTasks: number
  oneShotTimers: number
  subagents: number
  now: number
  turns: number
  lastAttempt: Attempt | undefined
  later: Later | undefined
  asap: Asap | undefined
}

// Work that is still running and reports back to the session. A handoff written now cannot hold its result, and the result would come
// into a fresh session that does not know what it was for.
export type BusyReason = 'subagent' | 'background-task' | 'one-shot-timer'

// `turn` only the end of a countdown finds: a turn that started while the countdown began, before there was one for it to end.
export type DeferReason = BusyReason | 'min-gap' | 'turn'

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

// The brake of the settings at a window, counted from the threshold in force there.
export const brakeFor = (config: Pick<Config, 'threshold'>, window: number): number => brakeOf(effectiveThreshold(config.threshold, window), window)

// The value a pause judges at: the threshold in force, or the one `later` asked for. That one is capped at the brake of the window as it
// is now (after a change to a smaller window it would lie past the brake, or past the window, and nothing would ever hand over), and it never
// lies below the threshold in force (after a change to a larger window it would bring the handover forward). The answer of `later`, the
// pause's log line and `decide` all take it from here.
export const thresholdInForce = (threshold: number, window: number, later: Later | undefined): number => {
  const t = effectiveThreshold(threshold, window)
  return later === undefined ? t : Math.max(t, Math.min(later.until, brakeOf(t, window)))
}

// A context below where a mark was set has shrunk (a compact of any kind, or /clear), and ends it; no reading of the context changes
// nothing, as with the compact check.
export const shrunk = <T extends { from: number }>(mark: T | undefined, tokens: number | undefined): T | undefined =>
  mark === undefined || tokens === undefined || tokens >= mark.from ? mark : undefined
export const laterAt = shrunk<Later>

// The one rule of what counts as running work, for the pause and for coming back after a long one.
export const busyReason = (s: Pick<Snapshot, 'subagents' | 'backgroundTasks' | 'oneShotTimers'>): BusyReason | undefined =>
  s.subagents > 0 ? 'subagent' : s.backgroundTasks > 0 ? 'background-task' : s.oneShotTimers > 0 ? 'one-shot-timer' : undefined

// Over when the minutes or the turns have passed, so a count of turns that starts over with a fresh session cannot hold the lock for good.
// Kept after a failure as after a success: a handoff that fails every time must not retry at every stop.
const withinGap = (s: Snapshot, config: Config): boolean =>
  s.lastAttempt !== undefined && s.now - s.lastAttempt.at < config.minGapMinutes * 60_000 && s.turns - s.lastAttempt.turns < config.minGapTurns

// The statuses after which a task no longer wakes the session.
const FINAL = new Set(['completed', 'failed', 'killed', 'stopped', 'cancelled', 'canceled', 'error'])

export const running = (tasks: readonly TaskSummary[] | undefined): TaskSummary[] => (tasks ?? []).filter(t => !FINAL.has(t.status))

// What a handover waits for, and what it does not: a running task is one or the other.
export const waiting = (tasks: readonly TaskSummary[] | undefined): TaskSummary[] => running(tasks).filter(t => !standing(t))
export const standingOf = (tasks: readonly TaskSummary[] | undefined): TaskSummary[] => running(tasks).filter(standing)

// A recurring timer is a standing loop: it would not end by waiting.
export const oneShots = (crons: readonly { recurring: boolean }[] | undefined): number => (crons ?? []).filter(c => !c.recurring).length

export const decide = (snapshot: Snapshot, config: Config): Decision => {
  const { tokens, window } = snapshot
  const threshold = effectiveThreshold(config.threshold, window)
  if (tokens === undefined || (snapshot.asap === undefined && tokens < thresholdInForce(config.threshold, window, snapshot.later))) return { kind: 'none' }
  const busy = busyReason(snapshot)
  if (busy !== undefined && tokens < brakeOf(threshold, window)) return { kind: 'defer', reason: busy, tokens }
  if (snapshot.asap === undefined && withinGap(snapshot, config)) return { kind: 'defer', reason: 'min-gap', tokens }
  return { kind: config.dryRun ? 'dry-run' : 'act', tokens, ...(busy === undefined ? {} : { forced: busy }) }
}
