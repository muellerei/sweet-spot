import { test, expect } from 'claude-code/testing'

import { DEFAULTS } from './config'
import { ASK_FOR_PATH, firstMessage } from './handoff'
import { throughMethods, type Io } from './relay'
import { freshState } from './state'
import {
  COMPACT_DONE,
  COMPACT_VETO,
  COMPACTED,
  COMPACTING,
  commandTurnEnds,
  DUE,
  endTurn,
  failure,
  FILE,
  HANDED,
  hostWith,
  NOTES,
  reachThreshold,
  sessionWith,
  startSession,
  startTurn,
  stop,
  withMod,
  methods,
  ANSWERED,
  COMPACT_ONLY,
  pause,
} from './test-support'

// Claude Code's own /compact as a way to hand over: the session stays, only smaller, and nothing is cleared or submitted after it.

const HANDOFF_BY_MOD = firstMessage(ANSWERED.text)
const SKIPPED = 'compact was skipped (probe veto)'

test('compact as the main method compacts the session and clears and submits nothing', methods('builtin-compact', 'none'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['compact'])
  expect(host.store.size).toBe(0)
  expect(seen.logs).toEqual([COMPACTING, COMPACTED])
  expect(seen.toasts).toEqual([COMPACTING, COMPACTED])
})

// The host refuses a compact from inside the stop; the mod judges only when the stop and the end of the turn are both in.
test('compact is called after the end of the turn that raised it, not after the stop alone', methods('builtin-compact', 'none'), async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  await world.clock.settle()
  expect(host.steps).toEqual([])
  await endTurn($, 'answer', { turnId: 't1' })
  await world.clock.settle()
  expect(host.steps).toEqual(['compact'])
})

test('a compact the host refuses, as it does in a headless session, fails the handoff with the reason', methods('builtin-compact', 'none'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await reachThreshold($, world)
  expect(host.steps).toEqual(['compact'])
  expect(seen.logs[0]).toBe(COMPACTING)
  expect(seen.logs[1]).toMatch(/^handover failed, compact was refused \(/)
})

test('a compact a hook vetoes fails the handoff with the veto', methods('builtin-compact', 'none'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { compact: COMPACT_VETO })
  await reachThreshold($, world)
  expect(seen.logs).toEqual([COMPACTING, failure(SKIPPED)])
})

test('a refused or vetoed compact is followed by the fallback, which says why', methods('builtin-compact', 'internal-handoff'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, compact: COMPACT_VETO })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['compact', 'run clear', `submit ${HANDOFF_BY_MOD}`])
  expect(seen.logs).toEqual([COMPACTING, `the compact failed (${SKIPPED}), the mod writes the handoff instead`, HANDED])
})

test(
  'a failed internal handoff is followed by a compact as the fallback, and the message names the way that worked',
  methods('internal-handoff', 'builtin-compact'),
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { compact: COMPACT_DONE })
    await reachThreshold($, world)
    expect(host.steps).toEqual(['compact'])
    const why = 'the mod could not write the handoff: there is no conversation yet to write a handoff from'
    expect(seen.logs).toEqual([DUE, `the handoff the mod writes failed (${why}), compacting instead`, COMPACTED])
  },
)

test('a failed /clear of the main way is followed by a compact: it needs no /clear', methods('external-command', 'builtin-compact'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, failRun: ['clear'], compact: COMPACT_DONE })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([`run handoff ${ASK_FOR_PATH}`, 'run clear', 'compact'])
  const why = '/clear failed (no implementation for command.run), the session is as it was'
  expect(seen.logs).toEqual([DUE, `the handoff through the command failed (${why}), compacting instead`, COMPACTED])
})

test('both ways failing say both reasons, the compact last', methods('internal-handoff', 'builtin-compact'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await reachThreshold($, world)
  const first = 'the mod could not write the handoff: there is no conversation yet to write a handoff from'
  expect(seen.logs.at(-1)).toMatch(new RegExp(`^handover failed, ${first}; compact was refused \\(`))
})

test('the dry run says it would compact, and does nothing', { options: { dry_run: true, handoff_method: 'builtin-compact' } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await reachThreshold($, world)
  expect(host.steps).toEqual([])
  expect(seen.logs).toEqual(['dry run, would compact now, context 210000 tokens'])
})

test('a compact is held back by running work and by the minimum gap like any handoff', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  const pauseNow = async () => {
    await pause($)
    await world.clock.settle()
  }
  world.agents = [{ status: 'running' }]
  await pauseNow()
  expect(host.steps).toEqual([])
  world.agents = []
  await pauseNow()
  expect(host.steps).toEqual(['compact'])
  await pauseNow()
  expect(host.steps).toEqual(['compact'])
  expect(seen.logs).toEqual([
    'compact postponed, a subagent is running, context 210000 tokens',
    COMPACTING,
    COMPACTED,
    'compact postponed, the minimum gap since the last attempt has not passed, context 210000 tokens',
  ])
})

test('the emergency brake compacts despite running work, and says what it overrode', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { tokens: 350_000 })
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  world.agents = [{ status: 'running' }]
  await endTurn($, 'answer')
  await stop($)
  await world.clock.settle()
  expect(host.steps).toEqual(['compact'])
  expect(seen.logs[0]).toBe('compacting now, context 350000 tokens, although a subagent is running (emergency brake)')
})

// The engine hands the mod its own words for a refusal, so the host's wording for Esc cannot be set through the fake. The way is called with an
// `Io` of its own, and what the user presses is told from any other refusal by the words the host measured. If the host changes them,
// `docs/host-behaviour.md` is where the re-measuring is listed.
const compactWith = async (refusal: string) => {
  const asked: string[] = []
  const io = {
    now: async () => 0,
    log: () => {},
    tell: () => {},
    compact: async () => {
      throw new Error(refusal)
    },
    modelFork: async (prompt: string) => {
      asked.push(prompt)
      return { isAnswered: false, reason: 'nothing-to-fork' }
    },
  } as unknown as Io
  const config = { ...DEFAULTS, handoffMethod: 'builtin-compact' as const, handoffFallback: 'internal-handoff' as const }
  return { outcome: await throughMethods(io, freshState(), config), asked }
}

test('Esc during the compact is a cancel: no other way hands over after it', async () => {
  const { outcome, asked } = await compactWith('sweet-spot: $.session.compact: Compaction canceled.')
  expect(outcome.failure?.stage).toBe('cancelled')
  expect(asked).toEqual([])
})

test('any other refusal of the compact is a failure of its own stage, and the fallback takes over', async () => {
  const { outcome, asked } = await compactWith('sweet-spot: $.session.compact: not available in a headless session')
  expect(asked).toHaveLength(1)
  expect(outcome.failure?.stage).toBe('model-fork')
  expect(outcome.failure?.reason).toContain('compact was refused (sweet-spot: $.session.compact: not available in a headless session)')
})
