import { test, expect } from 'claude-code/testing'

import { checkOf, firstMethod } from './compact-check'
import { DEFAULTS } from './config'
import {
  COMPACT_DONE,
  COMPACT_VETO,
  COMPACTED,
  COMPACTING,
  DUE,
  hostWith,
  modelForkAnswer,
  sessionWith,
  startSession,
  withMod,
  HANDED,
  methods,
  pause,
} from './test-support'

// A compact that leaves the context above the threshold is not repeated at every pause: the next pause finds it out, and the compact is
// treated as a failed way until a pause is below the threshold again.

const NO_GAP = { min_gap_minutes: 0, min_gap_turns: 0 }
const ONLY = methods('builtin-compact', 'none', NO_GAP)
const WITH_FALLBACK = methods('builtin-compact', 'internal-handoff', NO_GAP)
const TOO_BIG = 'the last compact left the context above the threshold'

test('checkOf: the marker moves as the table says', async () => {
  const pending = { kind: 'pending' } as const
  const insufficient = { kind: 'insufficient', said: false } as const
  const said = { kind: 'insufficient', said: true } as const
  const table: [string, Parameters<typeof checkOf>[0], number | undefined, unknown][] = [
    ['nothing to check stays so, whatever the size', undefined, 250_000, undefined],
    ['a pause with no size changes nothing: pending', pending, undefined, pending],
    ['a pause with no size changes nothing: insufficient', said, undefined, said],
    ['pending, a size at the threshold: insufficient', pending, 200_000, insufficient],
    ['pending, a size above it: insufficient', pending, 250_000, insufficient],
    ['pending, a size below it: gone', pending, 199_999, undefined],
    ['insufficient, a size below it: gone', said, 150_000, undefined],
    ['insufficient, a size above it: stays, with its flag', said, 250_000, said],
  ]
  for (const [name, before, tokens, after] of table) expect([name, checkOf(before, tokens, 200_000)]).toEqual([name, after])
})

test('firstMethod: the main method, but the fallback where the main one is a compact that was not enough, and none where there is none', async () => {
  const config = (handoffMethod: string, handoffFallback: string) => ({ ...DEFAULTS, handoffMethod, handoffFallback }) as typeof DEFAULTS
  const insufficient = { compactCheck: { kind: 'insufficient', said: false } } as const
  const pending = { compactCheck: { kind: 'pending' } } as const
  const none = { compactCheck: undefined }
  expect(firstMethod(config('builtin-compact', 'none'), none)).toBe('builtin-compact')
  expect(firstMethod(config('builtin-compact', 'none'), pending)).toBe('builtin-compact')
  expect(firstMethod(config('builtin-compact', 'none'), insufficient)).toBeUndefined()
  expect(firstMethod(config('builtin-compact', 'internal-handoff'), insufficient)).toBe('internal-handoff')
  expect(firstMethod(config('internal-handoff', 'builtin-compact'), insufficient)).toBe('internal-handoff')
  expect(firstMethod(config('external-command', 'builtin-compact'), insufficient)).toBe('external-command')
})

const pauseAt = async ($: Parameters<typeof startSession>[0], world: ReturnType<typeof sessionWith>, tokens: number | undefined) => {
  world.tokens = tokens
  await pause($)
  await world.clock.settle()
}

test('a compact that left the context above the threshold is not repeated at the next pause, and the failure is said once', ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(host.steps).toEqual(['compact'])
  // No "compacting now" for a compact that will not run, and the failure once, not at every pause.
  expect(seen.logs).toEqual([COMPACTING, COMPACTED, `handover failed, ${TOO_BIG}`])
  expect(seen.toasts).toEqual(seen.logs)
})

test('a pause below the threshold lifts the mark: the next pause above it compacts again, and says the failure afresh', ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 120_000)
  await pauseAt($, world, 210_000)
  expect(host.steps).toEqual(['compact', 'compact'])
  await pauseAt($, world, 210_000)
  expect(seen.logs).toEqual([COMPACTING, COMPACTED, `handover failed, ${TOO_BIG}`, COMPACTING, COMPACTED, `handover failed, ${TOO_BIG}`])
})

test('a pause with no size does not decide whether the compact was enough', ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, undefined)
  await pauseAt($, world, 120_000)
  await pauseAt($, world, 210_000)
  expect(host.steps).toEqual(['compact', 'compact'])
  expect(seen.logs).toEqual([COMPACTING, COMPACTED, COMPACTING, COMPACTED])
})

test('with a fallback the second run takes the fallback, with the usual line and the reason', WITH_FALLBACK, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE, modelFork: modelForkAnswer('goal: finish') })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(host.steps.filter(s => s === 'compact')).toHaveLength(1)
  expect(host.steps.slice(-2)).toEqual(['run clear', expect.stringMatching(/^submit /)])
  expect(seen.logs).toEqual([COMPACTING, COMPACTED, DUE, `the compact failed (${TOO_BIG}), the mod writes the handoff instead`, HANDED])
})

test('a handoff into a fresh session lifts the mark: the next pause above the threshold compacts again', WITH_FALLBACK, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE, modelFork: modelForkAnswer('goal: finish') })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(host.steps.filter(s => s === 'compact')).toHaveLength(1)
  await pauseAt($, world, 210_000)
  expect(host.steps.filter(s => s === 'compact')).toHaveLength(2)
})

test('a compact that failed leaves no mark: the next pause tries it again', ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_VETO })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(host.steps).toEqual(['compact', 'compact'])
  expect(seen.logs).toEqual([COMPACTING, 'handover failed, compact was skipped (probe veto)', COMPACTING, 'handover failed, compact was skipped (probe veto)'])
})

test('the dry run sets no mark: it compacts nothing', methods('builtin-compact', 'none', { ...NO_GAP, dry_run: true }), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(seen.logs).toEqual(['dry run, would compact now, context 210000 tokens', 'dry run, would compact now, context 210000 tokens'])
})

test('a compact that left the context above the threshold is logged at the pause that finds it', ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug', compact: COMPACT_DONE })
  await startSession($)
  await pauseAt($, world, 210_000)
  await pauseAt($, world, 210_000)
  expect(seen.logs.filter(l => l.startsWith('debug: ') && l.includes('left the context'))).toEqual(['debug: compact left the context above the threshold'])
})
