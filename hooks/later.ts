// What `/sweet-spot later` makes of its argument and of the context it is typed at. Pure: the command reads the session and keeps what
// comes back, so that the answer, the pause line and `decide` take the value in force from the one place (`thresholdInForce`).

import type { Config } from './config'
import { brakeOf, effectiveThreshold, laterAt, thresholdInForce, type Later } from './decide'

// A whole number of tokens, with `k` for a thousand. Anything else is turned down with what was typed: the mod never quietly rounds
// `1.5k` or reads `50 k` as 50000, as it never replaces a setting.
const TOKENS = /^[0-9]+[kK]?$/

// The argument after `later`: none takes `later_tokens`, which only the settings know.
export const tokensOf = (rest: string): { tokens: number | 'setting' } | { error: string } => {
  const text = rest.trim()
  if (text === '') return { tokens: 'setting' }
  const tokens = TOKENS.test(text) ? Number.parseInt(text, 10) * (/k$/i.test(text) ? 1000 : 1) : 0
  return tokens >= 1 ? { tokens } : { error: `"${text}" is not a number of tokens, use /sweet-spot later <tokens>, e.g. later 50k` }
}

// The debug line for a later handover that a shrunken context ended, at a pause or at the command alike.
export const LATER_OVER = 'later: over, the context shrank below where it was asked'

// The command at a known context: what the answer says, the later handover that holds afterwards, and the debug lines about it. A later handover the context has
// shrunk below is over here too, as at a pause: a turn that ended without an answer reads the context again without a pause to see it.
export const laterFor = (
  config: Config,
  window: number,
  tokens: number,
  current: Later | undefined,
  n: number,
): { later: Later | undefined; text: string; lines: string[] } => {
  const kept = laterAt(current, tokens)
  const lines = current !== undefined && kept === undefined ? [LATER_OVER] : []
  const inForce = thresholdInForce(config.threshold, window, kept)
  const threshold = effectiveThreshold(config.threshold, window)
  const brake = brakeOf(threshold, window)
  const context = `context ${tokens} tokens`
  // Only ever later: a value at or below the one in force would bring the handover forward or change nothing.
  if (tokens + n <= inForce)
    return { later: kept, text: `already hands over at ${inForce} tokens, ${context}`, lines: [...lines, `later: turned down, not past ${inForce}`] }
  // At the brake no later is left to give, and a command with no effect is turned down.
  if (tokens >= brake)
    return { later: kept, text: `already at the emergency brake, ${brake} tokens, ${context}`, lines: [...lines, 'later: turned down, at the emergency brake'] }
  const until = tokens + n
  const asked = { from: tokens, until }
  const at = thresholdInForce(config.threshold, window, asked)
  const capped = until > brake ? ', capped at the emergency brake' : ''
  const handsOver = config.dryRun ? 'dry run, would hand over' : 'hands over'
  return {
    later: asked,
    text: `${handsOver} at ${at} tokens instead of ${threshold}, for this handover only${capped}, ${context}`,
    lines: [...lines, `later: from context ${tokens}, ${n} tokens, hands over at ${at}${capped}`],
  }
}
