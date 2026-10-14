import { expect } from 'claude-code/testing'

import { COLD, LIVE_IDLE, answer, band, idleSession, shown, typeKey } from './idle-support'
import { MINUTE, answered, modTest, runRelay, startTurn, typeInto, type TestEngine } from './test-support'

// Once the handoff written in a pause has gone cold, the band above the prompt says that the next message starts a fresh session, and how
// to stay: `/sweet-spot later`, which drops the handoff. The band has no key and no countdown, since nobody waits on it.

const DROPPED = 'idle handoff dropped, your next message stays in this session. '
const BACK = 'hello again'

// The answer ends at minute 0 and the handoff is written at minute 55, which keeps the cache until minute 115.
const prepared = async ($: TestEngine, world: { clock: { advance: (ms: number) => Promise<void> } }) => {
  await answer($)
  await world.clock.advance(55 * MINUTE)
}

modTest('the band says so an hour after the handoff read the cache, and asks for a redraw', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  const redraws: string[] = []
  on('ui.invalidate', async (_, e) => (redraws.push(e.event), { value: undefined }))
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE - 1)
  expect(await shown(ui)).toBeUndefined()
  expect(redraws).toEqual([])
  await world.clock.advance(1)
  expect(redraws).toEqual(['ui.render'])
  expect(await shown(ui)).toBe(COLD)
  expect(await ui.find({ key: 'not-now' })).toBeUndefined()
})

modTest('a digit typed under the band is typing: it lands in the prompt and the handoff stays', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  expect(await typeKey($, '1')).toEqual({ text: '1', cursor: 1 })
  expect(await shown(ui)).toBe(COLD)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps[0]).toBe('run clear')
})

modTest('a survey has the band while it shows', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  expect(await shown(ui, true)).toBeUndefined()
  expect(await shown(ui)).toBe(COLD)
})

modTest('/sweet-spot later drops the handoff, takes the band away, and the next message stays in this session', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  const text = await answered(runRelay($, 'later'))
  expect(text?.startsWith(DROPPED)).toBe(true)
  expect(text?.slice(DROPPED.length)).toBe(await answered(runRelay($, 'later')))
  expect(await shown(ui)).toBeUndefined()
  expect(await typeInto($, BACK)).toEqual({ text: BACK })
  await world.clock.settle()
  expect(host.steps).toEqual([`submit ${BACK}`])
})

modTest('/sweet-spot later drops a handoff written that is still warm, before any band', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await prepared($, world)
  expect((await answered(runRelay($, 'later')))?.startsWith(DROPPED)).toBe(true)
  await world.clock.advance(70 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps).toEqual([`submit ${BACK}`])
})

modTest('a new turn ends the pause and takes the band away', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  expect(await shown(ui)).toBe(COLD)
  await startTurn($, 't2')
  expect(await shown(ui)).toBeUndefined()
})

modTest('the message that comes back takes the band away', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  await typeInto($, BACK)
  expect(await shown(ui)).toBeUndefined()
})

modTest('in a dry run there is no band: nothing would switch', { options: { dry_run: true } }, async ($, on) => {
  const { world } = idleSession(on)
  const ui = await band($)
  await prepared($, world)
  await world.clock.advance(60 * MINUTE)
  expect(await shown(ui)).toBeUndefined()
})
