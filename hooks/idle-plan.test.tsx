import { expect } from 'claude-code/testing'

import { compactMark, FIVE_TRANSCRIPT, HOUR_TRANSCRIPT, LIVE_IDLE, T, answer, band, idleLines, idleSession, modelSwitch, shown, typeKey } from './idle-support'
import {
  answered,
  COMPACT_DONE,
  COMPACT_VETO,
  endTurn,
  hostWith,
  MINUTE,
  modelForkAnswer,
  modTest,
  runRelay,
  sessionWith,
  startTurn,
  stop,
  typeInto,
  type TestEngine,
} from './test-support'

// The handoff after a long pause, up to the handoff written: planned at the end of each answer, written 55 minutes after the last request
// while the cache is still warm, and nothing more. The session stays as it is; what happens when the person comes back is idle-return.

// The first message: the line that tells the fresh session what it is, and the handoff.
const PREPARED = 'info: idle: handoff prepared, 100 characters'

modTest('55 minutes after the last request the mod writes a handoff, quietly, and leaves the session as it is', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(55 * MINUTE - 1)
  expect(host.modelForkPrompts).toHaveLength(0)
  await world.clock.advance(1)
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(host.steps).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(idleLines(seen.logs)).toEqual(['debug: idle: planned in 55 min', PREPARED])
})

modTest('a pause whose reads fail still plans the step, from a read of its own', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  world.during['agent.list'] = async () => {
    throw new Error('agents unreadable')
  }
  await answer($)
  expect(idleLines(seen.logs)).toContain('debug: idle: planned in 55 min')
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
})

// The first turn of a fresh session can end before its answer is in the transcript (docs/host-behaviour.md, "the transcript can still lack
// the turn's answer"). The pause after it reads once more a few seconds later and plans from that read, from the same last request.
modTest('a first answer not yet in the transcript is read again a few seconds later, and the pause is planned then', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: '' } })
  await answer($)
  expect(idleLines(seen.logs)).toEqual(['debug: idle: not planned, cache lifetime unknown'])
  host.files[T] = HOUR_TRANSCRIPT
  await world.clock.advance(5_000)
  expect(idleLines(seen.logs)).toEqual(['debug: idle: not planned, cache lifetime unknown', 'debug: idle: planned in 55 min'])
  await world.clock.advance(55 * MINUTE - 5_001)
  expect(host.modelForkPrompts).toHaveLength(0)
  await world.clock.advance(1)
  expect(host.modelForkPrompts).toHaveLength(1)
})

modTest('a turn before the read a few seconds later ends the pause, and the read plans nothing, though it ended with no answer', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: '' } })
  await answer($)
  host.files[T] = HOUR_TRANSCRIPT
  await startTurn($, 't2')
  await endTurn($, 'aborted', { turnId: 't2' })
  await world.clock.advance(60 * MINUTE)
  expect(idleLines(seen.logs)).toEqual(['debug: idle: not planned, cache lifetime unknown'])
})

modTest('a turn that starts while the read a few seconds later runs, and ends with no answer, leaves nothing planned', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: '' } })
  await answer($)
  host.files[T] = HOUR_TRANSCRIPT
  host.during['fs.read'] = async () => {
    await startTurn($, 't2')
  }
  await world.clock.advance(5_000)
  await endTurn($, 'aborted', { turnId: 't2' })
  await world.clock.advance(60 * MINUTE)
  expect(idleLines(seen.logs)).toEqual(['debug: idle: not planned, cache lifetime unknown'])
  expect(host.modelForkPrompts).toHaveLength(0)
})

modTest('a transcript that still holds no answer a few seconds later is not read again in the pause', LIVE_IDLE, async ($, on) => {
  const { seen, world } = idleSession(on, { files: { [T]: '' } })
  await answer($)
  await world.clock.advance(60 * MINUTE)
  expect(seen.logs.filter(l => l.startsWith('debug: idle: cache lifetime'))).toHaveLength(2)
})

modTest('a new turn before then ends the pause, and its own end plans again from its last request', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(30 * MINUTE)
  await answer($, 't2', {}, false)
  await world.clock.advance(54 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  await world.clock.advance(MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
})

// What ends a pause besides a new turn, with the line `endPause` gives for it.
const sessionEnd = ($: TestEngine) => $.session.end({ sessionId: 'old', reason: 'clear' } as never)
const MESSAGES = [{ role: 'user', text: 'old', toolUses: [] }]
const compact = ($: TestEngine) => $.session.compact({ trigger: 'manual', messages: MESSAGES } as never)
// The host's own compact, at minute 54 of a long pause.
const autoCompact = ($: TestEngine) => $.session.compact({ trigger: 'auto', messages: MESSAGES } as never)
const ENDS = [
  ['the end of the session', sessionEnd, 'the session ended'],
  ['a compact of the main loop', compact, 'a compact'],
  ['a change of model', modelSwitch, 'a change of model'],
] as const

for (const [name, end] of ENDS) {
  modTest(`${name} ends the pause: nothing is written`, LIVE_IDLE, async ($, on) => {
    const { world, host } = idleSession(on)
    await answer($)
    await world.clock.advance(10 * MINUTE)
    await end($)
    await world.clock.advance(60 * MINUTE)
    expect(host.modelForkPrompts).toHaveLength(0)
  })
}

for (const [name, end] of ENDS) {
  modTest(`${name} after the handoff is written drops it, and its band never comes`, LIVE_IDLE, async ($, on) => {
    const { seen, world, host } = idleSession(on)
    const ui = await band($)
    await answer($)
    await world.clock.advance(55 * MINUTE)
    expect(idleLines(seen.logs)).toContain(PREPARED)
    await end($)
    const before = host.steps.length
    await world.clock.advance(70 * MINUTE)
    expect(await shown(ui)).toBeUndefined()
    await typeInto($, 'hello again')
    await world.clock.settle()
    expect(host.steps.slice(before)).toEqual(['submit hello again'])
  })
}

// Another hook can hold a compact back with `{ skip }`: another mod, or a PreCompact hook in the settings. The session stays as it was, and
// so does the pause. The host does not try its own compact again in that pause, so a pause it ended would leave the session with nothing.
const HELD_BACK = [
  ['a compact by hand', { manualCompact: COMPACT_VETO }, compact],
  ["the host's compact while idle", { compact: COMPACT_VETO }, autoCompact],
] as const

for (const [name, answers, held] of HELD_BACK) {
  modTest(`${name} that another hook holds back leaves the pause: the handoff is written`, LIVE_IDLE, async ($, on) => {
    const { seen, world, host } = idleSession(on, answers)
    await answer($)
    await world.clock.advance(54 * MINUTE)
    await held($)
    await world.clock.advance(MINUTE)
    expect(host.modelForkPrompts).toHaveLength(1)
    expect(idleLines(seen.logs)).toContain(PREPARED)
    expect(idleLines(seen.logs).filter(l => l.includes('pause over'))).toEqual([])
  })

  modTest(`${name} that another hook holds back keeps the handoff written`, LIVE_IDLE, async ($, on) => {
    const { seen, world } = idleSession(on, answers)
    await answer($)
    await world.clock.advance(55 * MINUTE)
    expect(idleLines(seen.logs)).toContain(PREPARED)
    await held($)
    expect(idleLines(seen.logs).filter(l => l.includes('pause over'))).toEqual([])
  })
}

modTest("the host's compact while idle that goes through ends the pause: nothing is written", LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { compact: COMPACT_DONE })
  await answer($)
  await world.clock.advance(54 * MINUTE)
  await autoCompact($)
  await world.clock.advance(60 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, a compact')
})

// A hook above the mod can answer a compact with messages of its own and not pass it on: the mod's own hook never sees it. The host marks
// every compact in the transcript all the same (docs/host-behaviour.md, "a compact another hook answers"), read when the step is due.
const boundaryAt = (at: number) => compactMark(new Date(at).toISOString())

modTest('a compact the mod never saw, marked in the transcript during the pause, ends it: nothing is written', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await world.clock.advance(10 * MINUTE)
  await answer($)
  await world.clock.advance(30 * MINUTE)
  host.files[T] = [HOUR_TRANSCRIPT, boundaryAt(40 * MINUTE)].join('\n')
  await world.clock.advance(60 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, a compact in the transcript')
})

modTest('a compact marked in the transcript before the pause began leaves it: the handoff is written', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: [HOUR_TRANSCRIPT, boundaryAt(5 * MINUTE)].join('\n') } })
  await world.clock.advance(10 * MINUTE)
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(idleLines(seen.logs)).toContain(PREPARED)
})

// A compact that keeps messages word for word writes them again after its mark (36 KB after four short ones, measured on 2.1.302), so in a
// transcript read only at its end the mark can lie before the end: it is read from where the pause began.
modTest('in a transcript too large to read whole, a compact that wrote more than its end after its mark still ends the pause', LIVE_IDLE, async ($, on) => {
  const before = 5_000_000
  const since = `+${before + 1}`
  const { seen, world, host } = idleSession(on, {
    sizes: { [T]: before },
    tails: { [T]: count => (count === since ? [boundaryAt(40 * MINUTE), HOUR_TRANSCRIPT].join('\n') : HOUR_TRANSCRIPT) },
  })
  await world.clock.advance(10 * MINUTE)
  await answer($)
  await world.clock.advance(30 * MINUTE)
  host.sizes[T] = before + 1_000_000
  await world.clock.advance(60 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, a compact in the transcript')
  expect(host.runs.at(-1)).toEqual(['tail', '-c', since, T])
})

modTest('in a transcript too large to read whole that grew less than its end in the pause, only the end is read', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on, { sizes: { [T]: 5_000_000 }, tails: { [T]: HOUR_TRANSCRIPT } })
  await answer($)
  host.sizes[T] = 5_100_000
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(host.runs.at(-1)).toEqual(['tail', '-c', '262144', T])
})

modTest('a transcript whose size cannot be told when the pause is planned still plans it', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(MINUTE)
  host.files = {}
  await answer($, 't2', {}, false)
  expect(idleLines(seen.logs).filter(l => l === 'debug: idle: planned in 55 min')).toHaveLength(2)
})

// The step can come due while a compact runs (the host's took 38 s at 210000 tokens, measured): it waits for the outcome, so that nothing is
// written of a context the compact replaces, and comes at once where the compact did not go through: another hook held it back, or it
// failed (a hook beneath that throws), which leaves the session as it was too.
for (const [outcome, reply, written] of [
  ['goes through', COMPACT_DONE, 0],
  ['is held back', COMPACT_VETO, 1],
  ['fails', { throws: 'probe failure' }, 1],
] as const) {
  modTest(`the step due while a compact runs waits for it: the compact ${outcome}`, LIVE_IDLE, async ($, on) => {
    const { world, host } = idleSession(on, { compact: reply })
    await answer($)
    await world.clock.advance(54 * MINUTE + 30_000)
    let during = -1
    host.during['compact'] = async () => {
      await world.clock.advance(MINUTE)
      during = host.modelForkPrompts.length
    }
    await autoCompact($).catch(() => {})
    await world.clock.settle()
    expect(during).toBe(0)
    expect(host.modelForkPrompts).toHaveLength(written)
  })
}

// A compact or a change of model the person starts while the handoff is being written (slash commands go through) ends the pause too:
// the handoff written for the context before it goes.
for (const [name, end, why] of ENDS.slice(1)) {
  modTest(`${name} while the handoff is written ends the pause: the handoff goes`, LIVE_IDLE, async ($, on) => {
    const { seen, world, host } = idleSession(on)
    await answer($)
    host.during['model.fork'] = async () => void (await end($))
    await world.clock.advance(55 * MINUTE)
    expect(host.modelForkPrompts).toHaveLength(1)
    expect(idleLines(seen.logs)).toContain(`debug: idle: pause over, ${why}, the handoff written is dropped`)
    expect(idleLines(seen.logs)).not.toContain(PREPARED)
    const before = host.steps.length
    await world.clock.advance(70 * MINUTE)
    await typeInto($, 'hello again')
    await world.clock.settle()
    expect(host.steps.slice(before)).toEqual(['submit hello again'])
  })
}

// A turn that is not the mod's own starts while the handoff is written: a slash command that starts one (it goes through), or the message
// held meanwhile, whose turn starts as it is put in (the submit settles once its turn started). It ends the pause, and the handoff goes.
modTest('a turn that starts while the handoff is written ends the pause: what is written goes', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  host.during['model.fork'] = async () => void (await startTurn($, 't2'))
  await world.clock.advance(55 * MINUTE)
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, a turn started, the handoff written is dropped')
  expect(idleLines(seen.logs)).not.toContain(PREPARED)
})

modTest('the turn of a message held while the handoff is written ends the pause: the handoff written goes', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  host.during['model.fork'] = async () => void (await typeInto($, 'meanwhile'))
  host.during['submit'] = async () => void (await startTurn($, 't2'))
  await world.clock.advance(55 * MINUTE)
  expect(host.steps).toEqual(['submit meanwhile'])
  expect(idleLines(seen.logs)).toContain('debug: idle: pause over, a turn started, the handoff written is dropped')
  await world.clock.advance(70 * MINUTE)
  await typeInto($, 'hello again')
  await world.clock.settle()
  expect(host.steps).toEqual(['submit meanwhile', 'submit hello again'])
})

modTest('typing and slash commands do not end the pause', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  await typeKey($, 'a')
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
})

const notPlanned: [string, object, Parameters<typeof hostWith>[1], Parameters<typeof sessionWith>[1], object, string][] = [
  ['with the setting off', { idle_handoff: false }, {}, {}, {}, 'switched off'],
  ['with a five-minute cache', {}, { files: { [T]: FIVE_TRANSCRIPT } }, {}, {}, 'cache lifetime 5m'],
  ['below the baseline plus 30000', {}, {}, { tokens: 81_002 }, {}, 'context 81002 tokens below 81003'],
  ['below a lower bound set', { idle_handoff_min_tokens: 150_000 }, {}, {}, {}, 'context 120000 tokens below 150000'],
  ['with a timer of the session set', {}, {}, {}, { session_crons: [{ recurring: true }] }, 'a timer of the session is set'],
  ['with a one-shot timer of the session set', {}, {}, {}, { session_crons: [{ recurring: false }] }, 'a timer of the session is set'],
]
for (const [name, options, host, world, stopInput, why] of notPlanned) {
  modTest(`nothing is planned ${name}`, { options: { dry_run: false, ...options } }, async ($, on) => {
    const { seen, world: w, host: h } = idleSession(on, host, world)
    await answer($, 't1', stopInput)
    await w.clock.advance(60 * MINUTE)
    expect(h.modelForkPrompts).toHaveLength(0)
    expect(idleLines(seen.logs)).toEqual([`debug: idle: not planned, ${why}`])
  })
}

modTest('a background task running when it is due does not hold the handoff back: it reports into this session', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($, 't1', { background_tasks: [{ status: 'running' }] })
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
})

// The handoff missed the cache here, so the touch stays with the main loop: what a subagent asked in the meantime does not move it.
modTest("a subagent's request is no touch: the cache counts as expired an hour after the main loop's", LIVE_IDLE, async ($, on) => {
  const missed = {
    ...modelForkAnswer('goal: finish the parser'),
    usage: { input_tokens: 3, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 120_000 },
  }
  const { world, host } = idleSession(on, { modelFork: missed })
  await answer($)
  await world.clock.advance(30 * MINUTE)
  for await (const _ of $.turn.step({ turnId: 's1', index: 0, model: 'claude', messageCount: 1, agentId: 'a1' } as never));
  await world.clock.advance(40 * MINUTE)
  await typeInto($, 'hello again')
  await world.clock.settle()
  expect(host.steps[0]).toBe('run clear')
})

// A countdown running when it is due holds the handoff back too (the check is in the step), but no test reaches it: a countdown lasts at most
// 60 seconds and begins only at a pause, which is 55 minutes before the step, and a new turn ends the pause.
modTest('a handover running when it is due holds the handoff back', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { modelFork: 'hang' })
  await answer($)
  await world.clock.advance(54 * MINUTE)
  await answered(runRelay($, 'asap'))
  // The handover of asap at rest begins a moment after its answer, and its fork never answers.
  await world.clock.advance(1_000)
  expect(host.modelForkPrompts).toHaveLength(1)
  await world.clock.advance(MINUTE)
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(idleLines(seen.logs)).toContain('debug: idle: not prepared, a handover runs')
})

modTest('a subagent running when it is due holds the handoff back', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  world.agents = [{ status: 'running' }]
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: not prepared, a subagent runs')
})

modTest('the transcript is read again when it is due: a cache that turned to five minutes holds it back', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  host.files[T] = FIVE_TRANSCRIPT
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: not prepared, cache lifetime 5m')
})

modTest('a transcript that cannot be read when it is due is warned of once in the session', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { sizes: { [T]: 5_000_000 }, tails: { [T]: HOUR_TRANSCRIPT } })
  await answer($)
  host.tails = {}
  await world.clock.advance(55 * MINUTE)
  await answer($, 't2', {}, false)
  host.files = {}
  await world.clock.advance(55 * MINUTE)
  expect(seen.logs.filter(l => l === 'warn: idle: the transcript could not be read')).toHaveLength(1)
})

modTest('a handoff the model cannot write is said once, and the session goes on as is', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on, { modelFork: { isAnswered: false, reason: 'nothing-to-fork' } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(seen.toasts).toEqual([
    'could not prepare the idle handoff (the mod could not write the handoff: there is no conversation yet to write a handoff from), the session goes on as is',
  ])
  expect(host.steps).toEqual([])
  expect(idleLines(seen.logs)).toContain('warn: idle: preparing failed (stage model-fork)')
})

modTest('in a dry run the mod only says it would prepare', { options: { dry_run: true } }, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('info: idle: would prepare')
})

modTest('what is typed while the handoff is written is held, and goes into the session once it is written', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  let held: unknown
  host.during['model.fork'] = async () => {
    held = await typeInto($, 'are you there?')
  }
  await world.clock.advance(55 * MINUTE)
  expect(held).toEqual({ drop: 'sweet-spot: your message is held for a moment and goes in right after' })
  expect(host.steps).toEqual(['submit are you there?'])
})

modTest('the end of an answer while the handoff is written is no pause and plans nothing', LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  host.during['model.fork'] = async () => {
    await stop($, { transcript_path: T } as never)
    await endTurn($, 'answer', { turnId: 'x' })
  }
  await world.clock.advance(55 * MINUTE)
  expect(seen.logs).toContain('debug: stop while handing over, not a pause')
  expect(idleLines(seen.logs).filter(l => l.includes('planned in'))).toHaveLength(1)
})

modTest('a handoff written from a cache it missed leaves the touch where it was', LIVE_IDLE, async ($, on) => {
  const missed = {
    isAnswered: true,
    text: 'goal: finish the parser',
    usage: { input_tokens: 3, output_tokens: 900, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 119_000 },
  }
  const { seen, world } = idleSession(on, { modelFork: missed })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(idleLines(seen.logs)).toContain('debug: idle: the handoff missed the cache, the touch stays')
})

modTest('a turn that starts and ends without an answer (Esc) ends the pause and plans nothing new', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(10 * MINUTE)
  await startTurn($, 't2')
  await endTurn($, 'aborted', { turnId: 't2' })
  await world.clock.advance(60 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
})

modTest("a turn of the person's that starts while the step reads is seen: nothing is written", LIVE_IDLE, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  world.during['agent.list'] = async () => void (await startTurn($, 't2'))
  await world.clock.advance(55 * MINUTE)
  expect(host.modelForkPrompts).toHaveLength(0)
  expect(idleLines(seen.logs)).toContain('debug: idle: not prepared, a turn runs')
})
