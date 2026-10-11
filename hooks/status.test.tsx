import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH } from './handoff'
import {
  answered,
  hostWith,
  LIVE,
  modTest,
  pauseAt,
  raiseHandoff,
  runRelay,
  sessionWith,
  startSession,
  startTurn,
  withMod,
  type SessionWorld,
  type TestEngine,
} from './test-support'

// `/sweet-spot status` says where the context stands against the threshold and the emergency brake, and changes nothing. The window is
// 1000000 tokens unless a test says otherwise: threshold 200000, emergency brake 350000.

const status = async ($: TestEngine, world: SessionWorld, tokens: number | undefined, args = 'status') => {
  world.tokens = tokens
  return answered(runRelay($, args))
}

modTest('status says the context against the window, where the handover comes and the emergency brake', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await status($, world, 134_000)).toBe('context 134000 of 1000000 tokens, hands over at 200000, emergency brake at 350000')
})

const USAGE =
  'use `/sweet-spot status` to see where the context stands, `/sweet-spot later [tokens]` to move the next handover back, or `/sweet-spot redeliver` to submit again the handoff that did not reach the fresh session'

for (const args of ['status 50k', 'STATUS', 'Status', 'statusx', 'status  later']) {
  modTest(`"${args}" is no status: the command tells what it does`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    await startSession($)
    expect(await status($, world, 134_000, args)).toBe(`unknown argument "${args}", ${USAGE}`)
  })
}

modTest('with no argument the help names status', LIVE, async ($, on) => {
  withMod(on)
  sessionWith(on)
  await startSession($)
  expect(await answered(runRelay($, ''))).toBe(USAGE)
})

const TEN = { options: { ...LIVE.options, countdown_seconds: 10 } }

modTest('status leaves a countdown running: the handover still comes at its end', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  expect(await answered(runRelay($, 'status'))).toBe('context 210000 of 1000000 tokens, hands over at 200000, emergency brake at 350000')
  await world.clock.advance(9_999)
  expect(host.steps).toEqual([])
  await world.clock.advance(1)
  expect(host.steps).toEqual([`run handoff ${ASK_FOR_PATH}`])
  expect(seen.toasts).toHaveLength(1)
})

modTest('the diagnostic output names the answer at debug, with the sizes and nothing else', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  await status($, world, 134_000)
  expect(seen.logs.filter(l => l.includes('status'))).toEqual(['debug: status: answered, context 134000 of 1000000 tokens'])
})

// A dry run with no gap: every pause from the value in force on says it would hand over, and nothing else happens.
const DRY = { options: { dry_run: true, min_gap_minutes: 0, min_gap_turns: 0 } }

const later = (world: SessionWorld, $: TestEngine, tokens: number, args: string) => {
  world.tokens = tokens
  return answered(runRelay($, args))
}

modTest('with a later that holds, status gives the value the handover comes at and the threshold of the settings', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later(world, $, 200_000, 'later 30k')
  expect(await status($, world, 205_000)).toBe('context 205000 of 1000000 tokens, hands over at 230000 (later, threshold 200000), emergency brake at 350000')
})

modTest('a later past the emergency brake is shown capped there', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later(world, $, 200_000, 'later 500k')
  expect(await status($, world, 210_000)).toBe('context 210000 of 1000000 tokens, hands over at 350000 (later, threshold 200000), emergency brake at 350000')
})

modTest('a context that fell below where later was asked does not show it, and status does not end it', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later(world, $, 200_000, 'later 30k')
  expect(await status($, world, 150_000)).toBe('context 150000 of 1000000 tokens, hands over at 200000, emergency brake at 350000')
  expect(await status($, world, 205_000)).toBe('context 205000 of 1000000 tokens, hands over at 230000 (later, threshold 200000), emergency brake at 350000')
})

modTest('status neither spends nor moves a later: the handover still comes at the value it asked for', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later(world, $, 190_000, 'later 50k')
  const said = 'dry run, only reports: context 195000 of 1000000 tokens, hands over at 240000 (later, threshold 200000), emergency brake at 350000'
  expect(await status($, world, 195_000)).toBe(said)
  expect(await status($, world, 195_000)).toBe(said)
  await pauseAt($, world, 239_999)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 240_000)
  expect(seen.toasts).toEqual(['dry run, would hand over now, context 240000 tokens'])
})

const NORMAL = 'context 134000 of 1000000 tokens, hands over at 200000, emergency brake at 350000'

modTest('in a dry run status says that the mod only reports', DRY, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await status($, world, 134_000)).toBe(`dry run, only reports: ${NORMAL}`)
})

modTest(
  'with settings the mod rejected status gives the reasons and no numbers',
  { options: { ...LIVE.options, handoff_command: '/handoff' } },
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    await startSession($)
    expect(await status($, world, 134_000)).toBe(
      'off: handoff_command: "/handoff" starts with a slash, give the name without it; handoff_method: "external-command" needs handoff_command, which is empty',
    )
  },
)

modTest('with no reading of the context yet status says so and still gives the threshold and the brake', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  expect(await status($, world, undefined)).toBe('context size unknown until the next answer (window 1000000), hands over at 200000, emergency brake at 350000')
  expect(seen.logs.filter(l => l.includes('status'))).toEqual(['debug: status: answered, context size unknown, window 1000000 tokens'])
})

modTest('with no reading of the context a later that was held stays shown', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await later(world, $, 200_000, 'later 30k')
  expect(await status($, world, undefined)).toBe(
    'context size unknown until the next answer (window 1000000), hands over at 230000 (later, threshold 200000), emergency brake at 350000',
  )
})

modTest('while a handover runs status adds that to its answer', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  expect(await status($, world, 210_000)).toBe('context 210000 of 1000000 tokens, hands over at 200000, emergency brake at 350000, a handover is in progress')
})

modTest('a context that cannot be read is told with the reason, and the diagnostic output has a warning without it', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  world.usageError = 'no usage'
  expect(await status($, world, 134_000)).toBe('could not read the context size (no implementation for session.usage)')
  expect(seen.logs.filter(l => l.includes('status'))).toEqual(['warn: status: could not read the context size'])
})

modTest('with a smaller window status gives the threshold that window lowers it to, and the brake counted from it', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { window: 200_000 })
  await startSession($)
  expect(await status($, world, 150_000)).toBe('context 150000 of 200000 tokens, hands over at 160000, emergency brake at 180000')
})

modTest('status answers while an answer is running, and does not wait for its pause', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await startTurn($, 't1')
  expect(await status($, world, 134_000)).toBe('context 134000 of 1000000 tokens, hands over at 200000, emergency brake at 350000')
})
