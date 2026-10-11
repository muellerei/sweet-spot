import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import {
  DENIED_BY_RULE,
  DUE,
  endTurn,
  fellBack,
  FILE,
  HANDED,
  hostWith,
  LIVE,
  NOTES,
  reachThreshold,
  REJECTED_BY_USER,
  REJECTED_WITH_HINT,
  sessionWith,
  startTurn,
  withMod,
  type SessionWorld,
  type TestEngine,
  ANSWERED,
  modTest,
} from './test-support'

// The user presses Esc or "No" at a permission prompt in the turn of their own handoff command, and the command writes no file because of it:
// that is the user's own stop, and no other way hands over after it. A rule that denied the call is no stop of the user's.

const RUN = `run handoff ${ASK_FOR_PATH}`
const NO_PATH = 'the answer names no handoff file and the temp directory has none from this run'
const CANCELLED = 'cancelled, the session is as it was'

const bash = ($: TestEngine, extra: object = {}) =>
  $.tool.call({ tool: 'Bash', command: 'touch /var/T/x', description: 'make the file', tool_use_id: 'u1', ...extra } as never)

// The command's turn: it starts, the tool calls happen, it ends with the answer given.
const commandTurn = async ($: TestEngine, world: SessionWorld, calls: () => Promise<unknown>, answer = '') => {
  await startTurn($, 't2')
  await calls()
  await endTurn($, 'answer', { turnId: 't2', answer })
  await world.clock.settle()
}

modTest('Esc at the prompt, with no file written, cancels: the fallback does not hand over', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [REJECTED_BY_USER] })
  await reachThreshold($, world)
  await commandTurn($, world, () => bash($))
  expect(host.steps).toEqual([RUN])
  expect(host.modelForkPrompts).toEqual([])
  expect(seen.logs).toEqual([DUE, CANCELLED])
  expect(host.store.get('failure')).toMatchObject({ stage: 'cancelled', reason: 'you declined a permission the command asked for' })
})

modTest('"No" with a hint, and a file written after all, hands over as usual', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, toolResults: [REJECTED_WITH_HINT] })
  await reachThreshold($, world)
  await commandTurn($, world, () => bash($), `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
  expect(seen.logs).toEqual([DUE, HANDED])
})

modTest('a rule that denied the call is no stop of the user: the fallback takes over', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [DENIED_BY_RULE] })
  await reachThreshold($, world)
  await commandTurn($, world, () => bash($))
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(seen.logs).toEqual([DUE, fellBack(NO_PATH), HANDED])
})

modTest("the user and a rule declining in the same turn: the user's decline counts", LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [DENIED_BY_RULE, REJECTED_BY_USER] })
  await reachThreshold($, world)
  await commandTurn($, world, async () => {
    await bash($, { tool_use_id: 'u1' })
    await bash($, { tool_use_id: 'u2' })
  })
  expect(host.modelForkPrompts).toEqual([])
  expect(seen.logs).toEqual([DUE, CANCELLED])
})

modTest('a subagent that was declined does not count', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [REJECTED_BY_USER] })
  await reachThreshold($, world)
  await commandTurn($, world, () => bash($, { agentId: 'a1' }))
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(seen.logs).toEqual([DUE, fellBack(NO_PATH), HANDED])
})

modTest("a decline before the command's turn started is not that turn's", LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [REJECTED_BY_USER] })
  await reachThreshold($, world)
  await bash($)
  await commandTurn($, world, async () => {})
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(seen.logs).toEqual([DUE, fellBack(NO_PATH), HANDED])
})

modTest('a decline after the wait is over is not looked at', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, toolResults: [REJECTED_BY_USER] })
  await reachThreshold($, world)
  await commandTurn($, world, async () => {})
  await bash($)
  expect(seen.logs).toEqual([DUE, fellBack(NO_PATH), HANDED])
  expect(host.modelForkPrompts).toHaveLength(1)
})

modTest('the call is passed on as it is, whatever it answered', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on, { toolResults: [REJECTED_BY_USER, { result: 'fine', text: 'fine' }] })
  await reachThreshold($, world)
  await startTurn($, 't2')
  expect(await bash($)).toEqual(REJECTED_BY_USER)
  expect(await bash($)).toEqual({ result: 'fine', text: 'fine' })
})

modTest('the decline is logged at debug, without the tool or what it was asked to do', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug', toolResults: [REJECTED_BY_USER] })
  await reachThreshold($, world)
  await commandTurn($, world, () => bash($))
  const declined = seen.logs.filter(l => l.includes('declined'))
  expect(declined).toEqual(["debug: the command's turn: a permission was declined"])
})
