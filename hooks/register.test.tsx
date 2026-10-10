import { test, expect, mock } from 'claude-code/testing'

import { endTurn, hostWith, pause, sessionWith, startSession, startTurn, stop, withMod, MINUTE, DRY_RUN } from './test-support'

// No `options`: the plugin gets the defaults of plugin.json. The values are typed on purpose, so the test falls when plugin.json and
// config.ts differ, or when either changes alone. The host checks type and `min` of plugin.json before the mod loads; a test cannot
// get a number below the minimum past it, so those rejections are tested on `configOf` directly. The settings line shows from `info` on,
// so the log level is set: without it the test would check nothing.
const SETTINGS = 'info: settings: threshold 200000, dry_run off, min gap 10 minutes and 5 turns, handoff command none, log level info'

test('the settings the mod runs with are the defaults of plugin.json', async ($, on) => {
  const seen = withMod(on)
  hostWith(on, { logLevel: 'info' })
  await startSession($)
  expect(seen.logs).toEqual([SETTINGS])
  expect(seen.toasts).toEqual([])
  expect(seen.debug).toEqual([])
})

test(
  'settings the host lets through but the mod rejects are reported loudly, and the mod runs with none',
  { options: { handoff_command: '/handoff' } },
  async ($, on) => {
    const seen = withMod(on)
    await startSession($)
    const text = 'off: handoff_command: "/handoff" starts with a slash, give the name without it'
    expect(seen.toasts).toEqual([text])
    expect(seen.logs).toEqual([text])
    expect(seen.debug).toEqual([])
  },
)

test(
  'settings that are set show in the same line',
  { options: { threshold: 150_000, dry_run: false, min_gap_minutes: 0, min_gap_turns: 2, handoff_command: 'claude-mem:handoff' } },
  async ($, on) => {
    const seen = withMod(on)
    hostWith(on, { logLevel: 'info' })
    await startSession($)
    expect(seen.logs).toEqual([
      'info: settings: threshold 150000, dry_run off, min gap 0 minutes and 2 turns, handoff command "claude-mem:handoff", log level info',
    ])
  },
)

// A changed setting or a hot reload loads the mod into a session that is already running: no session starts, and the person has to see
// that the new values are in force.
test('a mod loaded into a running session says its settings at the first turn, once', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, { logLevel: 'info' })
  await startTurn($)
  await startTurn($)
  expect(seen.logs).toEqual([SETTINGS])
})

test('a session that starts says its settings once, not again at its first turn', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, { logLevel: 'info' })
  await startSession($)
  await startTurn($)
  expect(seen.logs).toEqual([SETTINGS])
})

const DRY = (tokens: number) => `dry run, would hand over now, context ${tokens} tokens`

test('a stop of the main session past the threshold says it would hand over, with the context size', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 212_345 })
  await startSession($)
  await pause($)
  expect(seen.toasts).toEqual([DRY(212_345)])
  expect(seen.logs).toEqual([DRY(212_345)])
})

test('a stop below the threshold, or in a session with no size yet, says nothing', async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { tokens: 199_999 })
  await startSession($)
  await pause($)
  world.tokens = undefined
  await pause($)
  expect([seen.toasts, seen.logs]).toEqual([[], []])
})

test('the stop of a subagent never triggers, and does not even look at the session', async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await stop($, { agent_id: 'a1' })
  expect([seen.toasts, seen.logs, world.reads]).toEqual([[], [], []])
})

test('a stop after an interrupted, failed or refused turn never triggers; the next answer does', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  for (const reason of ['aborted', 'error', 'refusal'] as const) {
    await startTurn($)
    await endTurn($, reason)
    await stop($)
  }
  expect([seen.toasts, seen.logs]).toEqual([[], []])
  await startTurn($)
  await endTurn($, 'answer')
  await stop($)
  expect(seen.toasts).toEqual([DRY(210_000)])
})

test(
  'a turn that begins clears what the turn before ended with, so a stop that comes before its turn.complete is not held back by it',
  DRY_RUN,
  async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    await startSession($)
    await startTurn($)
    await endTurn($, 'aborted')
    await startTurn($)
    await stop($)
    await endTurn($, 'answer')
    expect(seen.toasts).toEqual([DRY(210_000)])
  },
)

test('the end of a subagent turn is not the end of the main turn', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  await startTurn($)
  await endTurn($, 'aborted', { agentId: 'a1' })
  await stop($)
  expect(seen.toasts).toEqual([])
  await endTurn($, 'answer')
  expect(seen.toasts).toEqual([DRY(210_000)])
})

const tasks = (...statuses: string[]) => statuses.map(status => ({ id: 'b', type: 'shell', status, description: 'build' }))

test('running work postpones the handoff, said once with the context size, and the handoff follows when the work is done', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 230_000 })
  await startSession($)
  await pause($, { background_tasks: tasks('running') })
  await pause($, { background_tasks: tasks('running', 'completed') })
  const postponed = 'handoff postponed, a background task is running, context 230000 tokens'
  expect(seen.toasts).toEqual([postponed])
  expect(seen.logs).toEqual([postponed])
  await pause($, { background_tasks: tasks('completed', 'failed', 'killed') })
  expect(seen.toasts).toEqual([postponed, DRY(230_000)])
})

test('a subagent that is running and a timer that fires once postpone it, a recurring timer does not', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  world.agents = [{ status: 'running' }]
  await pause($)
  world.agents = [{ status: 'completed' }]
  await pause($, { session_crons: [{ recurring: true }] })
  await world.clock.advance(11 * MINUTE)
  await pause($, { session_crons: [{ recurring: false }] })
  expect(seen.logs).toEqual([
    'handoff postponed, a subagent is running, context 210000 tokens',
    DRY(210_000),
    'handoff postponed, a timer that fires once is set, context 210000 tokens',
  ])
})

test('the emergency brake hands over despite running work, and says what it overrode', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 350_000 })
  await startSession($)
  await pause($, { background_tasks: tasks('running') })
  expect(seen.logs).toEqual([`${DRY(350_000)}, although a background task is running (emergency brake)`])
})

test('a window that is small against the threshold lowers it', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 160_000, window: 200_000 })
  await startSession($)
  await pause($)
  expect(seen.logs).toEqual([DRY(160_000)])
})

test('after a dry run the next stop waits for the gap, ended by the minutes or by the turns', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await pause($)
  world.turns += 4
  await world.clock.advance(9 * MINUTE)
  await pause($)
  const gap = 'handoff postponed, the minimum gap since the last attempt has not passed, context 210000 tokens'
  expect(seen.logs).toEqual([DRY(210_000), gap])
  await world.clock.advance(MINUTE)
  await pause($)
  expect(seen.logs).toEqual([DRY(210_000), gap, DRY(210_000)])
  world.turns += 5
  await pause($)
  expect(seen.logs).toEqual([DRY(210_000), gap, DRY(210_000), DRY(210_000)])
})

test('a count of turns that starts over, as after /clear, does not hold the gap for good: the minutes end it', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { turns: 40 })
  await startSession($)
  await pause($)
  world.turns = 2
  await world.clock.advance(2 * MINUTE)
  await pause($)
  expect(seen.logs).toHaveLength(2)
  expect(seen.logs[1]).toContain('postponed, the minimum gap')
  await world.clock.advance(8 * MINUTE)
  await pause($)
  expect(seen.logs).toEqual([DRY(210_000), seen.logs[1], DRY(210_000)])
})

test('with the dry run off the due handoff is announced as it starts', { options: { dry_run: false } }, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on)
  await startSession($)
  await pause($)
  expect(seen.logs).toEqual(['handing over now, context 210000 tokens'])
})

test('a stop does not act on settings the mod rejected', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  const before = seen.logs.length
  await stop($)
  expect([seen.logs.length - before, world.reads]).toEqual([0, []])
})

test('a stop that another hook answers with a request to go on is no pause', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { block: 'keep going' })
  await startSession($)
  await stop($)
  expect(seen.logs).toEqual([])
})
