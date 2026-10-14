import { expect } from 'claude-code/testing'

import { LIVE_IDLE, T, answer, idleLines, idleSession } from './idle-support'
import { MINUTE, answered, modTest, runRelay, submits, typeInto, type TestEngine } from './test-support'

// Coming back after a long pause with the handoff written: with the cache expired the message goes into a fresh session with the handoff in
// front of it; with the cache still warm, with work running or with an attachment it stays in this session, and the handoff written goes.

const HANDOFF = 'Handoff from the previous session. Read it and carry on with the next step.\n\ngoal: finish the parser'
const BACK = 'hello again'
const FIRST = `${HANDOFF}\n\nThe person's next message:\n${BACK}`
const HELD = 'sweet-spot: your message is held for a moment and goes in right after'
const SWITCHED = 'fresh session after 2 h 10 min idle, the old one is in /resume'
const WORK = 'work is still running and would report into a fresh session, so this message stays in this session'
const ATTACHMENTS = 'attachments cannot be carried over, so this message stays in this session'

// The answer ends at minute 0 and the handoff is written at minute 55, which reads the cache and so keeps it an hour from then.
const prepared = async ($: TestEngine, world: { clock: { advance: (ms: number) => Promise<void> } }, stopInput: object = {}) => {
  await answer($, 't1', stopInput)
  await world.clock.advance(55 * MINUTE)
}

modTest('a message after the cache expired starts a fresh session with the handoff and the message, and says so', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  expect(await typeInto($, BACK)).toEqual({ drop: HELD })
  // The switch comes after the submit hook: the host refuses a /clear from a hook that holds a turn.
  expect(host.steps).toEqual([])
  await world.clock.settle()
  expect(host.steps).toEqual(['run clear', `submit ${FIRST}`])
  expect(seen.toasts).toEqual([SWITCHED])
  expect(idleLines(seen.logs)).toContain('info: idle: return after the cache expired, handing over')
})

modTest('a message while the cache is still warm goes into this session as it is, and the handoff written goes', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  // The handoff read the cache at minute 55: at minute 115 it is still warm, an hour after the person's last request or not.
  await world.clock.advance(59 * MINUTE)
  expect(await typeInto($, BACK)).toEqual({ text: BACK })
  await world.clock.advance(120 * MINUTE)
  expect(await typeInto($, 'later on')).toEqual({ text: 'later on' })
  await world.clock.settle()
  expect(host.steps).toEqual([`submit ${BACK}`, 'submit later on'])
  expect(seen.toasts).toEqual([])
  expect(idleLines(seen.logs)).toContain('debug: idle: return while the cache is warm, the handoff written is dropped')
})

for (const [name, setUp] of [
  ['a subagent runs', (w: { agents: { status: string }[] }) => void (w.agents = [{ status: 'running' }])],
  ['a background task runs', undefined],
] as const) {
  modTest(`a message after the cache expired stays in this session while ${name}, and says why`, LIVE_IDLE, async ($, on) => {
    const { seen, world, host } = idleSession(on)
    await prepared($, world, setUp === undefined ? { background_tasks: [{ status: 'running' }] } : {})
    setUp?.(world)
    await world.clock.advance(75 * MINUTE)
    expect(await typeInto($, BACK)).toEqual({ text: BACK })
    await world.clock.settle()
    expect(host.steps).toEqual([`submit ${BACK}`])
    expect(seen.toasts).toEqual([WORK])
  })
}

modTest('a message with an attachment stays in this session with its attachment, and says why', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  const attachments = [{ type: 'image' }]
  expect(await typeInto($, BACK, { attachments })).toMatchObject({ text: BACK })
  await world.clock.settle()
  expect(host.steps).toEqual([`submit ${BACK}`])
  expect(seen.toasts).toEqual([ATTACHMENTS])
})

modTest('a slash command and what other parts of the system send go through and leave the handoff written', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  expect(await typeInto($, '/model')).toEqual({ text: '/model' })
  expect(await typeInto($, 'from a plugin', { origin: { kind: 'plugin', name: 'other' } })).toEqual({ text: 'from a plugin' })
  expect(await typeInto($, '   ')).toEqual({ text: '   ' })
  expect(await typeInto($, BACK)).toEqual({ drop: HELD })
  await world.clock.settle()
  expect(host.steps).toEqual(['submit /model', 'submit from a plugin', 'submit    ', 'run clear', `submit ${FIRST}`])
  expect(seen.toasts).toEqual([SWITCHED])
})

modTest('a second message while the first is judged is held and goes into the fresh session after it, with one handoff', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  let second: unknown
  world.during['agent.list'] = async () => {
    second = await typeInto($, 'and this')
  }
  expect(await typeInto($, BACK)).toEqual({ drop: HELD })
  expect(second).toEqual({ drop: HELD })
  await world.clock.settle()
  expect(host.steps).toEqual(['run clear', `submit ${FIRST}\n\nand this`])
})

modTest('a message typed while the switch runs is held and goes into the fresh session after the handoff', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  let late: unknown
  host.during['run clear'] = async () => {
    late = await typeInto($, 'and this')
  }
  await typeInto($, BACK)
  await world.clock.settle()
  expect(late).toEqual({ drop: 'sweet-spot: a handover is in progress, your message is held and goes in when it is done' })
  expect(host.steps).toEqual(['run clear', `submit ${FIRST}`, 'submit and this'])
})

modTest('a message held while the warm cache is judged goes in after the first', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(30 * MINUTE)
  world.during['agent.list'] = async () => void (await typeInto($, 'and this'))
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps).toEqual([`submit ${BACK}`, 'submit and this'])
})

modTest('the switch spends later and asap like any handover', LIVE_IDLE, async ($, on) => {
  const { seen, world } = idleSession(on)
  // Asked before the handoff is written: once it is, `later` drops it.
  await answer($)
  world.tokens = 210_000
  await runRelay($, 'later')
  await world.clock.advance(130 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(seen.logs).toContain('debug: later: spent by this handover')
})

modTest('the message left in the prompt after the switch is cleared from it; anything else there stays', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  // The host leaves a message that a hook turned away in the prompt, and text there survives /clear.
  world.draft = BACK
  await typeInto($, BACK)
  await world.clock.settle()
  expect(world.draft).toBe('')
})

modTest('a draft the person changed after the switch began stays in the prompt', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  world.draft = `${BACK}, and more`
  await typeInto($, BACK)
  await world.clock.settle()
  expect(world.draft).toBe(`${BACK}, and more`)
})

modTest('a /clear that fails leaves the session as it was, and the message goes into it', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { failRun: ['clear'] })
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps).toEqual(['run clear', `submit ${BACK}`])
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toStartWith('handover failed, /clear failed (')
})

modTest('a submit that fails after the /clear keeps the message for redeliver', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { rejectSubmit: true })
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`])
  expect(host.store.get('pending:old')).toBe(FIRST)
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toStartWith('handover failed, the fresh session did not get the handoff (')
})

modTest(
  'in a dry run a message after the cache expired says what would have happened and goes into this session',
  { options: { dry_run: true } },
  async ($, on) => {
    const { seen, world, host } = idleSession(on)
    await prepared($, world)
    await world.clock.advance(75 * MINUTE)
    expect(await typeInto($, BACK)).toEqual({ text: BACK })
    await world.clock.settle()
    expect(host.steps).toEqual([`submit ${BACK}`])
    expect(seen.toasts).toEqual(['dry run, would start a fresh session with the idle handoff now'])
  },
)

modTest('the lines of the return say nothing of what was typed', LIVE_IDLE, async ($, on) => {
  const { seen, world } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(seen.logs.filter(l => l.includes(BACK) || l.includes('finish the parser') || l.includes(T))).toEqual([])
})

// `/sweet-spot asap` at rest with the handoff written: cold, it hands over the handoff that was paid for; warm, a fresh one costs little and
// carries everything up to now.
modTest('asap with the handoff written and cold hands that handoff over and writes none anew', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(75 * MINUTE)
  await runRelay($, 'asap')
  // The step of `asap` at rest comes a moment after its answer.
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}`])
  expect(seen.toasts).toEqual(['handed over, the fresh session carries on from the handoff'])
  expect(idleLines(seen.logs)).toContain('info: idle: asap hands over the handoff written')
})

modTest('asap with the handoff written and warm drops it and writes a new one', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await prepared($, world)
  await world.clock.advance(10 * MINUTE)
  await runRelay($, 'asap')
  // The step of `asap` at rest comes a moment after its answer.
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.modelForkPrompts).toHaveLength(2)
  expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}`])
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, asap with the cache warm, the handoff written is dropped')
})

modTest('asap with the handoff written waits for running work, and the handoff stays', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await prepared($, world, { background_tasks: [{ status: 'running' }] })
  await world.clock.advance(75 * MINUTE)
  await runRelay($, 'asap')
  // The step of `asap` at rest comes a moment after its answer.
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.steps).toEqual([])
  expect(await answered(runRelay($, 'status'))).toContain(', idle handoff ready, goes with your next message')
})

// That the handoff written keeps the cache an hour longer is measured, and could change in the host. The first request after a warm return
// shows it: one that misses the cache means the touch stays with the person's own requests for the rest of the session.
const HIT = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 119_000, cache_creation_input_tokens: 1_000 }
const MISS = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 119_000 }
const DOUBTED = 'warn: idle: the request after a warm return missed the cache, the handoff written no longer counts as reading it'

// A warm return at minute 85, and its turn with one request; the turn ends at minute 85 and plans the next handoff for minute 140.
const warmReturn = async ($: TestEngine, world: { clock: { advance: (ms: number) => Promise<void> } }, turnId: string) => {
  await world.clock.advance(30 * MINUTE)
  await typeInto($, BACK)
  await answer($, turnId, {}, false)
}

modTest('a request after a warm return that misses the cache stops the handoff written from counting as a read', LIVE_IDLE, async ($, on) => {
  const { seen, world, host, requests } = idleSession(on)
  await prepared($, world)
  requests.usage = MISS
  await warmReturn($, world, 't2')
  expect(seen.logs.filter(l => l === DOUBTED)).toHaveLength(1)
  // Written at minute 140; 61 minutes after the person's last request the cache is cold, whatever the handoff read.
  await world.clock.advance(61 * MINUTE)
  await typeInto($, 'and now')
  await world.clock.settle()
  expect(host.steps).toContain('run clear')
})

modTest('a request after a warm return that reads the cache leaves things as they are', LIVE_IDLE, async ($, on) => {
  const { seen, world, host, requests } = idleSession(on)
  await prepared($, world)
  requests.usage = HIT
  await warmReturn($, world, 't2')
  await world.clock.advance(61 * MINUTE)
  await typeInto($, 'and now')
  await world.clock.settle()
  expect(host.steps).not.toContain('run clear')
  expect(seen.logs).not.toContain(DOUBTED)
})

modTest('a long message pasted on a warm return is no miss: the check measures against the context, not the request', LIVE_IDLE, async ($, on) => {
  const { seen, world, requests } = idleSession(on)
  await prepared($, world)
  // The whole context of 120000 read from the cache, and 40000 of pasted text written: 75 percent of the request, all of the context.
  requests.usage = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 40_000 }
  await warmReturn($, world, 't2')
  expect(seen.logs).not.toContain(DOUBTED)
})

modTest('a request with no answer after a warm return checks nothing', LIVE_IDLE, async ($, on) => {
  const { seen, world, requests } = idleSession(on)
  await prepared($, world)
  requests.usage = null
  await warmReturn($, world, 't2')
  requests.usage = MISS
  await answer($, 't3', {}, false)
  expect(seen.logs).not.toContain(DOUBTED)
})

modTest('the doubt is said once in the session', LIVE_IDLE, async ($, on) => {
  const { seen, world, requests } = idleSession(on)
  await prepared($, world)
  requests.usage = MISS
  await warmReturn($, world, 't2')
  // Written at minute 140; back at 141, 56 minutes after the person's last request: warm again, and missed again.
  await world.clock.advance(56 * MINUTE)
  expect(await typeInto($, 'and now')).toEqual({ text: 'and now' })
  await answer($, 't3', {}, false)
  expect(seen.logs.filter(l => l === DOUBTED)).toHaveLength(1)
})
