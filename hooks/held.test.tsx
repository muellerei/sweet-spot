import { test, expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import {
  commandTurnEnds,
  endTurn,
  FILE,
  hostWith,
  LIVE,
  NO_GAP,
  NOTES,
  raiseHandoff,
  reachThreshold,
  runRelay,
  sessionWith,
  startSession,
  startTurn,
  stop,
  typeInto,
  withMod,
  type Host,
  type SessionWorld,
  type TestEngine,
  FORK_ALSO,
  PENDING,
  submits,
} from './test-support'

// What the person types while a handoff runs, and what is left to put right when the handoff does not get through: the typing is held
// and goes in once, the first message that did not arrive stays pending, and `/context-relay redeliver` submits it again.

const RUN = `run handoff ${ASK_FOR_PATH}`
const HELD = 'context-relay: a handoff is in progress, your message is held and goes in when it is done'
const NO_ATTACHMENTS = 'context-relay: a handoff is in progress and attachments cannot be held, send the message again when it is done'
const HEAD = 'Typed while the handoff ran:'
const FIRST = firstMessage(NOTES)
const withHeld = (...items: string[]) => `${FIRST}\n\n${HEAD}\n${items.join('\n\n')}`

test('typing while the handoff runs is held, and goes into the first message of the fresh session, once', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  expect(await typeInto($, 'also fix the lexer')).toEqual({ drop: HELD })
  expect(host.steps).toEqual([RUN])
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${withHeld('also fix the lexer')}`])
})

test('several inputs are held in the order typed, and one typed twice is held twice', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  expect(await typeInto($, 'first')).toEqual({ drop: HELD })
  expect(await typeInto($, 'second')).toEqual({ drop: HELD })
  expect(await typeInto($, 'first')).toEqual({ drop: HELD })
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(submits(host)).toEqual([`submit ${withHeld('first', 'second', 'first')}`])
})

test('typing is not held when no handoff is running, nor once it is over', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await startSession($)
  expect(await typeInto($, 'before')).toEqual({ text: 'before' })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(await typeInto($, 'after')).toEqual({ text: 'after' })
  expect(submits(host)).toEqual(['submit before', `submit ${FIRST}`, 'submit after'])
})

// Only what a person types at the prompt is held: a command still runs, and what other parts of the system send is theirs.
const passing: [string, string, object][] = [
  ['a slash command', '/status', {}],
  ['a slash command with a leading space', '  /status', {}],
  ['blank typing', '  \n ', {}],
  ['a message from the SDK', 'from the sdk', { origin: { kind: 'sdk' } }],
  ['a message from a plugin', 'from a plugin', { origin: { kind: 'plugin', name: 'other' } }],
]
for (const [name, text, extra] of passing) {
  test(`${name} is not held while a handoff runs`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES } })
    await reachThreshold($, world)
    expect(await typeInto($, text, extra)).toEqual({ text })
    expect(submits(host)).toEqual([`submit ${text}`])
    await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
    expect(submits(host).at(-1)).toBe(`submit ${FIRST}`)
  })
}

test('an input with attachments is turned away whole, as attachments cannot be held', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  expect(await typeInto($, 'look at this', { attachments: [{ type: 'image' }] })).toEqual({ drop: NO_ATTACHMENTS })
  expect(await typeInto($, '', { attachments: [{ type: 'image' }] })).toEqual({ drop: NO_ATTACHMENTS })
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(submits(host)).toEqual([`submit ${FIRST}`])
})

test('typing that comes after the first message is built goes in after it, once, as a message of its own', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  host.during['run clear'] = async () => void (await typeInto($, 'late one'))
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${FIRST}`, 'submit late one'])
})

test('typing that comes while the late typing is being submitted goes in as well', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  host.during['run clear'] = async () => void (await typeInto($, 'late one'))
  await reachThreshold($, world)
  host.during.submit = async () => {
    host.during.submit = async () => void (await typeInto($, 'later still'))
  }
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${FIRST}`, 'submit late one', 'submit later still'])
  expect(await typeInto($, 'now')).toEqual({ text: 'now' })
})

test('typing that comes once everything held is settled is not held, even while the outcome is still being written down', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [] })
  let answer: unknown
  host.during['set failure'] = async () => void (answer = await typeInto($, 'right after'))
  await reachThreshold($, world)
  expect(answer).toEqual({ text: 'right after' })
  expect(submits(host)).toEqual(['submit right after'])
})

test('typing held in one handoff is not carried into the next', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await typeInto($, 'only once')
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  await startTurn($, 't3')
  await endTurn($, 'answer', { turnId: 't3' })
  await stop($)
  expect(await typeInto($, 'only once')).toEqual({ drop: HELD })
  await world.clock.settle()
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`, 't4')
  expect(submits(host)).toEqual([`submit ${withHeld('only once')}`, `submit ${withHeld('only once')}`])
})

// The handoff does not get through before the session is cleared: it stays as it was, the typing goes back into it once, and the
// session takes new typing again.
const before: [string, (host: Host) => void, (world: SessionWorld, $: TestEngine) => Promise<void>][] = [
  ['the command does not exist', host => (host.commands = []), async () => {}],
  [
    'its turn is interrupted',
    () => {},
    async (w, $) => {
      await startTurn($, 't2')
      await endTurn($, 'aborted', { turnId: 't2' })
      await w.clock.settle()
    },
  ],
  ['the file is empty', host => (host.files[FILE] = ' '), (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`)],
  ['the environment cannot be read', host => (host.envError = 'denied'), (w, $) => commandTurnEnds($, w, 'no line')],
  [
    '/clear fails',
    host => {
      host.files[FILE] = NOTES
      host.failRun.push('clear')
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
  ],
  [
    'the pending message cannot be kept',
    host => {
      host.files[FILE] = NOTES
      host.failStore.push(`set:${PENDING}`)
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
  ],
]
for (const [name, arrange, act] of before) {
  test(`when ${name}, the typing goes back into the session once, and nothing is left pending`, NO_GAP, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { commands: ['handoff'] })
    arrange(host)
    await raiseHandoff($)
    expect(await typeInto($, 'one')).toEqual({ drop: HELD })
    expect(await typeInto($, 'two')).toEqual({ drop: HELD })
    await world.clock.settle()
    await act(world, $)
    expect(submits(host)).toEqual(['submit one\n\ntwo'])
    expect(host.store.has(PENDING)).toBe(false)
    expect(await typeInto($, 'three')).toEqual({ text: 'three' })
  })
}

// The typing cannot go back either: it is kept for redelivery, and the failure says so beside its own reason.
test('typing that cannot go back into the session is kept for redelivery, and the failure says so', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], rejectSubmit: true })
  await raiseHandoff($)
  await typeInto($, 'one')
  await typeInto($, 'two')
  await world.clock.settle()
  expect(host.store.get(PENDING)).toBe('one\n\ntwo')
  expect(seen.logs.at(-1)).toBe(
    `handoff failed, the command "handoff" does not exist; ${FORK_ALSO}; the typing held meanwhile could not be put back (no implementation for prompt.submit), \`/context-relay redeliver\` submits it`,
  )
})

// The first message did not reach the fresh session: it is kept, with the typing that was held, and says where it is.
for (const [name, arrange] of [
  ['a hook drops it', (host: Host) => (host.dropSubmit = 'held by another hook')],
  ['the submit throws', (host: Host) => (host.rejectSubmit = true)],
] as const) {
  test(`when ${name}, the first message stays pending with all the typing in it, and the typing after it is added`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES } })
    host.during['run clear'] = async () => void (await typeInto($, 'late one'))
    arrange(host)
    await reachThreshold($, world)
    await typeInto($, 'early one')
    await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
    expect(submits(host)).toEqual([`submit ${withHeld('early one')}`])
    expect(host.store.get(PENDING)).toBe(`${withHeld('early one')}\n\nlate one`)
    host.dropSubmit = undefined
    host.rejectSubmit = false
    expect(await typeInto($, 'next')).toEqual({ text: 'next' })
  })
}

test('late typing that cannot be submitted after a handoff is kept for redelivery, and the failure says so', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, rejectSubmitAfter: 1 })
  host.during['run clear'] = async () => void (await typeInto($, 'late one'))
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(submits(host)).toEqual([`submit ${FIRST}`, 'submit late one'])
  expect(host.store.get('pending:new')).toBe('late one')
  expect(seen.logs.at(-1)).toBe(
    'handoff failed, the typing held meanwhile could not be put back (no implementation for prompt.submit), `/context-relay redeliver` submits it',
  )
})

test('typing that can be neither put back nor kept is named in the failure, so it is not lost unseen', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [], rejectSubmit: true, failStore: ['set:*'] })
  await raiseHandoff($)
  await typeInto($, 'precious')
  await world.clock.settle()
  expect(seen.logs.at(-1)).toBe(
    `handoff failed, the command "handoff" does not exist; ${FORK_ALSO}; the typing held meanwhile could not be put back (no implementation for prompt.submit) or kept (context-relay: $.store.set: store is down), it is lost: precious`,
  )
})
