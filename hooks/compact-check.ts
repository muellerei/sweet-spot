// Whether a compact brought the context under the threshold. A compact that did not is not repeated at every pause: it counts as a failed
// way until a pause is below the threshold again. Pure, so that the table of moves is tested on its own.

import type { Config, Method } from './config'

// `pending`: a compact succeeded and no reading of the size has said yet whether it was enough. `insufficient`: it was not; `said` is whether the failure
// that follows from it has been told to the person (once for each mark).
export type CompactCheck = { kind: 'pending' } | { kind: 'insufficient'; said: boolean } | undefined

// The mark after a reading of the size: the first tool call after the compact, or a pause. A reading with no size changes nothing: the host
// reports none right after a compact, and a reading that cannot tell does not decide. A size at or above the threshold turns `pending` into
// `insufficient`; one below it clears either.
export const checkOf = (check: CompactCheck, tokens: number | undefined, threshold: number): CompactCheck => {
  if (check === undefined || tokens === undefined) return check
  if (tokens < threshold) return undefined
  return check.kind === 'pending' ? { kind: 'insufficient', said: false } : check
}

// The debug line for what a reading of the size made of a compact still to be judged: enough, or not. None while it stays to be judged.
export const judgedLine = (before: CompactCheck, after: CompactCheck, tokens: number | undefined): string | undefined => {
  if (before?.kind !== 'pending' || after?.kind === 'pending') return undefined
  return after === undefined ? `compact left ${tokens} tokens, below the threshold` : 'compact left the context above the threshold'
}

// The way that is tried first. A compact that was not enough is not tried: where it is the main method the fallback is the first, and
// where there is none, there is no first way and the run fails at the mark. The fallback is what the run opens with, the compact is the
// failure it falls back from.
export const firstMethod = (config: Config, state: { compactCheck: CompactCheck }): Method | undefined => {
  if (config.handoffMethod !== 'builtin-compact' || state.compactCheck?.kind !== 'insufficient') return config.handoffMethod
  return config.handoffFallback === 'none' ? undefined : config.handoffFallback
}
