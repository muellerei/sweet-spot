import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import {
  commandTurnEnds,
  DRY_RUN,
  endTurn,
  FILE,
  hostWith,
  LIVE,
  NO_GAP,
  NOTES,
  reachThreshold,
  sessionWith,
  startSession,
  startTurn,
  stop,
  withMod,
  type SessionWorld,
  type TestEngine,
  MINUTE,
  DUE,
  HANDED,
  failure,
  fellBack,
  INTERNAL_HANDOFF_ALSO_FAILED,
  modTest,
} from './test-support'

// The handoff through the user's own command, with the dry run off: the command runs as a turn of its own, the end of that turn is
// awaited, the file it names is read, and the session is cleared and fed with it.

const RUN = `run handoff ${ASK_FOR_PATH}`

type World = SessionWorld

modTest('a due handoff runs the command, waits for its turn, reads the file, clears and submits it as the first message', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  expect(host.steps).toEqual([RUN])
  await commandTurnEnds($, world, `All written.\nHANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
  expect(seen.logs).toEqual([DUE, HANDED])
  expect(seen.toasts).toEqual([DUE, HANDED])
})

modTest('the command is started after the stop has returned, not inside it', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  await startTurn($)
  await endTurn($)
  await stop($)
  expect(host.steps).toEqual([])
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('the dry run starts nothing', DRY_RUN, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await reachThreshold($, world)
  expect(host.steps).toEqual([])
})

modTest('the command named is the one run, although another ends in the same name', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: ['claude-mem:handoff', 'handoff'] })
  await reachThreshold($, world)
  expect(host.steps).toEqual([RUN])
})

modTest('without a command of that name nothing runs, and the reason is said', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: ['claude-mem:handoff', 'x:handoff'] })
  await reachThreshold($, world)
  expect(host.steps).toEqual([])
  expect(seen.logs).toEqual([
    DUE,
    fellBack('the command "handoff" does not exist'),
    failure(`the command "handoff" does not exist; ${INTERNAL_HANDOFF_ALSO_FAILED}`),
  ])
})

modTest('a stop before the end of its turn waits for that end, and the end is not the one the handoff awaits', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  await world.clock.settle()
  expect(host.steps).toEqual([])
  await endTurn($, 'answer', { answer: `HANDOFF_PATH: ${FILE}`, turnId: 't1' })
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
})

modTest('the promise of the command settling is not its end: only the end of the following turn goes on, and a subagent ends none', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await world.clock.advance(MINUTE)
  expect(host.steps).toEqual([RUN])
  await startTurn($, 't2')
  await endTurn($, 'answer', { agentId: 'agent-1', answer: `HANDOFF_PATH: ${FILE}`, turnId: 'a1' })
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest("the end of a turn that is not the command's is not the end awaited", LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await startTurn($, 't2')
  await endTurn($, 'answer', { answer: 'Not the handoff.', turnId: 't9' })
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  await endTurn($, 'answer', { answer: `HANDOFF_PATH: ${FILE}`, turnId: 't2' })
  await world.clock.settle()
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
})

modTest('without a path in the answer the newest handoff file written since the command started is taken', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { tmpdir: '/var/T/', files: { '/var/T/handoff-new.md': NOTES } })
  await reachThreshold($, world)
  const now = world.clock.now()
  host.listing = [
    { name: 'handoff-stale.md', mtimeMs: now - 1 },
    { name: 'handoff-new.md', mtimeMs: now + 5 },
    { name: 'handoff-mid.md', mtimeMs: now + 1 },
  ]
  await commandTurnEnds($, world, 'Written, but I forgot the line.')
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
})

modTest('with no TMPDIR the temp directory is /tmp', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { tmpdir: undefined, files: { '/tmp/handoff-a.md': NOTES } })
  await reachThreshold($, world)
  host.listing = [{ name: 'handoff-a.md', mtimeMs: world.clock.now() }]
  await commandTurnEnds($, world, 'no line')
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
})

modTest('the file of the answer wins over a newer one in the temp directory', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES, '/tmp/handoff-newer.md': 'other' } })
  await reachThreshold($, world)
  host.listing = [{ name: 'handoff-newer.md', mtimeMs: world.clock.now() + 9 }]
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps[2]).toBe(`submit ${firstMessage(NOTES)}`)
})

// Each of these leaves the session as it was and says why; a later stop, once the gap has passed, tries again.
const failing: [string, (host: ReturnType<typeof hostWith>) => void, (w: World, $: TestEngine) => Promise<void>, string, string[]][] = [
  [
    'the command does not start',
    host => host.failRun.push('handoff'),
    async () => {},
    'the command "handoff" did not start (no implementation for command.run)',
    [RUN],
  ],
  [
    'its turn is interrupted',
    () => {},
    async (w, $) => {
      await startTurn($, 't2')
      await endTurn($, 'aborted', { turnId: 't2' })
      await w.clock.settle()
    },
    "the command's turn was interrupted",
    [RUN],
  ],
  [
    'its turn fails',
    () => {},
    async (w, $) => {
      await startTurn($, 't2')
      await endTurn($, 'error', { turnId: 't2' })
      await w.clock.settle()
    },
    "the command's turn ended without an answer (error)",
    [RUN],
  ],
  [
    'its turn is refused',
    () => {},
    async (w, $) => {
      await startTurn($, 't2')
      await endTurn($, 'refusal', { turnId: 't2' })
      await w.clock.settle()
    },
    "the command's turn ended without an answer (refusal)",
    [RUN],
  ],
  [
    'its turn never ends',
    () => {},
    async w => {
      await w.clock.advance(5 * MINUTE)
    },
    "the command's turn did not end within 5 minutes",
    [RUN],
  ],
  [
    'no path is named and no file was written',
    () => {},
    async (w, $) => commandTurnEnds($, w, 'Done, trust me.'),
    'the answer names no handoff file and the temp directory has none from this run',
    [RUN],
  ],
  [
    'the file named cannot be read',
    () => {},
    async (w, $) => commandTurnEnds($, w, 'HANDOFF_PATH: /var/T/missing.md'),
    'the handoff file could not be read (sweet-spot: $.fs.read: no such file: /var/T/missing.md)',
    [RUN],
  ],
  ['the file is empty', host => (host.files[FILE] = ' \n'), async (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`), 'the handoff file is empty', [RUN]],
  [
    '/clear fails',
    host => {
      host.files[FILE] = NOTES
      host.failRun.push('clear')
    },
    async (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
    '/clear failed (no implementation for command.run), the session is as it was',
    [RUN, 'run clear'],
  ],
  [
    'the environment cannot be read',
    host => (host.envError = 'denied'),
    async (w, $) => commandTurnEnds($, w, 'no line'),
    'sweet-spot: $.env.get: denied',
    [RUN],
  ],
]

// A handoff the command did not give is tried with the internal handoff next (the tests of that are in their own file); here the internal handoff gives nothing.
// An interrupted turn is the user's own stop and is said as a cancel.
const notReplaced = ['/clear fails', 'the environment cannot be read', 'its turn is interrupted']
for (const [name, arrange, act, own, steps] of failing) {
  const replaced = !notReplaced.includes(name)
  // A failure at /clear leaves the fallback nothing to try: it needs /clear too, and the reason says so.
  const reason = replaced ? `${own}; ${INTERNAL_HANDOFF_ALSO_FAILED}` : name === '/clear fails' ? `${own}; the fallback needs /clear too` : own
  modTest(`when ${name}, the session is left as it was, the reason is said, and a later stop tries again`, NO_GAP, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on)
    arrange(host)
    await reachThreshold($, world)
    await act(world, $)
    expect(host.steps).toEqual(steps)
    const ending = name === 'its turn is interrupted' ? 'cancelled, the session is as it was' : failure(reason)
    const said = replaced ? [DUE, fellBack(own), ending] : [DUE, ending]
    expect(seen.logs).toEqual(said)
    expect(seen.toasts).toEqual(said)
    host.failRun = []
    host.envError = undefined
    await startTurn($, 't3')
    await endTurn($, 'answer', { turnId: 't3' })
    await stop($)
    await world.clock.settle()
    expect(host.steps.filter(s => s === RUN)).toHaveLength(2)
  })
}

modTest('a message that does not reach the fresh session says so and where the handoff is', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, dropSubmit: 'held' })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
  expect(seen.logs).toEqual([DUE, failure(`the fresh session did not get the handoff (a hook dropped it: held); it is in ${FILE}`)])
})

modTest('a submit that throws says so in the same way', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES }, rejectSubmit: true })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toEqual([DUE, failure(`the fresh session did not get the handoff (no implementation for prompt.submit); it is in ${FILE}`)])
})

modTest('the end of the command turn after the wait timed out starts nothing', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await world.clock.advance(5 * MINUTE)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN])
})

// The time limit of one wait must not reach into the next.
modTest('the time limit of a finished wait does not end the wait of the next handoff', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  await world.clock.advance(MINUTE)
  await stop($)
  await world.clock.settle()
  await world.clock.advance(4 * MINUTE)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`, 't3')
  expect(host.steps.filter(s => s === 'run clear')).toHaveLength(2)
})

modTest('a command that did not start leaves no wait behind for the next handoff', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, failRun: ['handoff'] })
  await reachThreshold($, world)
  host.failRun = []
  await world.clock.advance(MINUTE)
  await stop($)
  await world.clock.settle()
  await world.clock.advance(4 * MINUTE)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps.filter(s => s === 'run clear')).toHaveLength(1)
})

// The loop guard. A handoff that leaves the context where it was, or a fresh session that starts over the threshold, must not hand over
// again at every pause.
modTest('without the minimum gap a second handoff follows at the next pause', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  await stop($)
  await world.clock.settle()
  expect(host.steps.filter(s => s === RUN)).toHaveLength(2)
})

modTest('after a handoff the minimum gap holds the next one back, said once, until the minutes or the turns have passed', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  await stop($)
  await world.clock.settle()
  expect(host.steps.filter(s => s === RUN)).toHaveLength(1)
  expect(seen.logs).toEqual([DUE, HANDED, 'handoff postponed, the minimum gap since the last attempt has not passed, context 210000 tokens'])
  await world.clock.advance(10 * MINUTE)
  await stop($)
  await world.clock.settle()
  expect(host.steps.filter(s => s === RUN)).toHaveLength(2)
})

modTest('the stop that ends the command turn itself is no pause to act on, said nothing of, even with no gap', NO_GAP, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await startTurn($, 't2')
  await stop($)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  expect(seen.logs).toEqual([DUE])
  await endTurn($, 'answer', { answer: `HANDOFF_PATH: ${FILE}`, turnId: 't2' })
  await world.clock.settle()
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
})

// The stop is a hook the turn waits on; nothing that goes wrong in the mod may keep the turn from ending.
modTest('a stop whose reading of the session fails still ends, says so once, and a later stop is judged afresh', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { usageError: 'no usage' })
  const host = hostWith(on)
  await startSession($)
  await endTurn($)
  expect(await stop($)).toEqual({})
  expect(await stop($)).toEqual({})
  const line = 'could not check for a handoff (no implementation for session.usage)'
  expect(seen.logs).toEqual([line])
  world.usageError = undefined
  await stop($)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})
