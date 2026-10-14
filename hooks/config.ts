// Reads the settings of the plugin. A value that does not fit is rejected with its value and the reason, never replaced by a default:
// a quiet replacement would hand over at a threshold nobody chose.

// The ways to hand a session over, once: the type is read from this list, `plugin.json` offers the same values and `docs/src/check.py`
// reads the list (a union type could only be read by a pattern that breaks easily).
export const METHODS = ['external-command', 'internal-handoff', 'builtin-compact'] as const
export type Method = (typeof METHODS)[number]

export type Config = {
  threshold: number
  dryRun: boolean
  minGapMinutes: number
  minGapTurns: number
  // How far `/sweet-spot later` with no number moves a handover back, in tokens.
  laterTokens: number
  // How long the mod waits before an automatic handover, in seconds. 0: no wait.
  countdownSeconds: number
  // The main way, and the one tried when it fails before it changed the session. 'none': no second try.
  handoffMethod: Method
  handoffFallback: Method | 'none'
  handoffCommand: string
  // The handoff after a long pause: on or off, and the context size it starts at. 0: the session's baseline plus a fixed distance.
  idleHandoff: boolean
  idleHandoffMinTokens: number
}
export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: string[] }

// The defaults of plugin.json. The host checks type and `min` of plugin.json before it loads the mod, so what is checked here is a second
// line of defence, and the only one for the rules across values; the tests pin these and the defaults of plugin.json to the same values.
// No command by default: one that merely shares the name `handoff` is not the user's to run.
export const DEFAULTS: Config = {
  threshold: 200_000,
  dryRun: false,
  minGapMinutes: 10,
  minGapTurns: 5,
  laterTokens: 25_000,
  countdownSeconds: 10,
  handoffMethod: 'internal-handoff',
  handoffFallback: 'builtin-compact',
  handoffCommand: '',
  idleHandoff: true,
  idleHandoffMinTokens: 0,
}

// The same number is `min` and the text of `threshold` in plugin.json and the README; the tests cannot read those files, so a change here
// is made in all three. Below this a fresh session already starts near the threshold (the CHANGELOG has the numbers, under Chosen, with the reason): every pause would hand over again.
const MIN_THRESHOLD = 130_000

// The span of `countdown_seconds`, the same as `min` and `max` in plugin.json; `docs/src/check.py` compares the two. The test engine refuses a
// value above `max` before the mod loads, but lets a fraction through; whether a real load checks `max` is not measured.
export const COUNTDOWN_SECONDS = { min: 0, max: 60 } as const

// `JSON.stringify` writes NaN and Infinity as null.
const show = (raw: unknown): string => (typeof raw === 'number' ? String(raw) : (JSON.stringify(raw) ?? String(raw)))

type Checked<T> = { value: T } | { error: string }

const finiteAtLeast = (raw: unknown, min: number, whole: boolean, { why = '', max = Number.POSITIVE_INFINITY } = {}): Checked<number> => {
  if (typeof raw !== 'number') return { error: `${show(raw)} is not a number` }
  if (!Number.isFinite(raw)) return { error: `${show(raw)} is not a finite number` }
  if (raw < min) return { error: `${show(raw)} is below ${min}${why}` }
  if (raw > max) return { error: `${show(raw)} is above ${max}` }
  if (whole && !Number.isInteger(raw)) return { error: `${show(raw)} is not a whole number` }
  return { value: raw }
}

const flag = (raw: unknown): Checked<boolean> => (typeof raw === 'boolean' ? { value: raw } : { error: `${show(raw)} is not true or false` })

const commandName = (raw: unknown): Checked<string> => {
  if (typeof raw !== 'string') return { error: `${show(raw)} is not a text` }
  // Empty is no command of your own: the internal handoff writes it.
  if (raw.trim() === '') return { value: '' }
  if (raw.startsWith('/')) return { error: `${show(raw)} starts with a slash, give the name without it` }
  if (/\s/.test(raw)) return { error: `${show(raw)} has a space, give the name only` }
  return { value: raw }
}

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (raw: unknown): Checked<T> =>
    typeof raw === 'string' && (values as readonly string[]).includes(raw) ? { value: raw as T } : { error: `${show(raw)} is not one of ${values.join(', ')}` }

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
    threshold: take('threshold', DEFAULTS.threshold, raw =>
      finiteAtLeast(raw, MIN_THRESHOLD, false, { why: ', a handoff that close to the start would repeat' }),
    ),
    dryRun: take('dry_run', DEFAULTS.dryRun, flag),
    minGapMinutes: take('min_gap_minutes', DEFAULTS.minGapMinutes, raw => finiteAtLeast(raw, 0, false)),
    minGapTurns: take('min_gap_turns', DEFAULTS.minGapTurns, raw => finiteAtLeast(raw, 0, true)),
    laterTokens: take('later_tokens', DEFAULTS.laterTokens, raw => finiteAtLeast(raw, 1, true)),
    countdownSeconds: take('countdown_seconds', DEFAULTS.countdownSeconds, raw =>
      finiteAtLeast(raw, COUNTDOWN_SECONDS.min, true, { max: COUNTDOWN_SECONDS.max }),
    ),
    handoffMethod: take('handoff_method', DEFAULTS.handoffMethod, oneOf(METHODS)),
    handoffFallback: take('handoff_fallback', DEFAULTS.handoffFallback, oneOf([...METHODS, 'none'] as const)),
    handoffCommand: take('handoff_command', DEFAULTS.handoffCommand, commandName),
    idleHandoff: take('idle_handoff', DEFAULTS.idleHandoff, flag),
    idleHandoffMinTokens: take('idle_handoff_min_tokens', DEFAULTS.idleHandoffMinTokens, raw => finiteAtLeast(raw, 0, true)),
  }
  // The same way twice is no second try. Done before the rule below, so that one field asking for the command is told once.
  if (config.handoffFallback === config.handoffMethod) config.handoffFallback = 'none'
  // A way that can never run switches the mod off with the reason, rather than failing at every handoff.
  if (config.handoffCommand === '') {
    const key = config.handoffMethod === 'external-command' ? 'handoff_method' : config.handoffFallback === 'external-command' ? 'handoff_fallback' : undefined
    if (key) errors.push(`${key}: "external-command" needs handoff_command, which is empty`)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config }
}
