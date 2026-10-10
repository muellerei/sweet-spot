import { test, expect } from 'claude-code/testing'

import { DEFAULTS, configOf } from './config'
import { activeTasks, decide, effectiveThreshold, laterAt, oneShots, thresholdInForce, type Decision, type Snapshot } from './decide'
import { DEFAULT_PROMPT, ASK_FOR_PATH, firstMessage, modelForkFailure, modelForkKind, handoffPath, newestHandoff, promptFrom, promptPath } from './handoff'
import { endSeen, freshPairing, judgeable, stopSeen, turnStarted } from './pairing'
import { reportOf } from './report'

const rejected = (options: Record<string, unknown>) => {
  const result = configOf(options)
  return result.ok ? [] : result.errors
}

// Typed on purpose: the test falls when a default changes in config.ts or in plugin.json (see register.test.tsx).
test('configOf: nothing set gives the defaults, and the defaults are these', async () => {
  const expected = {
    threshold: 200_000,
    dryRun: false,
    minGapMinutes: 10,
    minGapTurns: 5,
    laterTokens: 25_000,
    handoffMethod: 'internal-handoff',
    handoffFallback: 'builtin-compact',
    handoffCommand: '',
  }
  expect(DEFAULTS).toEqual(expected)
  expect(configOf({})).toEqual({ ok: true, config: expected })
})

test('configOf: valid values are taken as they are', async () => {
  const result = configOf({ threshold: 130_000, dry_run: false, min_gap_minutes: 0, min_gap_turns: 0, later_tokens: 1, handoff_command: 'claude-mem:handoff' })
  expect(result).toEqual({
    ok: true,
    config: {
      threshold: 130_000,
      dryRun: false,
      minGapMinutes: 0,
      minGapTurns: 0,
      laterTokens: 1,
      handoffMethod: 'internal-handoff',
      handoffFallback: 'builtin-compact',
      handoffCommand: 'claude-mem:handoff',
    },
  })
})

test('configOf: threshold must be a finite number of at least 130000, and is rejected with its value and reason, never replaced', async () => {
  const table: [unknown, string][] = [
    ['200000', 'threshold: "200000" is not a number'],
    ['abc', 'threshold: "abc" is not a number'],
    [null, 'threshold: null is not a number'],
    [true, 'threshold: true is not a number'],
    [[], 'threshold: [] is not a number'],
    [Number.NaN, 'threshold: NaN is not a finite number'],
    [Number.POSITIVE_INFINITY, 'threshold: Infinity is not a finite number'],
    [Number.NEGATIVE_INFINITY, 'threshold: -Infinity is not a finite number'],
    [129_999, 'threshold: 129999 is below 130000, a handoff that close to the start would repeat'],
    [0, 'threshold: 0 is below 130000, a handoff that close to the start would repeat'],
    [-5, 'threshold: -5 is below 130000, a handoff that close to the start would repeat'],
  ]
  for (const [raw, error] of table) expect([raw, rejected({ threshold: raw })]).toEqual([raw, [error]])
})
test('configOf: dry_run is a boolean, nothing else counts as on or off', async () => {
  for (const raw of ['true', 'false', 1, 0, null, ''])
    expect([raw, rejected({ dry_run: raw })]).toEqual([raw, [`dry_run: ${JSON.stringify(raw)} is not true or false`]])
})

test('configOf: the minimum gap is a count of minutes and of turns, 0 or more, turns whole', async () => {
  expect(rejected({ min_gap_minutes: '10' })).toEqual(['min_gap_minutes: "10" is not a number'])
  expect(rejected({ min_gap_minutes: -1 })).toEqual(['min_gap_minutes: -1 is below 0'])
  expect(rejected({ min_gap_minutes: Number.POSITIVE_INFINITY })).toEqual(['min_gap_minutes: Infinity is not a finite number'])
  expect(rejected({ min_gap_turns: '5' })).toEqual(['min_gap_turns: "5" is not a number'])
  expect(rejected({ min_gap_turns: -1 })).toEqual(['min_gap_turns: -1 is below 0'])
  expect(rejected({ min_gap_turns: 2.5 })).toEqual(['min_gap_turns: 2.5 is not a whole number'])
  expect(configOf({ min_gap_minutes: 2.5 })).toMatchObject({ ok: true, config: { minGapMinutes: 2.5 } })
})

test('configOf: later_tokens is a whole number of tokens, 1 or more', async () => {
  expect(rejected({ later_tokens: '25000' })).toEqual(['later_tokens: "25000" is not a number'])
  expect(rejected({ later_tokens: 0 })).toEqual(['later_tokens: 0 is below 1'])
  expect(rejected({ later_tokens: -5 })).toEqual(['later_tokens: -5 is below 1'])
  expect(rejected({ later_tokens: 2.5 })).toEqual(['later_tokens: 2.5 is not a whole number'])
  expect(rejected({ later_tokens: Number.POSITIVE_INFINITY })).toEqual(['later_tokens: Infinity is not a finite number'])
  expect(configOf({ later_tokens: 50_000 })).toMatchObject({ ok: true, config: { laterTokens: 50_000 } })
})

test('configOf: the handoff command is the name as the command list shows it, without a slash or a space', async () => {
  const table: [unknown, string][] = [
    [5, 'handoff_command: 5 is not a text'],
    [null, 'handoff_command: null is not a text'],
    ['/handoff', 'handoff_command: "/handoff" starts with a slash, give the name without it'],
    ['hand off', 'handoff_command: "hand off" has a space, give the name only'],
  ]
  for (const [raw, error] of table) expect([raw, rejected({ handoff_command: raw })]).toEqual([raw, [error]])
})

// Empty means no command of your own: the mod writes the handoff itself. Blanks alone are the same, not a name.
test('configOf: an empty handoff command means none', async () => {
  for (const raw of ['', '  ']) expect([raw, configOf({ handoff_command: raw })]).toMatchObject([raw, { ok: true, config: { handoffCommand: '' } }])
})

test('configOf: each valid value of the main method and of the fallback is taken', async () => {
  const command = { handoff_command: 'handoff' }
  for (const method of ['internal-handoff', 'external-command', 'builtin-compact']) {
    expect([method, configOf({ handoff_method: method, ...command })]).toMatchObject([method, { ok: true, config: { handoffMethod: method } }])
  }
  const pairs = [
    ['internal-handoff', 'none'],
    ['internal-handoff', 'external-command'],
    ['internal-handoff', 'builtin-compact'],
    ['external-command', 'none'],
    ['external-command', 'internal-handoff'],
    ['external-command', 'builtin-compact'],
    ['builtin-compact', 'none'],
    ['builtin-compact', 'internal-handoff'],
    ['builtin-compact', 'external-command'],
  ]
  for (const [method, fallback] of pairs) {
    const result = configOf({ handoff_method: method, handoff_fallback: fallback, ...command })
    expect([method, fallback, result]).toMatchObject([method, fallback, { ok: true, config: { handoffMethod: method, handoffFallback: fallback } }])
  }
})

test('configOf: an unknown method or fallback is rejected with the field and the value, never replaced', async () => {
  const table: [Record<string, unknown>, string][] = [
    [{ handoff_method: 'clone' }, 'handoff_method: "clone" is not one of external-command, internal-handoff, builtin-compact'],
    [{ handoff_method: 'none' }, 'handoff_method: "none" is not one of external-command, internal-handoff, builtin-compact'],
    [{ handoff_method: 5 }, 'handoff_method: 5 is not one of external-command, internal-handoff, builtin-compact'],
    [{ handoff_fallback: 'clone' }, 'handoff_fallback: "clone" is not one of external-command, internal-handoff, builtin-compact, none'],
    [{ handoff_fallback: null }, 'handoff_fallback: null is not one of external-command, internal-handoff, builtin-compact, none'],
  ]
  for (const [options, error] of table) expect([options, rejected(options)]).toEqual([options, [error]])
})

test('configOf: external-command with no handoff_command is rejected, and the message names the field that asks for it', async () => {
  const missing = (field: string) => `${field}: "external-command" needs handoff_command, which is empty`
  expect(rejected({ handoff_method: 'external-command' })).toEqual([missing('handoff_method')])
  expect(rejected({ handoff_fallback: 'external-command' })).toEqual([missing('handoff_fallback')])
  expect(rejected({ handoff_method: 'external-command', handoff_command: '  ' })).toEqual([missing('handoff_method')])
  expect(rejected({ handoff_method: 'external-command', handoff_fallback: 'internal-handoff', handoff_command: 'handoff' })).toEqual([])
})

test('configOf: the same value in both fields is no fallback', async () => {
  for (const method of ['internal-handoff', 'external-command', 'builtin-compact']) {
    const result = configOf({ handoff_method: method, handoff_fallback: method, handoff_command: 'handoff' })
    expect([method, result]).toMatchObject([method, { ok: true, config: { handoffMethod: method, handoffFallback: 'none' } }])
  }
  // One field asks for the command, so the one message is about the main method, not twice.
  expect(rejected({ handoff_method: 'external-command', handoff_fallback: 'external-command' })).toEqual([
    'handoff_method: "external-command" needs handoff_command, which is empty',
  ])
})

test('configOf: every rejected setting is named, not only the first', async () => {
  expect(rejected({ threshold: 'x', dry_run: 'y', handoff_command: '/handoff' })).toEqual([
    'threshold: "x" is not a number',
    'dry_run: "y" is not true or false',
    'handoff_command: "/handoff" starts with a slash, give the name without it',
  ])
})

// A quiet session far below any threshold; each test changes what it is about.
const quiet: Snapshot = {
  tokens: 100_000,
  window: 1_000_000,
  backgroundTasks: 0,
  oneShotTimers: 0,
  subagents: 0,
  now: 10_000_000_000,
  turns: 100,
  lastAttempt: undefined,
  later: undefined,
}
const live = { ...DEFAULTS, dryRun: false }
const kind = (over: Partial<Snapshot>, config = live) => decide({ ...quiet, ...over }, config).kind

test('effectiveThreshold: the smaller of the setting and 80 percent of the window, rounded down', async () => {
  const table: [number, number, number][] = [
    [200_000, 1_000_000, 200_000],
    [200_000, 200_000, 160_000],
    [200_000, 200_001, 160_000],
    [200_000, 250_000, 200_000],
    [900_000, 1_000_000, 800_000],
  ]
  for (const [threshold, window, expected] of table) expect([threshold, window, effectiveThreshold(threshold, window)]).toEqual([threshold, window, expected])
})

test('decide: nothing below the threshold, a handoff from the threshold on', async () => {
  expect(decide({ ...quiet, tokens: 199_999 }, live)).toEqual({ kind: 'none' })
  expect(decide({ ...quiet, tokens: 200_000 }, live)).toEqual({ kind: 'act', tokens: 200_000 })
})

test('decide: a window that is small against the threshold lowers it to 80 percent', async () => {
  expect(kind({ window: 200_000, tokens: 159_999 })).toBe('none')
  expect(kind({ window: 200_000, tokens: 160_000 })).toBe('act')
  // 80 percent of 200001 is 160000.8: rounded down, 160000 already counts.
  expect(kind({ window: 200_001, tokens: 160_000 })).toBe('act')
})

test('decide: no reading of the context yet (fresh session, after /clear) is nothing', async () => {
  expect(kind({ tokens: undefined })).toBe('none')
})

const over = { tokens: 250_000 }

test('decide: running work at the threshold defers the handoff, each kind under its own name', async () => {
  expect(decide({ ...quiet, ...over, backgroundTasks: 1 }, live)).toEqual({ kind: 'defer', reason: 'background-task', tokens: 250_000 })
  expect(decide({ ...quiet, ...over, oneShotTimers: 1 }, live)).toEqual({ kind: 'defer', reason: 'one-shot-timer', tokens: 250_000 })
  expect(decide({ ...quiet, ...over, subagents: 1 }, live)).toEqual({ kind: 'defer', reason: 'subagent', tokens: 250_000 })
})

test('decide: with several kinds running the subagent is named first, then the background task', async () => {
  const both = { ...quiet, ...over, backgroundTasks: 2, oneShotTimers: 1 }
  expect(decide(both, live)).toMatchObject({ reason: 'background-task' })
  expect(decide({ ...both, subagents: 1 }, live)).toMatchObject({ reason: 'subagent' })
})

test('decide: below the threshold running work is nothing to report', async () => {
  expect(kind({ tokens: 100_000, backgroundTasks: 1, oneShotTimers: 1, subagents: 1 })).toBe('none')
})

test('decide: the emergency brake hands over despite running work at threshold + 150k, naming what it overrode', async () => {
  expect(kind({ tokens: 349_999, backgroundTasks: 1 })).toBe('defer')
  expect(decide({ ...quiet, tokens: 350_000, backgroundTasks: 1 }, live)).toEqual({ kind: 'act', tokens: 350_000, forced: 'background-task' })
  expect(decide({ ...quiet, tokens: 350_000, subagents: 1, oneShotTimers: 1 }, live)).toEqual({ kind: 'act', tokens: 350_000, forced: 'subagent' })
})

test('decide: the emergency brake stays within 90 percent of the window', async () => {
  // 200k window: threshold 160k, +150k would be 310k, 90 percent is 180k.
  expect(kind({ window: 200_000, tokens: 179_999, subagents: 1 })).toBe('defer')
  expect(kind({ window: 200_000, tokens: 180_000, subagents: 1 })).toBe('act')
  // 90 percent of 200001 is 180000.9.
  expect(kind({ window: 200_001, tokens: 180_000, subagents: 1 })).toBe('act')
})

test('decide: the emergency brake counts from the threshold in force, not from the setting', async () => {
  // 2M window, setting 1.7M: threshold in force 1.6M, brake at 1.75M; from the setting it would be 1.8M.
  const config = { ...live, threshold: 1_700_000 }
  expect(kind({ window: 2_000_000, tokens: 1_749_999, subagents: 1 }, config)).toBe('defer')
  expect(kind({ window: 2_000_000, tokens: 1_750_000, subagents: 1 }, config)).toBe('act')
})

// A handover moved back by `later`: asked at `from`, to hand over at `until`.
const movedTo = (until: number, from = 100_000) => ({ later: { from, until } })

test('thresholdInForce: the threshold in force with no later, else the later one, kept between it and the emergency brake', async () => {
  const table: [number, number, { from: number; until: number } | undefined, number][] = [
    [200_000, 1_000_000, undefined, 200_000],
    [200_000, 200_000, undefined, 160_000],
    [200_000, 1_000_000, { from: 190_000, until: 250_000 }, 250_000],
    // Past the brake (threshold 200k + 150k) it is the brake.
    [200_000, 1_000_000, { from: 190_000, until: 500_000 }, 350_000],
    // A smaller window after the command: its brake is 180k, never a value above it or above the window.
    [200_000, 200_000, { from: 150_000, until: 300_000 }, 180_000],
    // A larger window after the command raises the threshold to 200k: the later one never brings a handover forward.
    [200_000, 1_000_000, { from: 150_000, until: 180_000 }, 200_000],
  ]
  for (const [threshold, window, later, expected] of table)
    expect([threshold, window, later, thresholdInForce(threshold, window, later)]).toEqual([threshold, window, later, expected])
})

test('decide: a later handover is judged at its own value, not at the threshold', async () => {
  expect(kind({ tokens: 249_999, ...movedTo(250_000) })).toBe('none')
  expect(decide({ ...quiet, tokens: 250_000, ...movedTo(250_000) }, live)).toEqual({ kind: 'act', tokens: 250_000 })
  // Work running past it defers as at the threshold.
  expect(kind({ tokens: 260_000, subagents: 1, ...movedTo(250_000) })).toBe('defer')
})

test('decide: a later handover is capped at the brake of the window at the time it is judged', async () => {
  // Asked in a 1M window, judged in a 200k one: threshold 160k, brake 180k.
  expect(kind({ window: 200_000, tokens: 179_999, ...movedTo(300_000) })).toBe('none')
  expect(kind({ window: 200_000, tokens: 180_000, ...movedTo(300_000) })).toBe('act')
})

test('decide: a later handover below a threshold that a larger window raised does not bring the handover forward', async () => {
  expect(kind({ tokens: 190_000, ...movedTo(180_000, 150_000) })).toBe('none')
  expect(kind({ tokens: 200_000, ...movedTo(180_000, 150_000) })).toBe('act')
})

test('decide: the emergency brake hands over despite running work, a later handover or not, at threshold + 150k', async () => {
  expect(kind({ tokens: 349_999, subagents: 1, ...movedTo(300_000) })).toBe('defer')
  expect(decide({ ...quiet, tokens: 350_000, subagents: 1, ...movedTo(300_000) }, live)).toEqual({ kind: 'act', tokens: 350_000, forced: 'subagent' })
  expect(decide({ ...quiet, tokens: 350_000, subagents: 1, ...movedTo(900_000) }, live)).toEqual({ kind: 'act', tokens: 350_000, forced: 'subagent' })
})

test('laterAt: a context below where later was asked ends it; no reading of the context, or one at or above, keeps it', async () => {
  const later = { from: 190_000, until: 250_000 }
  expect(laterAt(later, 189_999)).toBeUndefined()
  expect(laterAt(later, 62_000)).toBeUndefined()
  expect(laterAt(later, 190_000)).toEqual(later)
  expect(laterAt(later, 240_000)).toEqual(later)
  expect(laterAt(later, undefined)).toEqual(later)
  expect(laterAt(undefined, 100_000)).toBeUndefined()
})

const MINUTE = 60_000
// The last attempt, this long and this many turns ago.
const attempt = (minutes: number, turns: number) => ({ at: quiet.now - minutes * MINUTE, turns: quiet.turns - turns })

test('decide: a recent attempt defers the next handoff until the minutes or the turns of the gap have passed, whichever comes first', async () => {
  const at = { tokens: 250_000 }
  expect(decide({ ...quiet, ...at, lastAttempt: attempt(1, 1) }, live)).toEqual({ kind: 'defer', reason: 'min-gap', tokens: 250_000 })
  // 10 minutes and 5 turns: the edge counts as passed on each side.
  expect(kind({ ...at, lastAttempt: attempt(9.99, 4) })).toBe('defer')
  expect(kind({ ...at, lastAttempt: attempt(10, 4) })).toBe('act')
  expect(kind({ ...at, lastAttempt: attempt(9.99, 5) })).toBe('act')
  expect(kind({ ...at, lastAttempt: attempt(60, 50) })).toBe('act')
})

test('decide: the gap is the one of the settings, and a 0 in either lifts it', async () => {
  const at = { tokens: 250_000, lastAttempt: attempt(0, 0) }
  expect(kind(at, { ...live, minGapMinutes: 30, minGapTurns: 20 })).toBe('defer')
  expect(kind({ ...at, lastAttempt: attempt(29, 1) }, { ...live, minGapMinutes: 30, minGapTurns: 20 })).toBe('defer')
  expect(kind({ ...at, lastAttempt: attempt(31, 1) }, { ...live, minGapMinutes: 30, minGapTurns: 20 })).toBe('act')
  expect(kind({ ...at, lastAttempt: attempt(1, 19) }, { ...live, minGapMinutes: 30, minGapTurns: 20 })).toBe('defer')
  expect(kind({ ...at, lastAttempt: attempt(1, 20) }, { ...live, minGapMinutes: 30, minGapTurns: 20 })).toBe('act')
  expect(kind(at, { ...live, minGapMinutes: 0, minGapTurns: 0 })).toBe('act')
  expect(kind(at, { ...live, minGapMinutes: 0, minGapTurns: 20 })).toBe('act')
  expect(kind(at, { ...live, minGapMinutes: 30, minGapTurns: 0 })).toBe('act')
})

test('decide: no attempt before is no gap, and under the threshold a gap is nothing to report', async () => {
  expect(kind({ tokens: 250_000, lastAttempt: undefined })).toBe('act')
  expect(kind({ tokens: 100_000, lastAttempt: attempt(0, 0) })).toBe('none')
})

test('decide: the emergency brake does not lift the gap', async () => {
  expect(decide({ ...quiet, tokens: 400_000, subagents: 1, lastAttempt: attempt(1, 1) }, live)).toEqual({ kind: 'defer', reason: 'min-gap', tokens: 400_000 })
})

test('decide: running work is named before the gap', async () => {
  expect(decide({ ...quiet, tokens: 250_000, subagents: 1, lastAttempt: attempt(1, 1) }, live)).toMatchObject({ reason: 'subagent' })
})

test('decide: in dry-run mode a handoff is reported as one that would happen, with the size of the context, and the rest stays as it is', async () => {
  const dry = { ...DEFAULTS, dryRun: true }
  expect(decide({ ...quiet, tokens: 250_000 }, dry)).toEqual({ kind: 'dry-run', tokens: 250_000 })
  expect(decide({ ...quiet, tokens: 400_000, subagents: 1 }, dry)).toEqual({ kind: 'dry-run', tokens: 400_000, forced: 'subagent' })
  expect(decide({ ...quiet, tokens: 250_000, subagents: 1 }, dry)).toMatchObject({ kind: 'defer', reason: 'subagent' })
  expect(decide({ ...quiet, tokens: 250_000, lastAttempt: attempt(1, 1) }, dry)).toMatchObject({ kind: 'defer', reason: 'min-gap' })
  expect(decide({ ...quiet, tokens: 100_000 }, dry)).toEqual({ kind: 'none' })
})

test('activeTasks: every background task counts that is not in a final state', async () => {
  const table: [string, number][] = [
    ['running', 1],
    ['pending', 1],
    ['something-new', 1],
    ['completed', 0],
    ['failed', 0],
    ['killed', 0],
    ['stopped', 0],
    ['cancelled', 0],
    ['canceled', 0],
    ['error', 0],
  ]
  for (const [status, expected] of table) expect([status, activeTasks([{ status }])]).toEqual([status, expected])
  expect(activeTasks([{ status: 'running' }, { status: 'completed' }, { status: 'running' }])).toBe(2)
  expect(activeTasks(undefined)).toBe(0)
})

test('oneShots: a timer that fires once counts, a recurring one does not', async () => {
  expect(oneShots([{ recurring: false }, { recurring: true }, { recurring: false }])).toBe(2)
  expect(oneShots([{ recurring: true }])).toBe(0)
  expect(oneShots(undefined)).toBe(0)
})

test('reportOf: every line names the context size', async () => {
  const table: [Parameters<typeof reportOf>[0], Parameters<typeof reportOf>[1], string][] = [
    [{ kind: 'defer', reason: 'subagent', tokens: 201_000 }, 'internal-handoff', 'handoff postponed, a subagent is running, context 201000 tokens'],
    [{ kind: 'defer', reason: 'background-task', tokens: 1 }, 'external-command', 'handoff postponed, a background task is running, context 1 tokens'],
    [{ kind: 'defer', reason: 'one-shot-timer', tokens: 2 }, 'internal-handoff', 'handoff postponed, a timer that fires once is set, context 2 tokens'],
    [
      { kind: 'defer', reason: 'min-gap', tokens: 3 },
      'external-command',
      'handoff postponed, the minimum gap since the last attempt has not passed, context 3 tokens',
    ],
    [{ kind: 'defer', reason: 'subagent', tokens: 201_000 }, 'builtin-compact', 'compact postponed, a subagent is running, context 201000 tokens'],
    [
      { kind: 'defer', reason: 'min-gap', tokens: 3 },
      'builtin-compact',
      'compact postponed, the minimum gap since the last attempt has not passed, context 3 tokens',
    ],
    [{ kind: 'dry-run', tokens: 210_000 }, 'internal-handoff', 'dry run, would hand over now, context 210000 tokens'],
    [{ kind: 'dry-run', tokens: 210_000 }, 'builtin-compact', 'dry run, would compact now, context 210000 tokens'],
    [
      { kind: 'dry-run', tokens: 360_000, forced: 'one-shot-timer' },
      'external-command',
      'dry run, would hand over now, context 360000 tokens, although a timer that fires once is set (emergency brake)',
    ],
    [{ kind: 'act', tokens: 210_000 }, 'external-command', 'handing over now, context 210000 tokens'],
    [{ kind: 'act', tokens: 210_000 }, 'builtin-compact', 'compacting now, context 210000 tokens'],
    [
      { kind: 'act', tokens: 360_000, forced: 'subagent' },
      'internal-handoff',
      'handing over now, context 360000 tokens, although a subagent is running (emergency brake)',
    ],
    [
      { kind: 'act', tokens: 360_000, forced: 'subagent' },
      'builtin-compact',
      'compacting now, context 360000 tokens, although a subagent is running (emergency brake)',
    ],
  ]
  for (const [decision, method, text] of table) expect([method, reportOf(decision, method)]).toEqual([method, text])
})

test('handoffPath: the path comes from the HANDOFF_PATH line, the last one when an answer has several', async () => {
  const table: [string, string | undefined][] = [
    ['Done.\nHANDOFF_PATH: /var/folders/x/T/handoff-1.md', '/var/folders/x/T/handoff-1.md'],
    ['HANDOFF_PATH: /tmp/a.md\nmore\nHANDOFF_PATH: /tmp/b.md\n', '/tmp/b.md'],
    ['HANDOFF_PATH:/tmp/a.md', '/tmp/a.md'],
    ['  HANDOFF_PATH:   /tmp/a.md   \n\n', '/tmp/a.md'],
    ['HANDOFF_PATH: `/tmp/a.md`', '/tmp/a.md'],
    ['**HANDOFF_PATH: /tmp/a.md**', '/tmp/a.md'],
    ['HANDOFF_PATH: "/tmp/with space/a.md"', '/tmp/with space/a.md'],
    ['HANDOFF_PATH: C:\\Temp\\a.md', 'C:\\Temp\\a.md'],
    ['no such line', undefined],
    ['', undefined],
    ['handoff_path: /tmp/a.md', undefined],
  ]
  for (const [answer, expected] of table) expect([answer, handoffPath(answer)]).toEqual([answer, expected])
})

// A path the answer names is read by the mod: it must be a markdown file at an absolute location, and must not climb.
test('handoffPath: a path that is relative, not markdown or climbing is no path, and an earlier valid line still counts', async () => {
  const table: [string, string | undefined][] = [
    ['HANDOFF_PATH: notes/a.md', undefined],
    ['HANDOFF_PATH: ./a.md', undefined],
    ['HANDOFF_PATH: /tmp/a.txt', undefined],
    ['HANDOFF_PATH: /tmp/a.md.', '/tmp/a.md'],
    ['HANDOFF_PATH: /tmp/../etc/a.md', undefined],
    ['HANDOFF_PATH: /tmp/..\\etc/a.md', undefined],
    ['HANDOFF_PATH: <absolute path>', undefined],
    ['HANDOFF_PATH: /tmp/a.md\nHANDOFF_PATH: nonsense', '/tmp/a.md'],
  ]
  for (const [answer, expected] of table) expect([answer, handoffPath(answer)]).toEqual([answer, expected])
})

test('ASK_FOR_PATH: asks for the line handoffPath reads, and an answer that only repeats the request names no path', async () => {
  expect(ASK_FOR_PATH).toContain('HANDOFF_PATH: <absolute path>')
  expect(handoffPath(ASK_FOR_PATH)).toBeUndefined()
  expect(handoffPath(`${ASK_FOR_PATH}\nHANDOFF_PATH: /tmp/h.md`)).toBe('/tmp/h.md')
})

// The mod hands over at a size limit, so often in the middle of a task: the handoff has to carry what that task needs, whichever way it is written.
test('the handoff request and the internal handoff prompt both say the work may be in the middle of a task and ask for what it needs', async () => {
  for (const request of [ASK_FOR_PATH, DEFAULT_PROMPT]) {
    expect(request).toContain('middle of a task')
    expect(request).toContain('files')
  }
})

test('newestHandoff: the newest handoff file from the time the command started on, by name', async () => {
  const f = (name: string, mtimeMs: number, kind: 'file' | 'dir' = 'file') => ({ name, kind, size: 1, mtimeMs, isLink: false })
  const entries = [
    f('handoff-old.md', 100),
    f('handoff-a.md', 200),
    f('handoff-b.md', 300),
    f('handoff-dir.md', 900, 'dir'),
    f('notes.md', 800),
    f('handoff-b.txt', 700),
  ]
  expect(newestHandoff(entries, 150)).toBe('handoff-b.md')
  expect(newestHandoff(entries, 300)).toBe('handoff-b.md')
  expect(newestHandoff(entries, 301)).toBeUndefined()
  expect(newestHandoff([], 0)).toBeUndefined()
})

test('firstMessage: the handoff leads, with a line that says what it is and asks to go on', async () => {
  expect(firstMessage('the notes')).toBe('Handoff from the previous session. Read it and carry on with the next step.\n\nthe notes')
})

test('modelForkFailure: each reason an internal handoff gives nothing is said in words, an unknown one as it is', async () => {
  expect(modelForkFailure({ isAnswered: false, reason: 'nothing-to-fork' })).toBe('there is no conversation yet to write a handoff from')
  expect(modelForkFailure({ isAnswered: false, reason: 'api-error', status: 529 })).toBe('the API failed (status 529)')
  expect(modelForkFailure({ isAnswered: false, reason: 'api-error', status: null })).toBe('the API failed')
  expect(modelForkFailure({ isAnswered: false, reason: 'empty-reply' })).toBe('the model replied with nothing')
  expect(modelForkFailure({ isAnswered: false, reason: 'aborted' })).toBe('writing the handoff was aborted')
  expect(modelForkFailure({ isAnswered: false, reason: 'timeout' })).toBe('the model did not answer within 3 minutes')
  expect(modelForkFailure({ isAnswered: false, reason: 'something-new' })).toBe('something-new')
})

test('modelForkKind: a reason said in words is a kind of its own, any other one is other', async () => {
  for (const reason of ['nothing-to-fork', 'api-error', 'empty-reply', 'aborted', 'timeout']) {
    const answer = { isAnswered: false as const, reason }
    expect(modelForkFailure(answer)).not.toBe(reason)
    expect(modelForkKind(answer)).toBe(reason)
  }
  for (const reason of ['something-new', 'toString', 'constructor']) {
    const answer = { isAnswered: false as const, reason }
    expect(modelForkFailure(answer)).toBe(reason)
    expect(modelForkKind(answer)).toBe('other')
  }
})

test('promptPath: the prompt file lives under ~/.claude, whether the home directory ends in a slash or not', async () => {
  expect(promptPath('/home/me')).toBe('/home/me/.claude/sweet-spot/handoff-prompt.md')
  expect(promptPath('/home/me/')).toBe('/home/me/.claude/sweet-spot/handoff-prompt.md')
})

test('promptFrom: a prompt file with text is the prompt, trimmed; nothing readable, a blank or a non-text leaves the default', async () => {
  expect(promptFrom('  Write it in German.\n')).toBe('Write it in German.')
  for (const file of [undefined, null, '', ' \n\t', 42, {}]) expect(promptFrom(file)).toBe(DEFAULT_PROMPT)
})

// What the next session needs to carry on; the internal handoff is told to keep all of it.
test('DEFAULT_PROMPT: asks for goal, state, decisions, failed attempts, next step, open questions and the end of the conversation, in about 4 to 6 thousand characters', async () => {
  for (const part of ['Goal', 'State', 'Decisions', 'failed', 'Next step', 'Open questions', 'word for word', '4,000 to 6,000 characters']) {
    expect(DEFAULT_PROMPT).toContain(part)
  }
})

// The text becomes the first message of the fresh session and so stays in its transcript; the skills are what the internal handoff can name from the history.
test('DEFAULT_PROMPT: asks to redact secrets and to name the skills the next session should call', async () => {
  expect(DEFAULT_PROMPT).toContain('Redact')
  expect(DEFAULT_PROMPT).toContain('Suggested skills')
})

test('Pairing: a stop and the end of its turn are judged once both are in, in either order, and the stop only once', async () => {
  const stop = { background_tasks: [{ status: 'running' }] }
  const early = freshPairing()
  stopSeen(early, stop)
  expect(judgeable(early)).toEqual({ waitingFor: 'the end of the turn' })
  endSeen(early, 'answer')
  expect(judgeable(early)).toEqual({ stop, end: 'answer' })
  expect(judgeable(early)).toEqual({ waitingFor: 'the stop' })

  const late = freshPairing()
  endSeen(late, 'aborted')
  expect(judgeable(late)).toEqual({ waitingFor: 'the stop' })
  stopSeen(late, stop)
  expect(judgeable(late)).toEqual({ stop, end: 'aborted' })
})

test('Pairing: the start of a turn forgets a stop and an end that were never paired', async () => {
  const p = freshPairing()
  stopSeen(p, {})
  endSeen(p, 'error')
  turnStarted(p)
  expect(p).toEqual(freshPairing())
})
