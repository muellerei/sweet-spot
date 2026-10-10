import { test, expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import { endTurn, FILE, hostWith, LIVE, NOTES, reachThreshold, sessionWith, startSession, startTurn, stop, typeInto, withMod, DRY_RUN } from './test-support'

// Every handler reads the log level, which is a wait. These tests start two handlers before either is done,
// the way two events of the host can overlap, and expect the outcome of the same two events one after the other.

const WOULD = /would hand over/
const RUN = `run handoff ${ASK_FOR_PATH}`
const HELD = 'sweet-spot: a handover is in progress, your message is held and goes in when it is done'

for (const level of [undefined, 'trace']) {
  const named = level === undefined ? 'with no log' : `with the log at ${level}`

  test(`a stop and the end of its answer at once report once, stop first, ${named}`, DRY_RUN, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    hostWith(on, { logLevel: level })
    await startSession($)
    await startTurn($)
    await Promise.all([stop($), endTurn($, 'answer')])
    expect(seen.logs.filter(l => WOULD.test(l))).toHaveLength(1)
  })

  test(`a stop and the end of its answer at once report once, end first, ${named}`, DRY_RUN, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    hostWith(on, { logLevel: level })
    await startSession($)
    await startTurn($)
    await Promise.all([endTurn($, 'answer'), stop($)])
    expect(seen.logs.filter(l => WOULD.test(l))).toHaveLength(1)
  })

  test(`the end of a turn and the start of the next at once still judge the turn that ended, ${named}`, DRY_RUN, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    hostWith(on, { logLevel: level })
    await startSession($)
    await startTurn($, 't1')
    await stop($)
    await Promise.all([endTurn($, 'answer', { turnId: 't1' }), startTurn($, 't2')])
    expect(seen.logs.filter(l => WOULD.test(l))).toHaveLength(1)
  })

  test(`typing at the moment the command's turn ends is held and goes into the fresh session, ${named}`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES }, logLevel: level })
    await reachThreshold($, world)
    await startTurn($, 't2')
    const [typed] = await Promise.all([typeInto($, 'also fix the lexer'), endTurn($, 'answer', { answer: `HANDOFF_PATH: ${FILE}`, turnId: 't2' })])
    await world.clock.settle()
    expect(typed).toEqual({ drop: HELD })
    expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}\n\nTyped while the handoff ran:\nalso fix the lexer`])
  })
}

// The reads need not come back in the order they went out: the end of a turn whose read is slow is still the end of that turn, not of the
// next one, which started in the meantime.
test('the end of a turn whose log level read is slow still judges that turn, when the next one starts meanwhile', DRY_RUN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on)
  let release = () => {}
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  host.during['read log level'] = () => new Promise<void>(r => (release = r))
  const end = endTurn($, 'answer', { turnId: 't1' })
  await startTurn($, 't2')
  release()
  await end
  expect(seen.logs.filter(l => WOULD.test(l))).toHaveLength(1)
})
