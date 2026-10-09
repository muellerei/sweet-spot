// The diagnostic output, for developers: one function, one level, and only the level decides which lines show. The level comes from an
// environment variable, not from a setting, so it ships with nothing and shows in no menu. This module never sees the host and never names
// the variable: what reads it and what writes a line are handed in, so all of it is tested without a host.

// In rising order; each level shows its own lines and those of the levels before it.
const LEVELS = ['off', 'warn', 'info', 'debug', 'trace'] as const

export type Level = (typeof LEVELS)[number]

// Unset or empty is off. There is no short form such as `1` or `true`: it would leave open which level it means. Anything that is no
// level turns on `warn` rather than `off`, since `off` would hide the very line that names the typo, and `info` would add a line at every
// pause to someone who meant `0` or `error`.
export const levelOf = (raw: string | undefined): { level: Level; bad?: string } => {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === '') return { level: 'off' }
  return (LEVELS as readonly string[]).includes(value) ? { level: value as Level } : { level: 'warn', bad: value }
}

export const shows = (configured: Level, line: Level): boolean => line !== 'off' && LEVELS.indexOf(line) <= LEVELS.indexOf(configured)

// The level is asked at each line, not once: a line written later, as from a timer, goes by the level of the latest read.
export const logger =
  (level: () => Level, out: (text: string) => void) =>
  (line: Exclude<Level, 'off'>, text: string): void => {
    if (shows(level(), line)) out(`${line}: ${text}`)
  }

// What the mod keeps of the variable: the level in force, and the bad value it last reported, so that a bad value is reported once and
// not at every read. A valid read forgets it: the same typo after a correction is a new mistake.
export type LevelMemo = { logLevel: Level; badLogLevel: string | undefined }

// Each handler that logs reads the variable at its start, since a value set in a settings file reaches the host at the next turn and a
// reload does not load the mod again. Everything after the read runs without a break, so two handlers reading at once write one line.
// A read that throws keeps the level as it was, and says nothing: a hook that throws is skipped by the host, and a switch for diagnostics
// must not stop the mod's work.
// It answers with the level before the read, so that the caller can mark a change.
export const refresh = async (read: () => Promise<string | undefined>, out: (text: string) => void, memo: LevelMemo): Promise<Level> => {
  let raw: string | undefined
  try {
    raw = await read()
  } catch {
    return memo.logLevel
  }
  // Taken after the wait: of two reads at once, the second sees what the first set.
  const before = memo.logLevel
  const { level, bad } = levelOf(raw)
  memo.logLevel = level
  if (bad === undefined) memo.badLogLevel = undefined
  else if (memo.badLogLevel !== bad) {
    memo.badLogLevel = bad
    logger(() => memo.logLevel, out)('warn', `log level "${bad}" is not one of ${LEVELS.join(', ')}, logging at warn`)
  }
  return before
}
