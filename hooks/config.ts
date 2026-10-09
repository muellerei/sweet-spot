// Reads the settings of the plugin. A value that does not fit is rejected with its value and the reason, never replaced by a default:
// a quiet replacement would hand over at a threshold nobody chose.

export type Config = { threshold: number; dryRun: boolean; minGapMinutes: number; minGapTurns: number; handoffCommand: string; trace: boolean }
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] }

// The defaults of plugin.json. The host checks type and `min` of plugin.json before it loads the mod, so what is checked here is a second
// line of defence, and the only one for the rules across values; the tests pin these and the defaults of plugin.json to the same values.
// No command by default: one that merely shares the name `handoff` is not the user's to run.
export const DEFAULTS: Config = { threshold: 200_000, dryRun: false, minGapMinutes: 10, minGapTurns: 5, handoffCommand: '', trace: false }

// The same number is `min` and the text of `threshold` in plugin.json and the README; the tests cannot read those files, so a change here
// is made in all three. Below this a fresh session already starts near the threshold (median start 88k, p90 110k, plus the handoff): every pause would hand over again.
const MIN_THRESHOLD = 130_000

// `JSON.stringify` writes NaN and Infinity as null.
const show = (raw: unknown): string => (typeof raw === 'number' ? String(raw) : (JSON.stringify(raw) ?? String(raw)))

type Checked<T> = { value: T } | { error: string }

const finiteAtLeast = (raw: unknown, min: number, whole: boolean, why = ''): Checked<number> => {
  if (typeof raw !== 'number') return { error: `${show(raw)} is not a number` }
  if (!Number.isFinite(raw)) return { error: `${show(raw)} is not a finite number` }
  if (raw < min) return { error: `${show(raw)} is below ${min}${why}` }
  if (whole && !Number.isInteger(raw)) return { error: `${show(raw)} is not a whole number` }
  return { value: raw }
}

const flag = (raw: unknown): Checked<boolean> => (typeof raw === 'boolean' ? { value: raw } : { error: `${show(raw)} is not true or false` })

const commandName = (raw: unknown): Checked<string> => {
  if (typeof raw !== 'string') return { error: `${show(raw)} is not a text` }
  // Empty is no command of your own: the fork writes the handoff.
  if (raw.trim() === '') return { value: '' }
  if (raw.startsWith('/')) return { error: `${show(raw)} starts with a slash, give the name without it` }
  if (/\s/.test(raw)) return { error: `${show(raw)} has a space, give the name only` }
  return { value: raw }
}

export const configOf = (options: Record<string, unknown>): ConfigResult => {
  const errors: string[] = []
  // An unset value is the default; a set one is checked as it is.
  const take = <T>(key: string, fallback: T, check: (raw: unknown) => Checked<T>): T => {
    const raw = options[key]
    if (raw === undefined) return fallback
    const checked = check(raw)
    if ('error' in checked) {
      errors.push(`${key}: ${checked.error}`)
      return fallback
    }
    return checked.value
  }
  const config: Config = {
    threshold: take('threshold', DEFAULTS.threshold, raw => finiteAtLeast(raw, MIN_THRESHOLD, false, ', a handoff that close to the start would repeat')),
    dryRun: take('dry_run', DEFAULTS.dryRun, flag),
    minGapMinutes: take('min_gap_minutes', DEFAULTS.minGapMinutes, raw => finiteAtLeast(raw, 0, false)),
    minGapTurns: take('min_gap_turns', DEFAULTS.minGapTurns, raw => finiteAtLeast(raw, 0, true)),
    handoffCommand: take('handoff_command', DEFAULTS.handoffCommand, commandName),
    trace: take('trace', DEFAULTS.trace, flag),
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}
