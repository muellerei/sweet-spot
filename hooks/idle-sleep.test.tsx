import { expect } from 'claude-code/testing'

import { COLD, LIVE_IDLE, answer, band, idleLines, idleSession, shown, typeKey } from './idle-support'
import { MINUTE, modTest, typeInto } from './test-support'

// After system sleep the time has moved on and no timer has fired: what the mod judges, it judges by the clock it reads. The host's clock
// here jumps while the clock in memory, which fires the timers, stays.

const HELD = 'sweet-spot: your message is held for a moment and goes in right after'

modTest('after sleep the first key typed brings the band up, though its timer never fired', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  const ui = await band($)
  await answer($)
  await world.clock.advance(56 * MINUTE)
  world.slept = 70 * MINUTE
  expect(await shown(ui)).toBeUndefined()
  await typeKey($, 'a')
  expect(await shown(ui)).toBe(COLD)
})

modTest('a message after sleep is judged by the clock: cold, it starts a fresh session', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(56 * MINUTE)
  world.slept = 70 * MINUTE
  expect(await typeInto($, 'hello again')).toEqual({ drop: HELD })
  await world.clock.settle()
  expect(host.steps[0]).toBe('run clear')
})

for (const [name, late] of [
  ['six minutes late, past the expiry', 6 * MINUTE],
  ['four and a half minutes late, with less than a minute left', 4.5 * MINUTE],
] as const) {
  modTest(`the step that fires ${name} writes nothing`, LIVE_IDLE, async ($, on) => {
    const { seen, world, host } = idleSession(on)
    await answer($)
    world.slept = late
    await world.clock.advance(55 * MINUTE)
    expect(host.modelForkPrompts).toHaveLength(0)
    expect(idleLines(seen.logs)).toContain('debug: idle: not prepared, the cache is about to expire or has')
  })
}
