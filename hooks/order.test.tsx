import { expect } from 'claude-code/testing'

import { endTurn, sessionWith, startSession, startTurn, stop, withMod, DRY_RUN, modTest } from './test-support'

// The host raises the stop first, before the `turn.complete` of the same turn (docs/host-behaviour.md, Events and their order). The mod still has to give the same
// answer either way, because only an answer may start a handoff and the stop does not say how the turn ended.
const WOULD = /would hand over/

modTest('a stop before the end of an answer reports once, when the end comes', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  await startTurn($)
  await stop($)
  expect(seen.logs.filter(l => WOULD.test(l))).toEqual([])
  await endTurn($, 'answer')
  expect(seen.logs.filter(l => WOULD.test(l))).toHaveLength(1)
})

for (const reason of ['aborted', 'error', 'refusal'] as const) {
  modTest(`a stop before the end of a turn that ended ${reason} reports nothing`, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    await startSession($)
    await startTurn($)
    await stop($)
    await endTurn($, reason)
    expect(seen.logs.filter(l => WOULD.test(l))).toEqual([])
  })
}

modTest('a stop before the end of an aborted turn does not leave the stop waiting for the next turn', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  await endTurn($, 'aborted', { turnId: 't1' })
  await startTurn($, 't2')
  await endTurn($, 'answer', { turnId: 't2' })
  expect(seen.logs.filter(l => WOULD.test(l))).toEqual([])
})

modTest('the stop of a subagent does not wait for an end', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  await startTurn($)
  await stop($, { agent_id: 'a1' })
  await endTurn($, 'answer')
  expect(seen.logs.filter(l => WOULD.test(l))).toEqual([])
})
