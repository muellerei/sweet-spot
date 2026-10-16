import { expect } from 'claude-code/testing'

import { COLD, LIVE_IDLE, answer, band, idleSession } from './idle-support'
import { LIVE, MINUTE, modTest, raiseHandoff, sessionWith, withMod, type TestEngine, type TestOn } from './test-support'

// The band above the prompt is one place for every mod. sweet-spot draws its own on top of what the rest of the chain draws there, and
// never in place of it: another mod's warning or buttons stay while a countdown runs or a cold handoff is shown.

const TEN = { options: { ...LIVE.options, countdown_seconds: 10 } }
const OTHER = 'other band'

// What the chain below sweet-spot draws above the prompt: another mod's band.
const OTHER_BAND = { type: 'Box', props: {}, children: [{ type: 'Text', props: {}, children: [OTHER] }] }

const bandProps = (hasSurvey: boolean) => ({ hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} })

// The texts of the band in the order they are drawn, top to bottom.
const texts = async (ui: Awaited<ReturnType<typeof band>>, hasSurvey = false) => {
  await ui.redraw(bandProps(hasSurvey))
  return (await ui.findAll({ type: 'Text' })).map(t => t.text)
}

const countdown = async ($: TestEngine, on: TestOn) => {
  withMod(on, OTHER_BAND)
  sessionWith(on)
  const ui = await band($)
  await raiseHandoff($)
  return ui
}

modTest('while a countdown runs, the band stands on top of what another mod draws above the prompt', TEN, async ($, on) => {
  const ui = await countdown($, on)
  const shown = await texts(ui)
  expect(shown).toHaveLength(2)
  expect(shown[0]).toContain('Handing over')
  expect(shown[1]).toBe(OTHER)
  expect(await ui.find({ key: 'not-now' })).toBeDefined()
})

modTest('while a survey holds the band during a countdown, only what the rest of the chain draws shows', TEN, async ($, on) => {
  const ui = await countdown($, on)
  expect(await texts(ui, true)).toEqual([OTHER])
  expect(await ui.find({ key: 'not-now' })).toBeUndefined()
})

modTest('once the handoff has gone cold, its band stands on top of what another mod draws above the prompt', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on, {}, {}, OTHER_BAND)
  const ui = await band($)
  await answer($)
  await world.clock.advance(115 * MINUTE)
  expect(await texts(ui)).toEqual([COLD, OTHER])
})

modTest('with nothing to show, the band is what the rest of the chain draws', LIVE_IDLE, async ($, on) => {
  idleSession(on, {}, {}, OTHER_BAND)
  const ui = await band($)
  expect(await texts(ui)).toEqual([OTHER])
})
