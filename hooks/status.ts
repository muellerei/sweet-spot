// What `/sweet-spot status` says: where the context stands against the threshold and the emergency brake. Pure, and built from the same
// functions as the handover, so that the answer and the behaviour cannot part.

import type { Config } from './config'
import { brakeFor, effectiveThreshold, thresholdInForce, type Later } from './decide'

// `later` is the one that still holds at this context: the caller has already looked at whether the context fell below where it was asked.
// With no size read yet (just after a compact) the context part says so, and a `later` that was held stays, as nothing says it is over.
export const statusFor = (config: Config, window: number, tokens: number | undefined, later: Later | undefined): string => {
  const handover = thresholdInForce(config.threshold, window, later)
  const at = later === undefined ? `${handover}` : `${handover} (later, threshold ${effectiveThreshold(config.threshold, window)})`
  const context = tokens === undefined ? `context size unknown until the next answer (window ${window})` : `context ${tokens} of ${window} tokens`
  return `${config.dryRun ? 'dry run, only reports: ' : ''}${context}, hands over at ${at}, emergency brake at ${brakeFor(config, window)}`
}
