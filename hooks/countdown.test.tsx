import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import {
  ANSWERED,
  answered,
  compactByHand,
  COMPACT_DONE,
  COMPACT_VETO,
  COMPACTED,
  COMPACTING,
  DUE,
  HANDED,
  hostWith,
  LIVE,
  methods,
  modTest,
  pause,
  pauseAt,
  raiseHandoff,
  runRelay,
  sessionWith,
  startSession,
  startTurn,
  stop,
  typeInto,
  withMod,
  type SessionWorld,
  type TestEngine,
  editPrompt,
} from './test-support'

// The countdown before an automatic handover: at a pause past the threshold the band counts down and offers "Not now", and the handover
// comes when it runs out. The window is 1000000 tokens unless a test says otherwise: threshold 200000, emergency brake 350000.

const RUN = `run handoff ${ASK_FOR_PATH}`
const TEN = { options: { ...LIVE.options, countdown_seconds: 10 } }
const DRY_TEN = { options: { dry_run: true, countdown_seconds: 10 } }

// What the host hands the band: `bodyColumns` cells wide, and whether a survey holds it.
const bandProps = (bodyColumns = 200, hasSurvey = false) => ({
  hasSurvey,
  isWorking: false,
  maxRows: 10,
  bodyColumns,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
})

// The band above the prompt as the terminal draws it, `bodyColumns` cells wide.
const band = ($: TestEngine, bodyColumns = 200) =>
  $.ui.mount({ plugin: 'sweet-spot', surface: 'terminal', component: 'AbovePrompt', props: bandProps(bodyColumns) })

type Band = Awaited<ReturnType<typeof band>>

// The host draws the band again as a survey comes up in it, or goes.
const survey = (ui: Band, hasSurvey: boolean) => ui.redraw(bandProps(200, hasSurvey))

// What the band shows: its text, then the button with its hotkey in front, as a plain button draws it; nothing when the mod draws none.
const shown = async (ui: Band): Promise<string | undefined> => {
  const button = await ui.find({ key: 'not-now' })
  const text = (await ui.find({ type: 'Text' }))?.text
  if (button === undefined) return text
  return `${text ?? ''}${String(button.props.hotkey)}: ${String(button.props.label)}`
}

modTest('with a countdown of 10 seconds the handover comes 10 seconds after the pause, not before', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  await world.clock.advance(9_999)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
  await world.clock.advance(1)
  expect(host.steps).toEqual([RUN])
  expect(seen.toasts).toEqual([DUE])
})

modTest('with a countdown of 0 the pause hands over as before, with nothing in between', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  // Nothing of the countdown was asked: not even where the session draws.
  expect(world.reads).not.toContain('surfaces')
})

modTest('the band names the way, the seconds, the context and the threshold, and counts down as the clock moves', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
  await world.clock.advance(1_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 9 s · context 210000 of 200000 · 1: Not now, +25000')
  await world.clock.advance(8_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 1 s · context 210000 of 200000 · 1: Not now, +25000')
  await world.clock.advance(1_000)
  expect(await shown(ui)).toBeUndefined()
})

for (const [command, words] of [
  ['cd /x && PORT=3001 npm run dev > dev.log 2>&1', 'npm run dev'],
  ['ngrok http 3000 --authtoken abc', 'ngrok http'],
] as const) {
  modTest(`the band says that ${words} keeps running, and nothing else of ${JSON.stringify(command)}`, TEN, async ($, on) => {
    withMod(on)
    sessionWith(on)
    hostWith(on)
    await startSession($)
    await pause($, { background_tasks: [{ id: 'b1', type: 'shell', status: 'running', description: 'in the background', command }] })
    expect(await shown(await band($))).toBe(`Handing over to a fresh session in 10 s · context 210000 of 200000 · ${words} keeps running · 1: Not now, +25000`)
  })
}

modTest('a compact as the first way is named as one', { options: { ...methods('builtin-compact', 'none').options, countdown_seconds: 10 } }, async ($, on) => {
  withMod(on)
  sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  expect(await shown(await band($))).toBe('Compacting in 10 s · context 210000 of 200000 · 1: Not now, +25000')
})

modTest('in a dry run the band says what it would do, and the end of the countdown says it would hand over now', DRY_TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  expect(await shown(ui)).toBe('Would hand over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
  expect(seen.toasts).toEqual([])
  await world.clock.advance(10_000)
  expect(seen.toasts).toEqual(['dry run, would hand over now, context 210000 tokens'])
  expect(host.steps).toEqual([])
})

modTest('the button says what it moves the handover back by, cut short at the emergency brake', TEN, async ($, on) => {
  withMod(on)
  // A 200000 window: threshold in force 160000, brake 180000; 170000 plus 25000 lies past it.
  sessionWith(on, { window: 200_000, tokens: 170_000 })
  hostWith(on)
  await raiseHandoff($)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 170000 of 160000 · 1: Not now, +10000 to the brake')
})

modTest('the band shows the threshold that later set, not the setting', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await startSession($)
  world.tokens = 200_000
  await answered(runRelay($, 'later 10k'))
  await pauseAt($, world, 212_000)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 212000 of 210000 · 1: Not now, +25000')
})

modTest('a narrow band drops the threshold first, then the context, and keeps the way, the seconds and the button', TEN, async ($, on) => {
  withMod(on)
  sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  const full = 'Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000'
  expect(await shown(await band($, full.length))).toBe(full)
  expect(await shown(await band($, full.length - 1))).toBe('Handing over to a fresh session in 10 s · context 210000 · 1: Not now, +25000')
  expect(await shown(await band($, 40))).toBe('Handing over to a fresh session in 10 s · 1: Not now, +25000')
})

modTest('Not now moves the handover back as later does, answers as later does, ends the countdown and writes nothing to the transcript', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await ui.press({ key: 'not-now' })
  expect(seen.toasts).toEqual(['hands over at 235000 tokens instead of 200000, for this handover only, context 210000 tokens'])
  expect(seen.logs).toEqual([])
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  // The value later set holds: below it no countdown, at it the countdown comes again.
  await pauseAt($, world, 234_999)
  expect(await shown(ui)).toBeUndefined()
  await pauseAt($, world, 235_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 235000 of 235000 · 1: Not now, +25000')
})

modTest('Not now at the emergency brake answers as later does there', TEN, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { window: 200_000, tokens: 170_000 })
  hostWith(on)
  await raiseHandoff($)
  await (await band($)).press({ key: 'not-now' })
  expect(seen.toasts).toEqual(['hands over at 180000 tokens instead of 160000, for this handover only, capped at the emergency brake, context 170000 tokens'])
})

modTest('a countdown is no attempt: the minimum gap does not hold the countdown that follows Not now', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  await (await band($)).press({ key: 'not-now' })
  await pauseAt($, world, 235_000)
  expect(await shown(await band($))).toBeDefined()
  expect(seen.toasts.filter(t => t.includes('postponed'))).toEqual([])
})

modTest('the end of the countdown is the attempt: a pause within the minimum gap after it is postponed', DRY_TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  await world.clock.advance(10_000)
  await pauseAt($, world, 220_000)
  expect(seen.toasts).toEqual([
    'dry run, would hand over now, context 210000 tokens',
    'handoff postponed, the minimum gap since the last attempt has not passed, context 220000 tokens',
  ])
  expect(await shown(await band($))).toBeUndefined()
})

modTest('later is spent when the countdown runs out, not when it begins', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  world.tokens = 200_000
  await answered(runRelay($, 'later 10k'))
  await pauseAt($, world, 212_000)
  const spent = () => seen.logs.filter(l => l === 'debug: later: spent by this handover')
  expect(spent()).toEqual([])
  await world.clock.advance(10_000)
  expect(spent()).toEqual(['debug: later: spent by this handover'])
})

for (const surfaces of [['vscode'], ['mobile'], []]) {
  modTest(`with no screen to draw the band on (${surfaces.join(', ') || 'none'}) the pause hands over at once`, TEN, async ($, on) => {
    withMod(on)
    const world = sessionWith(on, { surfaces })
    const host = hostWith(on)
    await raiseHandoff($)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
  })
}

modTest('the diagnostic output says why no countdown began where nothing draws the band', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { surfaces: ['vscode'] })
  hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  await world.clock.settle()
  expect(seen.logs.filter(l => /^\w+: countdown:/.test(l))).toEqual(['debug: countdown: none, no screen draws the band'])
})

modTest('on the desktop the band counts down as on the terminal', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { surfaces: ['desktop', 'vscode'] })
  const host = hostWith(on)
  await raiseHandoff($)
  await world.clock.settle()
  expect(host.steps).toEqual([])
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
})

modTest('after the countdown the transcript holds the same line as before, and nothing from its start', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  await world.clock.settle()
  expect(seen.logs).toEqual([])
  await world.clock.advance(10_000)
  expect(seen.logs).toEqual([DUE])
})

modTest(
  'after the countdown the compact runs as before',
  { options: { ...methods('builtin-compact', 'none').options, countdown_seconds: 10 } },
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { compact: COMPACT_DONE })
    await raiseHandoff($)
    await world.clock.advance(10_000)
    expect(host.steps).toEqual(['compact'])
    expect(seen.logs).toEqual([COMPACTING, COMPACTED])
  },
)

modTest(
  'after the countdown the handoff the mod writes runs as before',
  { options: { ...methods('internal-handoff', 'none').options, countdown_seconds: 10 } },
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { modelFork: ANSWERED })
    await raiseHandoff($)
    await world.clock.advance(10_000)
    expect(host.steps).toEqual(['run clear', `submit ${firstMessage(ANSWERED.text)}`])
    expect(seen.logs).toEqual([DUE, HANDED])
  },
)

modTest('the diagnostic output names the start of the countdown, its end and Not now, with no contents', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  await (await band($)).press({ key: 'not-now' })
  await pauseAt($, world, 235_000)
  await world.clock.advance(10_000)
  expect(seen.logs.filter(l => /^\w+: countdown:/.test(l))).toEqual([
    'info: countdown: starts, 10 s, method external-command, kind button, deferred pauses 0',
    'debug: countdown: moved back by Not now',
    // Not now starts the deferred pauses over.
    'info: countdown: starts, 10 s, method external-command, kind button, deferred pauses 0',
    'info: countdown: ran out',
  ])
})

// One edit in the prompt, as the host raises it: the draft before, the splice, and the key that made it where one did.
const edit = ($: TestEngine, before: string, inputText: string, { at = before.length, to = at, key }: { at?: number; to?: number; key?: string } = {}) =>
  editPrompt($, {
    origin: { kind: 'composer' },
    text: before,
    cursor: before.length,
    start: at,
    end: to,
    inputText,
    ...(key === undefined ? {} : { key: { key } }),
  })

modTest('the first edit that leaves text in the prompt ends the countdown, moves nothing back, and the next pause counts down again', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await edit($, '', 'h', { key: 'h' })
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  await pauseAt($, world, 210_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
})

modTest('an edit that leaves the prompt empty, and a move of the cursor in an empty prompt, do not end the countdown', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  await edit($, '', '')
  await edit($, '', ' ', { key: ' ' })
  await edit($, ' ', '', { at: 0, to: 1, key: 'backspace' })
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
})

modTest(
  'the key of Not now in an empty prompt is the press, not typing: its edit leaves the countdown running and the press moves back',
  TEN,
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on)
    await raiseHandoff($)
    const ui = await band($)
    await edit($, '', '1', { key: '1' })
    expect(await shown(ui)).toBeDefined()
    await world.clock.advance(400)
    await ui.press({ key: 'not-now' })
    expect(seen.toasts).toEqual(['hands over at 235000 tokens instead of 200000, for this handover only, context 210000 tokens'])
    await world.clock.advance(60_000)
    expect(host.steps).toEqual([])
  },
)

modTest('the same digit after text in the prompt is typing and ends the countdown', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  await edit($, 'a', '1', { key: '1' })
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
})

modTest('a countdown that runs out between the digit and its press hands over, and the band no longer offers the button', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await world.clock.advance(9_800)
  await edit($, '', '1', { key: '1' })
  await world.clock.advance(400)
  expect(host.steps).toEqual([RUN])
  // The engine delivers no press to a button that is gone; a host that did would meet the answer the flow's own test pins.
  expect(await shown(ui)).toBeUndefined()
})

modTest('a submit ends the countdown and moves nothing back, also the one a finished background task raises', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  await typeInto($, '<task-notification>the build finished</task-notification>')
  await world.clock.advance(60_000)
  expect(host.steps).toEqual(['submit <task-notification>the build finished</task-notification>'])
  await pauseAt($, world, 210_000)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
})

modTest('a new turn ends the countdown, whoever starts it', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await startTurn($, 't2')
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
})

modTest('the command later ends the countdown, also when it came from the history with no edit, and then moves the handover back', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  expect(await answered(runRelay($, 'later'))).toBe('hands over at 235000 tokens instead of 200000, for this handover only, context 210000 tokens')
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
})

modTest('the command redeliver leaves the countdown running', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await answered(runRelay($, 'redeliver'))
  expect(await shown(ui)).toBeDefined()
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
})

modTest('a compact by hand ends the countdown without a handover, a precompute does not', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await raiseHandoff($)
  const ui = await band($)
  await $.session.compact({ trigger: 'precompute', messages: [] } as never)
  expect(await shown(ui)).toBeDefined()
  await compactByHand($)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual(['compact', 'compact manual'])
})

// The countdown ends before the compact runs, so that no handover starts while it does. One that another hook holds back costs it, and the
// next pause counts down again.
modTest('a compact by hand that another hook holds back ends the countdown too, and the next pause counts down again', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { manualCompact: COMPACT_VETO })
  await raiseHandoff($)
  const ui = await band($)
  await compactByHand($)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual(['compact manual'])
  await raiseHandoff($)
  expect(await shown(ui)).toBeDefined()
})

modTest('the end of the session ends the countdown without a handover, as a /clear by hand does', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
})

modTest('text that came into the prompt with no edit stops the handover when the countdown runs out; the next pause counts down again', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  const ui = await band($)
  // The history, Tab on a suggestion or another mod's `$.prompt.fill`: text in the prompt, and no edit raised.
  world.draft = 'fix the parser'
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(await shown(ui)).toBeUndefined()
  expect(seen.logs).toContain('debug: countdown: ended, prompt')
  world.draft = ''
  await pauseAt($, world, 210_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
})

// What a person can do while the end of the countdown reads the session: each ends the countdown, and nothing is handed over.
const meanwhile: [string, ($: TestEngine) => Promise<unknown>][] = [
  ['an edit', $ => edit($, '', 'h', { key: 'h' })],
  ['a submit', $ => typeInto($, 'one more thing')],
  ['a turn', $ => startTurn($, 't2')],
  ['the command later', $ => answered(runRelay($, 'later'))],
]
for (const step of ['prompt.read', 'agent.list']) {
  for (const [what, act] of meanwhile) {
    modTest(`${what} while the end of the countdown waits on ${step} stops the handover`, TEN, async ($, on) => {
      withMod(on)
      const world = sessionWith(on)
      const host = hostWith(on)
      await raiseHandoff($)
      world.during[step] = async () => void (await act($))
      await world.clock.advance(10_000)
      await world.clock.settle()
      expect(host.steps.filter(s => s.startsWith('run '))).toEqual([])
    })
  }
}

// The clock is read last. Past the deadline by more than 3 s the person was most likely away (the machine slept, the tick stayed out).
for (const [late, hands] of [
  [2_900, true],
  [3_100, false],
] as const) {
  modTest(`an end of the countdown read ${late} ms past its deadline ${hands ? 'hands over' : 'does not hand over'}`, TEN, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { logLevel: 'debug' })
    await raiseHandoff($)
    world.during['agent.list'] = () => world.clock.sleep(late)
    await world.clock.advance(10_000)
    await world.clock.advance(late)
    expect(host.steps).toEqual(hands ? [RUN] : [])
    expect(seen.logs.includes('debug: countdown: ended, late')).toBe(!hands)
  })
}

modTest('the end of the countdown judges again: a context no longer past the threshold hands nothing over and says nothing', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  world.tokens = 190_000
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
})

modTest('the end of the countdown judges again: a subagent that runs then hands nothing over', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  world.agents = [{ status: 'running' }]
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(seen.logs).toContain('debug: countdown: ran out, decided defer (subagent)')
})

modTest('a session that cannot be read when the countdown runs out ends it without a handover and says so in the log', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'warn' })
  await raiseHandoff($)
  const ui = await band($)
  world.usageError = 'session is not readable'
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(await shown(ui)).toBeUndefined()
  expect(seen.logs).toEqual(['warn: countdown: could not read the session when it ran out'])
})

modTest('a second stop of the same answer leaves the running countdown as it is, and its deadline with it', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  await world.clock.advance(5_000)
  await stop($)
  expect(seen.logs).toContain('debug: countdown: runs already')
  await world.clock.advance(5_000)
  expect(host.steps).toEqual([RUN])
})

modTest('a second stop while the first still reads where the session draws leaves one countdown, the one that read later', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  world.during.surfaces = async () => {
    world.tokens = 220_000
    await stop($)
  }
  await raiseHandoff($)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 220000 of 200000 · 1: Not now, +25000')
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
})

// What ends a countdown, and the reason the diagnostic output gives for it.
const enders: [string, ($: TestEngine) => Promise<unknown>][] = [
  ['edit', $ => edit($, '', 'h', { key: 'h' })],
  ['submit', $ => typeInto($, 'one more thing')],
  ['turn', $ => startTurn($, 't2')],
  ['command', $ => answered(runRelay($, 'later'))],
  ['session', $ => $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })],
  ['compact', $ => compactByHand($)],
]
for (const [reason, act] of enders) {
  modTest(`the diagnostic output names why a countdown ended: ${reason}`, TEN, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    hostWith(on, { logLevel: 'debug' })
    await raiseHandoff($)
    await act($)
    expect(seen.logs.filter(l => l.includes('countdown: ended'))).toEqual([`debug: countdown: ended, ${reason}`])
  })
}

modTest('at the emergency brake with no later the pause hands over at once, with no countdown and whatever the prompt holds', TEN, async ($, on) => {
  const seen = withMod(on)
  // Past the brake of 350000; a draft waits in the prompt.
  const world = sessionWith(on, { tokens: 360_000, draft: 'fix the parser' })
  const host = hostWith(on)
  await raiseHandoff($)
  expect(await shown(await band($))).toBeUndefined()
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  expect(seen.toasts).toEqual(['handing over now, context 360000 tokens'])
})

modTest('with a draft in the prompt no countdown begins at the pause; two such pauses wait, and at the third it begins all the same', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { draft: 'fix the parser' })
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 211_000)
  expect(await shown(ui)).toBeUndefined()
  await pauseAt($, world, 212_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 212000 of 200000 · your draft stays in the prompt')
})

// Two pauses with a draft: the third begins the countdown that typing does not stop.
const toCap = async ($: TestEngine, world: SessionWorld) => {
  world.draft = 'fix the parser'
  await raiseHandoff($)
  await pauseAt($, world, 211_000)
  await pauseAt($, world, 212_000)
}

modTest('at the cap typing does not end the countdown, and it hands over with the draft, which stays in the prompt', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await toCap($, world)
  const ui = await band($)
  expect(await ui.find({ key: 'not-now' })).toBeUndefined()
  await edit($, 'fix the parser', ' now', { key: 'w' })
  await edit($, '', '1', { key: '1' })
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 212000 of 200000 · your draft stays in the prompt')
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
  expect(world.draft).toBe('fix the parser')
})

modTest('a submit or a turn ends the countdown at the cap, and the next pause begins one at the cap again', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await toCap($, world)
  const ui = await band($)
  await typeInto($, 'one more thing')
  expect(await shown(ui)).toBeUndefined()
  await pauseAt($, world, 213_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 213000 of 200000 · your draft stays in the prompt')
  await startTurn($, 't2')
  expect(await shown(ui)).toBeUndefined()
  await pauseAt($, world, 214_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 214000 of 200000 · your draft stays in the prompt')
  await world.clock.advance(10_000)
  expect(host.steps).toEqual(['submit one more thing', RUN])
})

modTest('typing between the pauses does not start the deferred pauses over: the third pause begins the countdown at the cap', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { draft: 'fix the parser' })
  hostWith(on)
  await raiseHandoff($)
  // Typed and emptied again before the next pause.
  await edit($, 'fix the parser', '', { at: 0, to: 14, key: 'backspace' })
  world.draft = ''
  await pauseAt($, world, 211_000)
  const ui = await band($)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 211000 of 200000 · 1: Not now, +25000')
  await edit($, '', 'h', { key: 'h' })
  expect(await shown(ui)).toBeUndefined()
  world.draft = ''
  await pauseAt($, world, 212_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 212000 of 200000 · your draft stays in the prompt')
})

// Each starts the deferred pauses over: after it, two pauses with a draft wait again.
// The threshold the band shows after it: later's, or the setting's.
const startsOver: [string, ($: TestEngine, world: SessionWorld) => Promise<unknown>, number][] = [
  ['the command later', $ => answered(runRelay($, 'later')), 236_000],
  // As after a compact or a /clear: the pause reads a context below the threshold.
  ['a context below the first deferred pause', async ($, world) => pauseAt($, world, 150_000), 200_000],
]
for (const [what, act, threshold] of startsOver) {
  modTest(`${what} starts the deferred pauses over`, TEN, async ($, on) => {
    withMod(on)
    const world = sessionWith(on, { draft: 'fix the parser' })
    hostWith(on)
    world.tokens = 210_000
    await raiseHandoff($)
    await pauseAt($, world, 211_000)
    await act($, world)
    const ui = await band($)
    await pauseAt($, world, 240_000)
    await pauseAt($, world, 241_000)
    expect(await shown(ui)).toBeUndefined()
    await pauseAt($, world, 242_000)
    expect(await shown(ui)).toBe(`Handing over to a fresh session in 10 s · context 242000 of ${threshold} · your draft stays in the prompt`)
  })
}

modTest('Not now starts the deferred pauses over', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { draft: 'fix the parser' })
  hostWith(on)
  await raiseHandoff($)
  world.draft = ''
  await pauseAt($, world, 211_000)
  const ui = await band($)
  await ui.press({ key: 'not-now' })
  world.draft = 'fix the parser'
  await pauseAt($, world, 240_000)
  await pauseAt($, world, 241_000)
  expect(await shown(ui)).toBeUndefined()
  await pauseAt($, world, 242_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 242000 of 236000 · your draft stays in the prompt')
})

modTest('a countdown that ends on text filled in with no edit counts as a deferred pause, as one that ran out late does', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  world.draft = 'fix the parser'
  await world.clock.advance(10_000)
  world.draft = ''
  await pauseAt($, world, 211_000)
  world.during['agent.list'] = () => world.clock.sleep(3_100)
  await world.clock.advance(10_000)
  await world.clock.advance(3_100)
  await pauseAt($, world, 212_000)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 212000 of 200000 · your draft stays in the prompt')
})

// A 200000 window, threshold 200000, later_tokens 25000: threshold in force 160000, emergency brake 180000.
modTest('at the brake after Not now was capped there, a countdown with no button announces the handover and spends later as it begins', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { window: 200_000, tokens: 160_000 })
  const host = hostWith(on, { logLevel: 'debug' })
  await raiseHandoff($)
  const ui = await band($)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 160000 of 160000 · 1: Not now, +20000 to the brake')
  await ui.press({ key: 'not-now' })
  expect(seen.toasts).toEqual(['hands over at 180000 tokens instead of 160000, for this handover only, capped at the emergency brake, context 160000 tokens'])
  world.draft = 'fix the parser'
  await pauseAt($, world, 180_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 180000 of 180000 · emergency brake')
  expect(await ui.find({ key: 'not-now' })).toBeUndefined()
  expect(seen.logs).toContain('debug: later: spent by the countdown at the emergency brake')
  // Typing does not stop it, nor does a subagent when it runs out.
  await edit($, 'fix the parser', 'x', { key: 'x' })
  world.agents = [{ status: 'running' }]
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([RUN])
  expect(seen.toasts.at(-1)).toBe('handing over now, context 180000 tokens, although a subagent is running (emergency brake)')
})

modTest('a turn ends the countdown at the brake, and the next pause hands over at once with no second countdown', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { window: 200_000, tokens: 160_000 })
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await ui.press({ key: 'not-now' })
  await pauseAt($, world, 180_000)
  expect(await shown(ui)).toBeDefined()
  await startTurn($, 't2')
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  await pause($)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

// A 1000000 window: threshold 200000, emergency brake 350000.
modTest(
  'a context that jumped past the brake over a later handover not capped gets the countdown with no button, not a handover at once',
  TEN,
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on, { tokens: 200_000 })
    const host = hostWith(on)
    await raiseHandoff($)
    const ui = await band($)
    await ui.press({ key: 'not-now' })
    expect(seen.toasts).toEqual(['hands over at 225000 tokens instead of 200000, for this handover only, context 200000 tokens'])
    await pauseAt($, world, 360_000)
    expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 360000 of 350000 · emergency brake')
    await world.clock.settle()
    expect(host.steps).toEqual([])
    await world.clock.advance(10_000)
    expect(host.steps).toEqual([RUN])
  },
)

modTest('a subagent that runs when the countdown runs out postpones the handover and says so, with no attempt counted', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  world.agents = [{ status: 'running' }]
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual(['handoff postponed, a subagent is running, context 210000 tokens'])
  // No attempt, so no minimum gap: the next pause counts down again.
  world.agents = []
  await pauseAt($, world, 211_000)
  expect(await shown(await band($))).toBeDefined()
})

modTest('a turn that started while the countdown began holds the handover when it runs out, also at the brake', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { window: 200_000, tokens: 160_000 })
  const host = hostWith(on)
  await raiseHandoff($)
  await (await band($)).press({ key: 'not-now' })
  // The turn starts while the countdown reads where the session draws, before there is a countdown for it to end.
  world.during.surfaces = async () => void (await startTurn($, 't2'))
  await pauseAt($, world, 180_000)
  expect(await shown(await band($))).toBe('Handing over to a fresh session in 10 s · context 180000 of 180000 · emergency brake')
  await world.clock.advance(10_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts.at(-1)).toBe('handoff postponed, an answer is running, context 180000 tokens')
})

modTest('the diagnostic output names the kind of countdown and the deferred pauses, with no contents', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await toCap($, world)
  await typeInto($, 'one more thing')
  await pauseAt($, world, 205_000)
  await pauseAt($, world, 360_000)
  expect(seen.logs.filter(l => /^\w+: countdown: (none|starts|deferred)/.test(l))).toEqual([
    'debug: countdown: none, a draft waits in the prompt, deferred pauses 0',
    'debug: countdown: none, a draft waits in the prompt, deferred pauses 1',
    'info: countdown: starts, 10 s, method external-command, kind cap, deferred pauses 2',
    'debug: countdown: deferred pauses over, the context shrank',
    'debug: countdown: none, a draft waits in the prompt, deferred pauses 0',
    'debug: countdown: none, at the emergency brake',
  ])
})

modTest(
  'a handover that began starts the deferred pauses over',
  { options: { dry_run: true, countdown_seconds: 10, min_gap_minutes: 0, min_gap_turns: 0 } },
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on, { draft: 'fix the parser' })
    hostWith(on)
    await raiseHandoff($)
    world.draft = ''
    await pauseAt($, world, 211_000)
    // The dry run's handover: it counts as one that began.
    await world.clock.advance(10_000)
    world.draft = 'fix the parser'
    await pauseAt($, world, 212_000)
    await pauseAt($, world, 213_000)
    const ui = await band($)
    expect(await shown(ui)).toBeUndefined()
    await pauseAt($, world, 214_000)
    expect(await shown(ui)).toBe('Would hand over to a fresh session in 10 s · context 214000 of 200000 · your draft stays in the prompt')
  },
)

modTest('a survey holds the countdown: no time counts while it shows, and the countdown goes on with the time it had left', TEN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await world.clock.advance(4_000)
  await survey(ui, true)
  // The band yields to the survey.
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  await survey(ui, false)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 6 s · context 210000 of 200000 · 1: Not now, +25000')
  await world.clock.advance(5_999)
  expect(host.steps).toEqual([])
  await world.clock.advance(1)
  expect(host.steps).toEqual([RUN])
})

modTest('while a survey holds the band the key of Not now is typing: it ends the countdown and moves nothing back', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  const ui = await band($)
  await survey(ui, true)
  await edit($, '', '1', { key: '1' })
  await survey(ui, false)
  expect(await shown(ui)).toBeUndefined()
  await world.clock.advance(60_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
  // Nothing was moved back: the next pause counts down again.
  await pauseAt($, world, 210_000)
  expect(await shown(ui)).toBe('Handing over to a fresh session in 10 s · context 210000 of 200000 · 1: Not now, +25000')
})

modTest('the drawing reports a survey only when it comes or goes, and each change redraws the band once and says so', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  const redraws: string[] = []
  on('ui.invalidate', async (_, e) => (redraws.push(e.event), { value: undefined }))
  await raiseHandoff($)
  const ui = await band($)
  await world.clock.advance(3_500)
  redraws.length = 0
  await survey(ui, true)
  await survey(ui, true)
  await world.clock.advance(60_000)
  expect(redraws).toEqual(['ui.render'])
  await survey(ui, false)
  await survey(ui, false)
  expect(redraws).toEqual(['ui.render', 'ui.render'])
  expect(seen.logs.filter(l => /: countdown: (held|goes on)/.test(l))).toEqual([
    'debug: countdown: held, survey, 7 s left',
    'debug: countdown: goes on, survey gone, 7 s left',
  ])
})

modTest(
  'a survey that comes up while the end of the countdown reads the session holds it there, and it hands over once the survey goes',
  TEN,
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on)
    await raiseHandoff($)
    const ui = await band($)
    world.during['prompt.read'] = () => survey(ui, true)
    await world.clock.advance(10_000)
    await world.clock.advance(60_000)
    expect(host.steps).toEqual([])
    await survey(ui, false)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
  },
)
