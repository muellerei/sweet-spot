// Whether a compact brought the context under the threshold. A compact that did not is not repeated at every pause: it counts as a failed
// way until a pause is below the threshold again. Pure, so that the table of moves is tested on its own.

import type { Config, Method } from './config'

// `pending`: a compact succeeded and no pause has said yet whether it was enough. `insufficient`: it was not; `said` is whether the failure
// that follows from it has been told to the person (once for each mark).
export type CompactCheck = { kind: 'pending' } | { kind: 'insufficient'; said: boolean } | undefined

// The mark after a pause. A pause with no size changes nothing: the host reports none right after a compact, and a pause that cannot tell
// does not decide. A size at or above the threshold turns `pending` into `insufficient`; one below it clears either.
export const checkOf = (check: CompactCheck, tokens: number | undefined, threshold: number): CompactCheck => {
  if (check === undefined || tokens === undefined) return check
  if (tokens < threshold) return undefined
  return check.kind === 'pending' ? { kind: 'insufficient', said: false } : check
}

// The way that is tried first. A compact that was not enough is not tried: where it is the main method the fallback is the first, and
// where there is none, there is no first way and the run fails at the mark. The fallback is what the run opens with, the compact is the
// failure it falls back from.
export const firstMethod = (config: Config, state: { compactCheck: CompactCheck }): Method | undefined => {
  if (config.handoffMethod !== 'builtin-compact' || state.compactCheck?.kind !== 'insufficient') return config.handoffMethod
  return config.handoffFallback === 'none' ? undefined : config.handoffFallback
}
