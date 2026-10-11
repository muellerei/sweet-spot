import { expect } from 'claude-code/testing'

import { firstMessage } from './handoff'
import {
  answered,
  commandTurnEnds,
  dropped,
  endTurn,
  FILE,
  hostWith,
  LIVE,
  NO_GAP,
  NOTES,
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
  failure,
  INTERNAL_HANDOFF_ALSO_FAILED,
  PENDING,
  submits,
  modTest,
} from './test-support'

// The reason a handoff failed is kept in the store, where `/clear` does not reach it, and the message that did not reach the fresh session
// stays pending until `/sweet-spot redeliver` submits it.

const FIRST = firstMessage(NOTES)
const NOTHING = 'nothing to redeliver'
const USAGE =
  'use `/sweet-spot status` to see where the context stands, `/sweet-spot later [tokens]` to move the next handover back, or `/sweet-spot redeliver` to submit again the handoff that did not reach the fresh session'
const REDELIVERING = 'redelivering the handoff'

modTest('the command is registered when a session starts, and not again at its first turn', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startSession($)
  await startTurn($, 't1')
  expect(seen.registered).toEqual(['sweet-spot'])
  // Immediate: typed while an answer runs, it runs at once instead of after the pause that ends the answer has been judged.
  expect(seen.menu).toEqual([
    {
      name: 'sweet-spot',
      description: 'Show where the context stands, move the next handover back, or submit again the handoff that did not reach the fresh session',
      argumentHint: 'status | later [tokens] | redeliver',
      immediate: true,
    },
  ])
})

modTest('a mod loaded into a running session registers the command at its first turn, once', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await startTurn($, 't2')
  expect(seen.registered).toEqual(['sweet-spot'])
})

modTest('a command the host refuses is said, and the mod goes on without it', async ($, on) => {
  const seen = withMod(on)
  seen.refuse = 'taken'
  sessionWith(on)
  await startSession($)
  await startTurn($, 't1')
  expect(seen.logs).toEqual(['could not register its command (sweet-spot: $.command.register: taken)'])
})

modTest('a pending message from an earlier handoff is not mistaken for the typing of a later one, and stays to be redelivered', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  host.commands = []
  await startTurn($, 't3')
  await endTurn($, 'answer', { turnId: 't3' })
  await stop($)
  await typeInto($, 'typed meanwhile')
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`, 'submit typed meanwhile'])
  expect(host.store.get(PENDING)).toBe(FIRST)
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(submits(host).at(-1)).toBe(`submit ${FIRST}`)
  expect(host.store.has(PENDING)).toBe(false)
})

modTest('redeliver submits the first message that did not arrive, into the session as it is, once, and then it is no longer pending', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  expect(host.store.get(PENDING)).toBe(FIRST)
  expect(await answered(runRelay($, 'redeliver'))).toBe(REDELIVERING)
  await world.clock.settle()
  expect(host.steps.filter(s => s === 'run clear')).toHaveLength(1)
  expect(submits(host)).toEqual([`submit ${FIRST}`, `submit ${FIRST}`])
  expect(host.store.has(PENDING)).toBe(false)
  expect(host.store.has('failure')).toBe(false)
  expect(seen.logs.at(-1)).toBe('redelivered, the fresh session carries on from the handoff')
  expect(await answered(runRelay($, 'redeliver'))).toBe(NOTHING)
  await world.clock.settle()
  expect(submits(host)).toHaveLength(2)
})

modTest('redeliver carries the typing that was held with the first message', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  host.dropSubmit = 'held by another hook'
  await reachThreshold($, world)
  await typeInto($, 'also this')
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  host.dropSubmit = undefined
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(submits(host).at(-1)).toBe(`submit ${FIRST}\n\nTyped while the handoff ran:\nalso this`)
})

modTest('a redelivery that fails leaves the message pending, says why, and keeps the new reason', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  host.dropSubmit = 'still held'
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(host.store.get(PENDING)).toBe(FIRST)
  const reason = 'the fresh session did not get the handoff (a hook dropped it: still held)'
  expect(seen.logs.at(-1)).toBe(failure(reason))
  expect(host.store.get('failure')).toEqual({ at: expect.any(Number), sessionId: 'new', stage: 'submit', reason })
  host.dropSubmit = undefined
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(host.store.has(PENDING)).toBe(false)
})

modTest('redeliver with nothing pending says so and submits nothing', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  expect(await answered(runRelay($, 'redeliver'))).toBe(NOTHING)
  await world.clock.settle()
  expect(submits(host)).toEqual([])
})

modTest('redeliver never submits what another session left pending', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { store: new Map([['pending:other', 'not mine']]) })
  await startSession($)
  expect(await answered(runRelay($, 'redeliver'))).toBe(NOTHING)
  await world.clock.settle()
  expect(submits(host)).toEqual([])
  expect(host.store.get('pending:other')).toBe('not mine')
})

modTest('redeliver in a session other than the one the handoff was meant for submits nothing and leaves the message pending', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  host.sessionId = 'elsewhere'
  expect(await answered(runRelay($, 'redeliver'))).toBe(REDELIVERING)
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`])
  expect(host.store.get(PENDING)).toBe(FIRST)
  expect(seen.logs.at(-1)).toBe('handover failed, the message belongs to another session than this one')
})

modTest('a second redelivery while the first is under way submits nothing more', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  expect(await answered(runRelay($, 'redeliver'))).toBe(REDELIVERING)
  expect(await answered(runRelay($, 'redeliver'))).toBe('a redelivery is under way')
  await world.clock.settle()
  expect(submits(host)).toHaveLength(2)
})

modTest('redeliver while a handoff is under way is refused, as the message is not yet known to have failed', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  let said: string | undefined
  host.during['run clear'] = async () => void (said = await answered(runRelay($, 'redeliver')))
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(said).toBe('a handover is in progress, try again when it is done')
  expect(submits(host)).toEqual([`submit ${FIRST}`])
})

modTest('redeliver when the store cannot be read says why and leaves the message pending', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  host.failStore.push(`get:${PENDING}`)
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(seen.logs.at(-1)).toBe(failure('sweet-spot: $.store.get: store is down'))
  host.failStore = []
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(host.store.has(PENDING)).toBe(false)
})

// The command runs at once while an answer runs, and a redelivery submits a message: it waits until the answer is done.
modTest('redeliver while an answer runs is turned down and changes nothing, and works once the answer is done', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  await startTurn($, 't5')
  expect(await answered(runRelay($, 'redeliver'))).toBe('an answer is running, try again when it is done')
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`])
  expect(host.store.get(PENDING)).toBe(FIRST)
  await endTurn($, 'answer', { turnId: 't5' })
  expect(await answered(runRelay($, 'redeliver'))).toBe(REDELIVERING)
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`, `submit ${FIRST}`])
})

modTest('an answer that ends without an answer, aborted or in an error, no longer counts as running', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await dropped($, world, host)
  await startTurn($, 't5')
  await endTurn($, 'aborted', { turnId: 't5' })
  expect(await answered(runRelay($, 'redeliver'))).toBe(REDELIVERING)
})

// Settings it cannot trust stop the mod after the start of a turn is seen, before its end is: the answer must not seem to run on.
modTest('with settings it cannot trust, redeliver after an answer has nothing to redeliver', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  withMod(on)
  sessionWith(on)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  expect(await answered(runRelay($, 'redeliver'))).toBe(NOTHING)
})

for (const args of ['', 'help', 'redeliver now', 'REDELIVER']) {
  modTest(`the command with "${args}" tells what it does and submits nothing`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES } })
    await dropped($, world, host)
    // An argument the command does not know is named, so that `wait 10000` does not read as a hint about something else.
    expect(await answered(runRelay($, args))).toBe(args.trim() === '' ? USAGE : `unknown argument "${args}", ${USAGE}`)
    await world.clock.settle()
    expect(submits(host)).toEqual([`submit ${FIRST}`])
  })
}

// Each of these leaves the session as it was or the first message pending, and the reason where `/clear` does not reach it.
const reasons: [string, string, (host: Host) => void, (world: SessionWorld, $: TestEngine) => Promise<void>, string, string][] = [
  ['the command does not exist', 'command', host => (host.commands = []), async () => {}, 'the command "handoff" does not exist', 'old'],
  [
    'its turn is interrupted',
    'cancelled',
    () => {},
    async (w, $) => {
      await startTurn($, 't2')
      await endTurn($, 'aborted', { turnId: 't2' })
      await w.clock.settle()
    },
    "the command's turn was interrupted",
    'old',
  ],
  [
    'no path is named',
    'path',
    () => {},
    (w, $) => commandTurnEnds($, w, 'Done.'),
    'the answer names no handoff file and the temp directory has none from this run',
    'old',
  ],
  ['the file is empty', 'read', host => (host.files[FILE] = ' '), (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`), 'the handoff file is empty', 'old'],
  [
    '/clear fails',
    'clear',
    host => {
      host.files[FILE] = NOTES
      host.failRun.push('clear')
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
    '/clear failed (no implementation for command.run), the session is as it was',
    'old',
  ],
  [
    'the first message is dropped',
    'submit',
    host => {
      host.files[FILE] = NOTES
      host.dropSubmit = 'held by another hook'
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
    `the fresh session did not get the handoff (a hook dropped it: held by another hook); it is in ${FILE}`,
    'old',
  ],
  [
    'the environment cannot be read',
    'error',
    host => (host.envError = 'denied'),
    (w, $) => commandTurnEnds($, w, 'no line'),
    'sweet-spot: $.env.get: denied',
    'old',
  ],
]
// Where the command gave no handoff the internal handoff was tried, and failed here: the last stage is `model-fork` and the reason names both.
const missing = ['command', 'turn', 'path', 'read']
for (const [name, first, arrange, act, own, sessionId] of reasons) {
  const stage = missing.includes(first) ? 'model-fork' : first
  const reason = stage === 'model-fork' ? `${own}; ${INTERNAL_HANDOFF_ALSO_FAILED}` : stage === 'clear' ? `${own}; the fallback needs /clear too` : own
  modTest(`when ${name}, the reason is kept in the store with the stage and the session`, NO_GAP, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on)
    arrange(host)
    await reachThreshold($, world)
    await act(world, $)
    expect(host.store.get('failure')).toEqual({ at: world.clock.now(), sessionId, stage, reason })
    expect(seen.logs.at(-1)).toBe(stage === 'cancelled' ? 'cancelled, the session is as it was' : failure(reason))
  })
}

modTest('a handoff that succeeds takes the reason of an earlier failure out of the store', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [] })
  await reachThreshold($, world)
  expect(host.store.has('failure')).toBe(true)
  host.commands = ['handoff']
  host.files[FILE] = NOTES
  await startTurn($, 't3')
  await endTurn($, 'answer', { turnId: 't3' })
  await stop($)
  await world.clock.settle()
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`, 't4')
  expect(host.store.has('failure')).toBe(false)
})

modTest('a reason that cannot be written to the store does not change what is said or done', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], failStore: ['set:failure'] })
  await reachThreshold($, world)
  expect(seen.logs.at(-1)).toBe(failure(`the command "handoff" does not exist; ${INTERNAL_HANDOFF_ALSO_FAILED}`))
  expect(host.store.has('failure')).toBe(false)
})

modTest('a pending message that cannot be removed after the submit gets through is no failure, and is not sent again', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, failStore: [`delete:${PENDING}`] })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs.at(-1)).toBe('handed over, the fresh session carries on from the handoff')
  expect(await answered(runRelay($, 'redeliver'))).toBe(NOTHING)
  await world.clock.settle()
  expect(submits(host)).toEqual([`submit ${FIRST}`])
})
