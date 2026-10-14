// What `/sweet-spot status` says: where the context stands against the threshold and the emergency brake. Pure, and built from the same
// functions as the handover, so that the answer and the behaviour cannot part.

import type { Config } from './config'
import { brakeFor, effectiveThreshold, thresholdInForce, type Later } from './decide'
import { HOUR_MS, prepareDueAt } from './idle-handoff'

// `later` is the one that still holds at this context: the caller has already looked at whether the context fell below where it was asked.
// With no size read yet (just after a compact) the context part says so, and a `later` that was held stays, as nothing says it is over.
export const statusFor = (config: Config, window: number, tokens: number | undefined, later: Later | undefined): string => {
  const handover = thresholdInForce(config.threshold, window, later)
  const at = later === undefined ? `${handover}` : `${handover} (later, threshold ${effectiveThreshold(config.threshold, window)})`
  const context = tokens === undefined ? `context size unknown until the next answer (window ${window})` : `context ${tokens} of ${window} tokens`
  return `${config.dryRun ? 'dry run, only reports: ' : ''}${context}, hands over at ${at}, emergency brake at ${brakeFor(config, window)}`
}

// Where the handoff after a long pause stands: planned with the time left until it is written, written and warm until a time of day the
// caller gives as text, or written and cold.
export type IdlePart = { kind: 'planned'; inMs: number } | { kind: 'ready'; until: string } | { kind: 'cold' }

// The time of day in the process's own zone, as a clock shows it.
const timeOfDay = (ms: number): string => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Where the handoff after a long pause stands, from what the session keeps of it; nothing while none is planned or written.
export const idlePart = (idle: { prepared?: unknown; timer?: unknown; touch?: number }, now: number): IdlePart | undefined => {
  const { prepared, timer, touch } = idle
  if (touch === undefined) return undefined
  if (prepared !== undefined) return now - touch >= HOUR_MS ? { kind: 'cold' } : { kind: 'ready', until: timeOfDay(touch + HOUR_MS) }
  return timer === undefined ? undefined : { kind: 'planned', inMs: prepareDueAt(touch) - now }
}

// What follows the status: `asap` first, since it acts at the next pause, and the handoff after a long pause, which waits for the next
// message. Nothing of a part that does not hold.
export const statusTail = (asap: boolean, idle: IdlePart | undefined): string => {
  const parts = asap ? ['asap: hands over at the next pause'] : []
  if (idle?.kind === 'planned') parts.push(`idle handoff ready in ${Math.max(1, Math.ceil(idle.inMs / 60_000))} min`)
  else if (idle?.kind === 'ready') parts.push(`idle handoff ready, goes with your next message after ${idle.until}`)
  else if (idle?.kind === 'cold') parts.push('idle handoff ready, goes with your next message')
  return parts.map(p => `, ${p}`).join('')
}
