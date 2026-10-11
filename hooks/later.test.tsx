import { expect } from 'claude-code/testing'

import {
  answered,
  COMPACT_DONE,
  COMPACT_ONLY,
  endTurn,
  hostWith,
  LIVE,
  pause,
  raiseHandoff,
  reachThreshold,
  runRelay,
  sessionWith,
  startSession,
  startTurn,
  withMod,
  type SessionWorld,
  type TestEngine,
  modTest,
} from './test-support'

// `/sweet-spot later` moves the next handover back until the context has grown by the given number of tokens past where it is now. The
// window is 1000000 tokens unless a test says otherwise: threshold 200000, emergency brake 350000.

// A dry run with no gap: every pause from the value in force on says it would hand over, and nothing else happens.
const DRY = { options: { dry_run: true, min_gap_minutes: 0, min_gap_turns: 0 } }
const NO_GAP_LIVE = { options: { ...LIVE.options, min_gap_minutes: 0, min_gap_turns: 0 } }

const wouldHandOver = (tokens: number) => `dry run, would hand over now, context ${tokens} tokens`
const accepted = (at: number, context: number) => `hands over at ${at} tokens instead of 200000, for this handover only, context ${context} tokens`

// An answer ends at this context size: a pause.
const pauseAt = async ($: TestEngine, world: SessionWorld, tokens: number | undefined) => {
  world.tokens = tokens
  await startTurn($)
  await pause($)
}

const later = async ($: TestEngine, world: SessionWorld, tokens: number, args: string) => {
  world.tokens = tokens
  return answered(runRelay($, args))
}

modTest('later with a number moves the handover back that far from the context now, and says the value', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 190_000, 'later 50000')).toBe(accepted(240_000, 190_000))
  expect(await later($, world, 190_000, 'later 60k')).toBe(accepted(250_000, 190_000))
  expect(await later($, world, 190_000, 'later 70K')).toBe(accepted(260_000, 190_000))
  expect(await later($, world, 190_000, '  later   80k  ')).toBe(accepted(270_000, 190_000))
})

modTest('later reads a leading zero as part of the number', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 199_990, 'later 0100')).toBe(accepted(200_090, 199_990))
})

modTest('later with no number takes later_tokens', { options: { ...LIVE.options, later_tokens: 40_000 } }, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 190_000, 'later')).toBe(accepted(230_000, 190_000))
})

modTest('later with no number takes 25000 by default', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 190_000, 'later')).toBe(accepted(215_000, 190_000))
})

modTest('in a dry run later says what it would do', DRY, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 190_000, 'later 50k')).toBe(
    'dry run, would hand over at 240000 tokens instead of 200000, for this handover only, context 190000 tokens',
  )
})

modTest('the handover comes at the value later asked for, not at the threshold, and the next one at the threshold again', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 190_000, 'later 50k')
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 239_999)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 240_000)
  expect(seen.toasts).toEqual([wouldHandOver(240_000)])
  // Spent: a context between the threshold and the old value is a handover again.
  await pauseAt($, world, 239_000)
  expect(seen.toasts).toEqual([wouldHandOver(240_000), wouldHandOver(239_000)])
})

modTest('later past the emergency brake is capped there, and says so', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 300_000, 'later 100k')).toBe(
    'hands over at 350000 tokens instead of 200000, for this handover only, capped at the emergency brake, context 300000 tokens',
  )
})

modTest('a smaller window after later caps it at the brake of that window', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 150_000, 'later 150k')
  // A 200000 window: threshold 160000, brake 180000. Uncapped, 300000 would lie past the window.
  world.window = 200_000
  await pauseAt($, world, 170_000)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 180_000)
  expect(seen.toasts).toEqual([wouldHandOver(180_000)])
})

modTest('the emergency brake hands over while work runs, later or not', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 300_000, 'later 100k')
  world.agents = [{ status: 'running' }]
  await pauseAt($, world, 349_999)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 350_000)
  expect(seen.toasts).toEqual([`${wouldHandOver(350_000)}, although a subagent is running (emergency brake)`])
})

modTest('a context below where later was asked ends it at the next pause; a pause with no size changes nothing', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 190_000, 'later 50k')
  await pauseAt($, world, undefined)
  await pauseAt($, world, 210_000)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 100_000)
  await pauseAt($, world, 210_000)
  expect(seen.toasts).toEqual([wouldHandOver(210_000)])
})

modTest('a pause that postpones for running work keeps later', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 190_000, 'later 50k')
  world.agents = [{ status: 'running' }]
  await pauseAt($, world, 245_000)
  world.agents = []
  await pauseAt($, world, 230_000)
  expect(seen.toasts).toEqual(['handoff postponed, a subagent is running, context 245000 tokens'])
})

modTest('a handover that fails still spends later: the next one comes at the threshold', NO_GAP_LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [] })
  await startSession($)
  await later($, world, 190_000, 'later 50k')
  await pauseAt($, world, 240_000)
  await world.clock.settle()
  expect(seen.toasts.filter(t => t.startsWith('handover failed'))).toHaveLength(1)
  await pauseAt($, world, 230_000)
  expect(seen.toasts.at(-1)).toBe('handing over now, context 230000 tokens')
})

modTest('a context that shrank without a pause ends later when the command is typed', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 185_000, 'later 50k')
  // A compact, then a turn that ended without an answer: no pause, but the context is read again.
  await startTurn($)
  await endTurn($, 'aborted')
  expect(await later($, world, 100_000, 'later 50k')).toBe('already hands over at 200000 tokens, context 100000 tokens')
  expect(await later($, world, 100_000, 'later 120k')).toBe(accepted(220_000, 100_000))
})

modTest('a second later that moves further sets the value anew, from the context now', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 180_000, 'later 50k')
  expect(await later($, world, 185_000, 'later 50k')).toBe(
    'dry run, would hand over at 235000 tokens instead of 200000, for this handover only, context 185000 tokens',
  )
  await pauseAt($, world, 234_999)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 235_000)
  expect(seen.toasts).toEqual([wouldHandOver(235_000)])
})

modTest(
  'a compact that was not enough is still found out against the threshold, not against later',
  { options: { ...COMPACT_ONLY.options, min_gap_minutes: 0, min_gap_turns: 0 } },
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { compact: COMPACT_DONE })
    await reachThreshold($, world)
    await later($, world, 205_000, 'later 50k')
    // Above the threshold after the compact: the compact was not enough, though the pause is below the value later asked for.
    await pauseAt($, world, 206_000)
    await pauseAt($, world, 255_000)
    await world.clock.settle()
    expect(host.steps).toEqual(['compact'])
    expect(seen.toasts.at(-1)).toMatch(/^handover failed, /)
  },
)

// Turned down: what was typed is named, and a later handover that holds stays as it was.
for (const args of [
  'later abc',
  'later -5',
  'later 0',
  'later 0k',
  'later 1.5k',
  'later 50 k',
  'later 50k extra',
  'later 50,000',
  'later 1e5',
  'later 10%',
  'later +5',
  'later 50kk',
]) {
  modTest(`"${args}" is turned down with what was typed, and later stays as it was`, DRY, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    await startSession($)
    await later($, world, 190_000, 'later 50k')
    const typed = args.slice('later '.length)
    expect(await later($, world, 195_000, args)).toBe(`"${typed}" is not a number of tokens, use /sweet-spot later <tokens>, e.g. later 50k`)
    await pauseAt($, world, 239_999)
    await pauseAt($, world, 240_000)
    expect(seen.toasts).toEqual([wouldHandOver(240_000)])
  })
}

const USAGE =
  'use `/sweet-spot later [tokens]` to move the next handover back, or `/sweet-spot redeliver` to submit again the handoff that did not reach the fresh session'

for (const args of ['LATER 50k', 'Later', 'later50k', 'laterx']) {
  modTest(`"${args}" is no later: the command tells what it does`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    await startSession($)
    expect(await later($, world, 190_000, args)).toBe(`unknown argument "${args}", ${USAGE}`)
  })
}

modTest('the menu and the help name both words', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  expect(seen.menu).toEqual([
    {
      name: 'sweet-spot',
      description: 'Move the next handover back, or submit again the handoff that did not reach the fresh session',
      argumentHint: 'redeliver | later [tokens]',
      immediate: true,
    },
  ])
  expect(await answered(runRelay($, ''))).toBe(USAGE)
})

modTest('a later that does not move the handover further back is turned down and leaves the one that holds', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 100_000, 'later 50k')).toBe('already hands over at 200000 tokens, context 100000 tokens')
  await later($, world, 180_000, 'later 50k')
  expect(await later($, world, 185_000, 'later 20k')).toBe('already hands over at 230000 tokens, context 185000 tokens')
  expect(await later($, world, 185_000, 'later 45k')).toBe('already hands over at 230000 tokens, context 185000 tokens')
  await pauseAt($, world, 229_999)
  await pauseAt($, world, 230_000)
  expect(seen.toasts).toEqual([wouldHandOver(230_000)])
})

modTest('at the emergency brake later is turned down; just below it, it is capped', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 350_000, 'later 10k')).toBe('already at the emergency brake, 350000 tokens, context 350000 tokens')
  expect(await later($, world, 360_000, 'later')).toBe('already at the emergency brake, 350000 tokens, context 360000 tokens')
  expect(await later($, world, 349_000, 'later 10k')).toBe(
    'hands over at 350000 tokens instead of 200000, for this handover only, capped at the emergency brake, context 349000 tokens',
  )
})

modTest('with settings it cannot trust the mod is off, and later says why', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await later($, world, 190_000, 'later 50k')).toBe('off: handoff_command: "/handoff" starts with a slash, give the name without it')
  expect(await later($, world, 190_000, 'later abc')).toBe('"abc" is not a number of tokens, use /sweet-spot later <tokens>, e.g. later 50k')
})

modTest('while a handover runs later is turned down', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  expect(await later($, world, 210_000, 'later 50k')).toBe('a handover is in progress, try again when it is done')
  await world.clock.settle()
})

modTest('a handover that starts while later reads the context turns later down, and the handover is not moved', NO_GAP_LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [] })
  await startSession($)
  // The pause that ends this answer comes while the command waits for its read of the context.
  world.during.usage = async () => {
    await startTurn($)
    await pause($)
  }
  expect(await later($, world, 210_000, 'later 50k')).toBe('a handover is in progress, try again when it is done')
  await world.clock.settle()
  expect(seen.toasts.filter(t => t.startsWith('handover failed'))).toHaveLength(1)
  await pauseAt($, world, 220_000)
  expect(seen.toasts.at(-1)).toBe('handing over now, context 220000 tokens')
})

modTest('a context that cannot be read turns later down with the reason, and later stays as it was', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later($, world, 190_000, 'later 50k')
  world.usageError = 'no usage'
  expect(await later($, world, 195_000, 'later 80k')).toBe('could not read the context size (no implementation for session.usage)')
  world.usageError = undefined
  await pauseAt($, world, 239_999)
  await pauseAt($, world, 240_000)
  expect(seen.toasts).toEqual([wouldHandOver(240_000)])
})

modTest('with no reading of the context yet later is turned down', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  world.tokens = undefined
  expect(await answered(runRelay($, 'later 50k'))).toBe('context size unknown, try again after the next answer')
})
