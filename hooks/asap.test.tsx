import { expect, test } from 'claude-code/testing'

import { ASK_FOR_PATH } from './handoff'
import {
  answered,
  endTurn,
  COMPACT_DONE,
  COMPACT_VETO,
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
  withMod,
  type SessionWorld,
  type TestEngine,
} from './test-support'
import { freshState } from './state'

// `/sweet-spot asap` hands the session over at the next pause, wherever the context stands: it lifts the threshold and the minimum gap, not the
// wait for running work. The window is 1000000 tokens unless a test says otherwise: threshold 200000, emergency brake 350000.

// A dry run with no gap: the pause says it would hand over, and nothing else happens.
const DRY = { options: { dry_run: true, min_gap_minutes: 0, min_gap_turns: 0 } }

const wouldHandOver = (tokens: number) => `dry run, would hand over now, context ${tokens} tokens`

// The command is typed while an answer runs: the context is what the last answer left.
const asap = async ($: TestEngine, world: SessionWorld, tokens: number | undefined, args = 'asap') => {
  world.tokens = tokens
  await startTurn($, 'running')
  return answered(runRelay($, args))
}

modTest('in a dry run asap says it would hand over, and the next pause below the threshold does, once', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await asap($, world, 150_000)).toBe('dry run, would hand over at the next pause, context 150000 tokens')
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
  // The mark is spent by the report: the next pause is below the threshold and says nothing.
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
})

modTest('asap hands over at the next pause below the threshold, and says so', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  expect(await asap($, world, 150_000)).toBe('hands over at the next pause, context 150000 tokens')
  await pauseAt($, world, 150_000)
  await world.clock.settle()
  expect(seen.toasts[0]).toBe('handing over now, context 150000 tokens')
  expect(host.steps[0]).toBe(`run handoff ${ASK_FOR_PATH}`)
})

modTest('asap lifts the minimum gap: a pause soon after the last attempt hands over', { options: { dry_run: true } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await pauseAt($, world, 210_000)
  expect(seen.toasts).toEqual([wouldHandOver(210_000)])
  // Under the threshold and inside the gap of the attempt before: the person asked for it.
  await asap($, world, 150_000)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(210_000), wouldHandOver(150_000)])
})

modTest('asap does not lift the wait for running work, and names what it waits for', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 150_000)
  world.agents = [{ status: 'running' }]
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual(['handoff postponed, a subagent is running, context 150000 tokens'])
  // The mark holds on: the pause after the work has ended hands over.
  world.agents = []
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual(['handoff postponed, a subagent is running, context 150000 tokens', wouldHandOver(150_000)])
})

modTest('past the emergency brake asap hands over although work runs, as any handover does', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 340_000)
  world.agents = [{ status: 'running' }]
  await pauseAt($, world, 350_000)
  expect(seen.toasts).toEqual([`${wouldHandOver(350_000)}, although a subagent is running (emergency brake)`])
})

modTest('with the context size unknown asap is turned down and sets nothing', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await asap($, world, undefined)).toBe('context size unknown, try again after the next answer')
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([])
})

modTest('with settings it cannot trust the mod is off, and asap says why', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await asap($, world, 150_000)).toBe('off: handoff_command: "/handoff" starts with a slash, give the name without it')
})

modTest('while a handover runs asap is turned down', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await raiseHandoff($)
  expect(await answered(runRelay($, 'asap'))).toBe('a handover is in progress, try again when it is done')
  await world.clock.settle()
})

modTest(
  'a handover that starts while asap reads the context turns asap down, and the mark does not outlive it',
  { options: { ...LIVE.options, min_gap_minutes: 0, min_gap_turns: 0 } },
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    hostWith(on, { commands: [] })
    await startSession($)
    // The pause that ends this answer comes while the command waits for its read of the context.
    world.during.usage = async () => {
      await startTurn($)
      await pause($)
    }
    world.tokens = 210_000
    expect(await answered(runRelay($, 'asap'))).toBe('a handover is in progress, try again when it is done')
    await world.clock.settle()
    // Nothing is left standing: a pause under the threshold does not hand over.
    const before = seen.toasts.length
    await pauseAt($, world, 150_000)
    expect(seen.toasts).toHaveLength(before)
  },
)

modTest('asap takes no argument: what follows the word is turned down with the help', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  expect(await asap($, world, 150_000, 'asap now')).toMatch(/^unknown argument "asap now", use /)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([])
})

const TEN = { options: { ...LIVE.options, countdown_seconds: 10 } }

modTest('asap ends a running countdown, and the pause after it hands over with no countdown', TEN, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await raiseHandoff($)
  // The countdown runs at rest, after the pause: asap ends it and hands over in its own step, so the countdown's 10 seconds hand over nothing more.
  expect(await answered(runRelay($, 'asap'))).toBe('handing over now, context 210000 tokens')
  await world.clock.advance(300)
  await world.clock.settle()
  expect(host.steps).toEqual([`run handoff ${ASK_FOR_PATH}`])
  await world.clock.advance(20_000)
  expect(host.steps).toEqual([`run handoff ${ASK_FOR_PATH}`])
  expect(seen.toasts).toEqual([])
})

modTest('the diagnostic output names what asap did at debug, with the sizes and nothing else', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  await asap($, world, undefined)
  await asap($, world, 150_000)
  await pauseAt($, world, 150_000)
  expect(seen.logs.filter(l => l.includes('asap'))).toEqual([
    'debug: asap: turned down, the context size is unknown',
    'debug: asap: set at context 150000',
    expect.stringMatching(/^info: pause: context 150000 of 1000000 tokens \(threshold 200000, asap, brake 350000\), .*decided dry-run$/),
    'debug: asap: spent by this handover',
  ])
})

// A compact by hand, with a history for the host to compact: the mod passes the event on and reads what comes back.
const compactBy = ($: TestEngine, trigger = 'manual') => $.session.compact({ trigger, messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)

// The mark stands for the person's wish at one point of the session: where the session has changed under it, it does not hand over again.

modTest('a context below where asap was asked ends it at the next pause; a pause with no size changes nothing', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  await asap($, world, 150_000)
  world.tokens = undefined
  await startTurn($)
  await pause($)
  expect(seen.toasts).toEqual([])
  await pauseAt($, world, 100_000)
  expect(seen.toasts).toEqual([])
  expect(seen.logs).toContain('debug: asap: over, the context shrank below where it was asked')
  await pauseAt($, world, 120_000)
  expect(seen.toasts).toEqual([])
})

modTest('a compact by hand ends asap, though the context it leaves is unknown at first', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { manualCompact: COMPACT_DONE })
  await startSession($)
  await asap($, world, 150_000)
  await compactBy($)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([])
})

modTest('a compact by hand that is vetoed leaves asap standing', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { manualCompact: COMPACT_VETO })
  await startSession($)
  await asap($, world, 150_000)
  await compactBy($)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
})

modTest('a precompute does not end asap', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await asap($, world, 150_000)
  await compactBy($, 'precompute')
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
})

modTest('the end of the session, a /clear by hand, ends asap', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 150_000)
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([])
})

modTest('later after asap takes the mark back, and says so, whether or not later itself is turned down', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 190_000)
  expect(await asap($, world, 190_000, 'later 50k')).toBe(
    'asap withdrawn, dry run, would hand over at 240000 tokens instead of 200000, for this handover only, context 190000 tokens',
  )
  await pauseAt($, world, 190_000)
  expect(seen.toasts).toEqual([])
  // Turned down: not past the value in force. The mark is gone all the same.
  await asap($, world, 150_000)
  expect(await asap($, world, 150_000, 'later 1k')).toBe('asap withdrawn, already hands over at 200000 tokens, context 150000 tokens')
  await pauseAt($, world, 190_000)
  expect(seen.toasts).toEqual([])
})

modTest('asap after later drops the later handover, and says so', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 190_000, 'later 50k')
  expect(await asap($, world, 190_000)).toBe('later dropped, dry run, would hand over at the next pause, context 190000 tokens')
  await pauseAt($, world, 190_000)
  expect(seen.toasts).toEqual([wouldHandOver(190_000)])
})

// At rest no answer runs, so no pause comes: the command judges itself, from what the last stop said and what runs now, and starts the
// handover in a step of its own after its answer (the host refuses to start one inside the command).

const atRest = async ($: TestEngine, world: SessionWorld, tokens: number | undefined, args = 'asap') => {
  world.tokens = tokens
  return answered(runRelay($, args))
}
const RUN = `run handoff ${ASK_FOR_PATH}`

modTest(
  'at rest asap hands over in a step of its own after the answer, below the threshold and with no countdown',
  { options: { ...LIVE.options, countdown_seconds: 10 } },
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on)
    await startSession($)
    await pauseAt($, world, 150_000)
    expect(await atRest($, world, 150_000)).toBe('handing over now, context 150000 tokens')
    // Not inside the command: the host would refuse it there.
    expect(host.steps).toEqual([])
    await world.clock.advance(300)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
    // The answer said it: the step does not say it a second time.
    expect(seen.toasts).toEqual([])
  },
)

modTest('at rest in a dry run asap says it would hand over, spends the mark, and starts nothing', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  expect(await atRest($, world, 150_000)).toBe(wouldHandOver(150_000))
  await world.clock.advance(1_000)
  await pauseAt($, world, 150_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
})

modTest('at rest asap waits for a subagent, says what for, and the pause after the work hands over', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  world.agents = [{ status: 'running' }]
  expect(await atRest($, world, 150_000)).toBe('handoff postponed, a subagent is running, context 150000 tokens')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  world.agents = []
  await pauseAt($, world, 150_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  expect(seen.toasts.at(-1)).toBe('handing over now, context 150000 tokens')
})

modTest('at rest asap waits for a background task or a timer the last stop reported', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  world.tokens = 150_000
  await startTurn($)
  await pause($, { background_tasks: [{ status: 'running' }] })
  expect(await atRest($, world, 150_000)).toBe('handoff postponed, a background task is running, context 150000 tokens')
  await startTurn($, 't2')
  await pause($, { session_crons: [{ recurring: false }] })
  expect(await atRest($, world, 150_000)).toBe('handoff postponed, a timer that fires once is set, context 150000 tokens')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
})

modTest('at rest past the emergency brake asap hands over although work runs', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  world.agents = [{ status: 'running' }]
  expect(await atRest($, world, 360_000)).toBe('handing over now, context 360000 tokens, although a subagent is running (emergency brake)')
  await world.clock.advance(300)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('with no stop seen yet asap does not hand over blind: the mark stays for the next pause, and the answer says so', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  expect(await atRest($, world, 150_000)).toBe('hands over at the next pause, context 150000 tokens, what is running is not known until the next answer')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  await pauseAt($, world, 150_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest("a turn that starts between the command and its step stops the handover; the mark stays for that turn's pause", LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  expect(await atRest($, world, 150_000)).toBe('handing over now, context 150000 tokens')
  await startTurn($, 'sooner')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  await pause($)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('a subagent that starts between the command and its step stops the handover', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  world.agents = [{ status: 'running' }]
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual(['handoff postponed, a subagent is running, context 150000 tokens'])
})

modTest('a second asap before the step starts nothing twice', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  expect(await atRest($, world, 150_000)).toBe('a handover is in progress, try again when it is done')
  await world.clock.advance(300)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('later between the command and its step takes the mark back and starts nothing', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  expect(await atRest($, world, 150_000, 'later 20k')).toMatch(/^asap withdrawn, /)
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
})

modTest('at rest asap is turned down while the context size is unknown', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  expect(await atRest($, world, undefined)).toBe('context size unknown, try again after the next answer')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
})

modTest('after a turn that ended with no stop (Esc) what runs is not known, though an earlier stop said', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await startTurn($, 'cut')
  await endTurn($, 'aborted', { turnId: 'cut' })
  expect(await atRest($, world, 150_000)).toBe('hands over at the next pause, context 150000 tokens, what is running is not known until the next answer')
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
})

modTest('later between the command and its step frees asap to be asked again, and one handover starts', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  await atRest($, world, 150_000, 'later 20k')
  expect(await atRest($, world, 150_000)).toBe('handing over now, context 150000 tokens')
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

// A reload (a changed setting, a hot reload) starts the mod from `freshState()`: no mark and no planned step survive it. The engine offers no
// reload to a test, so the state it starts from is read.
test('the state a reload starts from holds no asap mark and no planned step', () => {
  const state = freshState()
  expect(state.asap).toBeUndefined()
  expect(state.asapScheduled).toBe(false)
})

modTest('a context that cannot be read turns asap down with the reason, warns, and sets no mark', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { logLevel: 'debug' })
  await startSession($)
  world.usageError = 'no usage'
  expect(await asap($, world, 150_000)).toBe('could not read the context size (no implementation for session.usage)')
  expect(seen.logs.filter(l => l.includes('asap'))).toEqual(['warn: asap: could not read the context size'])
  world.usageError = undefined
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([])
})

modTest(
  'asap that failed to hand over has spent the mark: the next pause below the threshold hands over nothing',
  methods('external-command', 'none', { min_gap_minutes: 0, min_gap_turns: 0 }),
  async ($, on) => {
    const world = sessionWith(on)
    const host = hostWith(on, { failRun: ['handoff'] })
    withMod(on)
    await startSession($)
    await asap($, world, 150_000)
    await pauseAt($, world, 150_000)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
    await pauseAt($, world, 150_000)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
  },
)

modTest(
  'a handover that asap began at rest counts as an attempt, though it failed: the minimum gap holds the next pause back',
  methods('external-command', 'none'),
  async ($, on) => {
    const world = sessionWith(on)
    const host = hostWith(on, { failRun: ['handoff'] })
    withMod(on)
    await startSession($)
    await pauseAt($, world, 150_000)
    await atRest($, world, 150_000)
    await world.clock.advance(300)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
    await pauseAt($, world, 210_000)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
  },
)

modTest('a step that finds work running leaves nothing planned: asap can be asked again, and one handover starts', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  world.agents = [{ status: 'running' }]
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  world.agents = []
  expect(await atRest($, world, 150_000)).toBe('handing over now, context 150000 tokens')
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('the end of the session leaves nothing planned: asap can be asked again in the next session', LIVE, async ($, on) => {
  const world = sessionWith(on)
  const host = hostWith(on)
  withMod(on)
  await startSession($)
  await pauseAt($, world, 150_000)
  await atRest($, world, 150_000)
  await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } })
  await startSession($)
  await pauseAt($, world, 150_000)
  expect(await atRest($, world, 150_000)).toBe('handing over now, context 150000 tokens')
  await world.clock.advance(1_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

modTest('later with an argument that is no number is turned down before it changes anything: the asap mark stands', DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await asap($, world, 150_000)
  expect(await asap($, world, 150_000, 'later abc')).not.toMatch(/^asap withdrawn/)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
})

modTest("a subagent's compact of its own transcript does not end asap", DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { manualCompact: COMPACT_DONE })
  await startSession($)
  await asap($, world, 150_000)
  await $.session.compact({ trigger: 'manual', agentId: 'sub-1', messages: [{ role: 'user', text: 'old', toolUses: [] }] } as never)
  await pauseAt($, world, 150_000)
  expect(seen.toasts).toEqual([wouldHandOver(150_000)])
})

modTest('at rest a read of what runs that fails leaves the mark for the next pause, says so, and warns', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'debug' })
  await startSession($)
  await pauseAt($, world, 150_000)
  world.during['agent.list'] = async () => {
    throw new Error('no agents')
  }
  expect(await atRest($, world, 150_000)).toBe('hands over at the next pause, context 150000 tokens, what is running is not known until the next answer')
  expect(seen.logs.filter(l => l.includes('asap: could not'))).toEqual(['warn: asap: could not read what runs'])
  await world.clock.advance(1_000)
  expect(host.steps).toEqual([])
  await pauseAt($, world, 150_000)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
})

// A countdown that is still being set up when asap is typed is not there to end: it stands afterwards, and when it runs out the handover it
// would start is already under way.
modTest(
  'asap typed while a countdown is being set up does not start a second handover when that countdown runs out',
  { options: { ...TEN.options, min_gap_minutes: 0, min_gap_turns: 0 } },
  async ($, on) => {
    const world = sessionWith(on)
    const host = hostWith(on)
    withMod(on)
    await startSession($)
    await pauseAt($, world, 150_000)
    world.during.surfaces = async () => {
      await atRest($, world, 210_000)
    }
    await pauseAt($, world, 210_000)
    await world.clock.advance(1_000)
    expect(host.steps).toEqual([RUN])
    await world.clock.advance(15_000)
    await world.clock.settle()
    expect(host.steps).toEqual([RUN])
  },
)
