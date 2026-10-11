import { expect } from 'claude-code/testing'

import { firstMessage, promptPath } from './handoff'
import {
  COMPACT_DONE,
  COMPACT_VETO,
  commandTurnEnds,
  DUE,
  endTurn,
  FILE,
  modelForkAnswer,
  pauseAt,
  hostWith,
  LIVE,
  MINUTE,
  NOTES,
  reachThreshold,
  runRelay,
  sessionWith,
  startSession,
  startTurn,
  stop,
  typeInto,
  withMod,
  type TestEngine,
  COMPACT_ONLY,
  modTest,
} from './test-support'

// The log level is read from the environment at the start of every handler that logs, so a value changed in a settings file is in force
// from the next handler on, without a reload. A value that is no level is reported once, as a `warn` line, until it changes.

const BAD = (value: string) => `warn: log level "${value}" is not one of off, warn, info, debug, trace, logging at warn`
const warned = (logs: string[]) => logs.filter(l => l.startsWith('warn: log level'))

// Every handler the mod registers reads the level at its start: each one alone, with a bad value, reports it.
const handlers: [string, ($: TestEngine) => Promise<unknown>][] = [
  ['session.start', $ => startSession($)],
  ['turn.start', $ => startTurn($)],
  ['prompt.submit', $ => typeInto($, 'hello')],
  ['command.run', $ => runRelay($, 'redeliver')],
  ['turn.complete', $ => endTurn($)],
  ['classic.Stop', $ => stop($)],
]

for (const [name, raise] of handlers) {
  modTest(`${name} reads the log level at its start`, LIVE, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on)
    hostWith(on, { logLevel: 'nope' })
    await raise($)
    expect(warned(seen.logs)).toEqual([BAD('nope')])
  })
}

modTest('without the variable, and with a valid value, the read says nothing', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  host.logLevel = ' DEBUG '
  await startTurn($)
  await endTurn($)
  expect(warned(seen.logs)).toEqual([])
})

modTest('two handlers that read a bad value at once write one line', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, { logLevel: 'nope' })
  await Promise.all([startTurn($), typeInto($, 'hello')])
  expect(warned(seen.logs)).toEqual([BAD('nope')])
})

modTest('a new value is in force from the next handler on', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on, { logLevel: 'info' })
  await startSession($)
  expect(warned(seen.logs)).toEqual([])
  host.logLevel = 'nope'
  await startTurn($)
  expect(warned(seen.logs)).toEqual([BAD('nope')])
})

modTest('a bad value is reported once over several turns, another bad value again, and the first again after a valid one', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on, { logLevel: 'debg' })
  await startSession($)
  await startTurn($, 't1')
  await startTurn($, 't2')
  expect(warned(seen.logs)).toEqual([BAD('debg')])
  host.logLevel = 'verbose'
  await startTurn($, 't3')
  host.logLevel = 'debug'
  await startTurn($, 't4')
  host.logLevel = 'debg'
  await startTurn($, 't5')
  expect(warned(seen.logs)).toEqual([BAD('debg'), BAD('verbose'), BAD('debg')])
})

modTest('a read that fails keeps what was read before, writes nothing, and the mod goes on with its work', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { logLevel: 'nope' })
  await startSession($)
  host.logLevelFails = true
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  await world.clock.settle()
  expect(seen.logs).toContain(DUE)
  host.logLevelFails = false
  await startTurn($, 't9')
  expect(warned(seen.logs)).toEqual([BAD('nope')])
})

// The lines themselves: one per event the mod acts on, each at its level, in the transcript, where the host stamps the time. The settings
// line that marks the level is left out where a test follows the order of the others.

const AT = (level: string) => ({ logLevel: level })
const MODEL_FORK_ANSWER = modelForkAnswer('goal: finish')
const PAUSE =
  'info: pause: context 210000 of 1000000 tokens (threshold 200000, brake 350000), 0 background tasks, 0 timers, 0 subagents, turn 10, no attempt before, decided act'
const SETTINGS =
  'settings: threshold 200000, dry_run off, min gap 10 minutes and 5 turns, later_tokens 25000, countdown_seconds 0, method external-command, fallback internal-handoff, handoff command "handoff"'
const lines = (logs: string[]) => logs.filter(l => !l.startsWith('info: settings:'))
const diagnostic = (logs: string[]) => logs.filter(l => /^(warn|info|debug|trace): /.test(l))

modTest('a pause is logged from the turn to the decision', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('trace'), files: { [FILE]: NOTES } })
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  await world.clock.settle()
  expect(lines(seen.logs).slice(0, 8)).toEqual([
    'trace: turn.start t1',
    'trace: turn.complete t1 answer',
    'debug: judge: waiting for the stop',
    'trace: stop',
    'debug: stop, not handing over',
    'debug: judge: the stop and the end of the turn are both in, the turn ended in answer',
    PAUSE,
    'handing over now, context 210000 tokens',
  ])
})

modTest('at info a pause shows its line and none of the finer ones', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('info'))
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(lines(diagnostic(seen.logs)).slice(0, 1)).toEqual([PAUSE])
  expect(diagnostic(seen.logs).filter(l => /^(debug|trace): /.test(l))).toEqual([])
})

// After a reload the mod is loaded into a running session: the end of a turn can be the first it sees, and its read comes before the pause.
modTest('the end of a turn as the first event after a reload shows the pause line at info', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('info'))
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs).toContain(PAUSE)
})

modTest('without the variable the mod writes no diagnostic line, and no settings line', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(diagnostic(seen.logs)).toEqual([])
  expect(seen.debug).toEqual([])
})

modTest('the settings line goes to the transcript, not to the debug log, and ends with the log level', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('info'))
  await startSession($)
  expect(seen.logs).toEqual([`info: ${SETTINGS}, log level info`])
  expect(seen.debug).toEqual([])
})

modTest('the settings line marks each change to info or finer, and nothing else', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on)
  const marks = () => seen.logs.filter(l => l.startsWith('info: settings:'))
  await startSession($)
  expect(marks()).toEqual([])
  host.logLevel = 'info'
  await startTurn($, 't1')
  await startTurn($, 't2')
  expect(marks()).toEqual([`info: ${SETTINGS}, log level info`])
  host.logLevel = 'debug'
  await startTurn($, 't3')
  host.logLevel = 'warn'
  await startTurn($, 't4')
  host.logLevel = 'off'
  await startTurn($, 't5')
  expect(marks()).toEqual([`info: ${SETTINGS}, log level info`, `info: ${SETTINGS}, log level debug`])
})

modTest('with settings the mod rejects there is no settings line', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('debug'))
  await startSession($)
  expect(seen.logs).toEqual(['off: handoff_command: "/handoff" starts with a slash, give the name without it', 'warn: settings rejected, 1 error'])
})

// A bad value logs at `warn`, below the settings line: the two never come from one read. Each comes before what the mod says as it
// introduces itself, here that its command could not be registered.
for (const [level, first] of [
  ['nope', BAD('nope')],
  ['info', `info: ${SETTINGS}, log level info`],
]) {
  modTest(`the read at ${level} writes its line before the mod introduces itself`, LIVE, async ($, on) => {
    const seen = withMod(on)
    seen.refuse = 'taken'
    sessionWith(on)
    hostWith(on, AT(level))
    await startSession($)
    expect([seen.logs[0], seen.logs[2]]).toEqual([first, 'warn: could not register the command'])
  })
}

modTest('a change to info after a bad value is marked in the read that makes it', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on, AT('nope'))
  await startSession($)
  host.logLevel = 'Info'
  await startTurn($, 't1')
  expect(seen.logs.slice(0, 2)).toEqual([BAD('nope'), `info: ${SETTINGS}, log level info`])
})

modTest('a stop before the end of its turn is logged as waiting, and the end as the one that judges', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('trace'))
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  expect(lines(seen.logs)).toEqual(['trace: turn.start t1', 'trace: stop', 'debug: stop, not handing over', 'debug: judge: waiting for the end of the turn'])
})

modTest('an end that is no answer is logged as no pause', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('trace'))
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'aborted', { turnId: 't1' })
  await stop($)
  expect(seen.logs.at(-1)).toBe('debug: judge: the turn ended in aborted, no pause')
})

modTest('the end of an agent turn is logged raw, and judged no pause apart', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('trace'))
  await startSession($)
  await endTurn($, 'answer', { turnId: 't1', agentId: 'a1' })
  expect(lines(seen.logs)).toEqual(['trace: turn.complete t1 answer, agent a1', 'debug: agent a1, not a pause'])
})

modTest('the handoff is logged step by step', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('trace'), files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `All written.\nHANDOFF_PATH: ${FILE}`)
  const message = firstMessage(NOTES)
  expect(lines(seen.logs).slice(8)).toEqual([
    'info: handoff starts, method external-command',
    'debug: command "handoff" is listed',
    'debug: command started, waiting for its turn',
    'trace: turn.start t2',
    "debug: turn t2 is the command's turn",
    'trace: turn.complete t2 answer',
    'debug: judge: waiting for the stop',
    "trace: the command's turn ended",
    `debug: the answer names ${FILE}`,
    `debug: file read, ${NOTES.length} characters`,
    'info: clear, session old',
    `info: submit, session new, ${message.length} characters`,
    'info: submit done',
    'handed over, the fresh session carries on from the handoff',
  ])
})

modTest('with the internal handoff as the method the log says so, as the settings line does', { options: { dry_run: false } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('info'), modelFork: MODEL_FORK_ANSWER })
  await reachThreshold($, world)
  expect(seen.logs).toContain('info: handoff starts, method internal-handoff')
})

// What the fresh session starts at, and how it grows over its first pauses, is what the handoff's reload costs: read from the log and not
// worked out from the transcript afterwards.
modTest('after a handoff the first three pauses of the fresh session are logged against the context before it', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  const pauseAt = async (tokens: number, turn: string) => {
    world.tokens = tokens
    await startTurn($, turn)
    await endTurn($, 'answer', { turnId: turn })
    await stop($)
    await world.clock.settle()
  }
  for (const [i, tokens] of [90_000, 120_000, 135_000, 150_000].entries()) await pauseAt(tokens, `n${i}`)
  expect(seen.logs.filter(l => l.startsWith('debug: after handoff'))).toEqual([
    'debug: after handoff: context 90000 tokens (210000 before the handoff), pause 1',
    'debug: after handoff: context 120000 tokens (210000 before the handoff), pause 2',
    'debug: after handoff: context 135000 tokens (210000 before the handoff), pause 3',
  ])
})

// The account's windows next to each pause let the log be read against the week's limit; off a subscription there are none and the line stays as it was.
modTest('a pause is logged with the rate-limit windows the account reports', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 34.5 },
      { kind: 'seven_day', percentUsed: 61 },
    ],
  })
  hostWith(on, AT('info'))
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs.find(l => l.startsWith('info: pause:'))).toContain(', limits five_hour 34.5%, seven_day 61%, decided')
})

modTest('the emergency brake is logged with the threshold, the brake and the work it went past', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 360_000, agents: [{ status: 'running' }] })
  hostWith(on, AT('info'))
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs).toContain(
    'info: pause: context 360000 of 1000000 tokens (threshold 200000, brake 350000), 0 background tasks, 0 timers, 1 subagents, turn 10, no attempt before, decided act, forced past the brake by subagent',
  )
})

modTest('while the command is awaited, a turn that is not its own is logged, at its start and at its end', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await startTurn($, 't2')
  await startTurn($, 't3')
  await endTurn($, 'answer', { turnId: 't3' })
  await endTurn($, 'answer', { turnId: 't2', answer: `HANDOFF_PATH: ${FILE}` })
  await world.clock.settle()
  expect(seen.logs).toContain("debug: turn t2 is the command's turn")
  expect(seen.logs).toContain("debug: turn t3 is not the command's turn")
  expect(seen.logs).toContain("debug: the end of turn t3 is not the command's, still waiting for it")
})

const PROMPT_FILE = promptPath('/home/me')

modTest('the internal handoff is logged with where its prompt came from and how long it took', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), commands: [], modelFork: MODEL_FORK_ANSWER })
  await reachThreshold($, world)
  expect(seen.logs).toContain("debug: internal handoff asked, the mod's own prompt")
  expect(seen.logs).toContain('info: internal handoff answered, 12 characters, after 0 ms')
})

modTest('the prompt file of the user is named in the log when the internal handoff reads it', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), commands: [], modelFork: MODEL_FORK_ANSWER, files: { [PROMPT_FILE]: 'Write it in German.' } })
  await reachThreshold($, world)
  expect(seen.logs).toContain(`debug: internal handoff asked, prompt from ${PROMPT_FILE}`)
})

modTest('an internal handoff that never answers is a warning, with the time it was waited for', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), commands: [], modelFork: 'hang' })
  await reachThreshold($, world)
  await world.clock.advance(3 * MINUTE)
  expect(seen.logs).toContain('warn: internal handoff gave nothing (timeout), after 180000 ms')
})

modTest('typing held before the `/clear` is logged as part of the first message', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await typeInto($, 'early')
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('debug: held inputs in the message: 1')
})

modTest('typing held while the message is submitted is put in afterwards, and logged', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('info'), files: { [FILE]: NOTES }, during: { submit: async () => void (await typeInto($, 'late')) } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('info: held typing put in, 4 characters')
})

modTest('typing held while the message is submitted and refused afterwards is a warning, kept for redelivery', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), files: { [FILE]: NOTES }, rejectSubmitAfter: 1, during: { submit: async () => void (await typeInto($, 'late')) } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('warn: held typing kept for redelivery, 4 characters')
})

// What goes wrong is said to the person and logged at `warn` beside it: the line names the kind of failure and numbers, never the reason,
// which can carry paths, the host's words and what was typed.

modTest('a change to the internal handoff is a warning that names the stage the command failed at', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), commands: [], modelFork: MODEL_FORK_ANSWER })
  await reachThreshold($, world)
  expect(diagnostic(seen.logs)).toEqual(['warn: fallback to internal-handoff (stage command)'])
})

modTest('a failed handoff is a warning that names its stage', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), files: { [FILE]: NOTES }, failRun: ['clear'] })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(diagnostic(seen.logs)).toEqual(['warn: handover failed (stage clear)'])
})

modTest('an internal handoff that gives nothing for a reason the mod does not know is a warning without the host words', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), commands: [], modelFork: { isAnswered: false, reason: 'quota spent' } })
  await reachThreshold($, world)
  expect(seen.logs).toContain('warn: internal handoff gave nothing (other), after 0 ms')
})

modTest('a handoff cancelled with Esc is logged at info, as no failure', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('info'))
  await reachThreshold($, world)
  await startTurn($, 't2')
  await endTurn($, 'aborted', { turnId: 't2' })
  await world.clock.settle()
  expect(lines(diagnostic(seen.logs)).slice(-1)).toEqual(['info: handover cancelled'])
})

// The compact is logged like the other ways: the ask at `debug`, the end at `info`, a failure at `warn` by its stage, never with the host's words
// or a veto's text.
modTest('a compact is logged as asked at debug and as done at info, with its time', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), compact: COMPACT_DONE })
  await reachThreshold($, world)
  expect(lines(diagnostic(seen.logs)).slice(-2)).toEqual(['debug: compact asked', 'info: compacted, after 0 ms'])
})

modTest('a compact that is vetoed or refused is a warning that names the stage and not the reason', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('warn'), compact: COMPACT_VETO })
  await reachThreshold($, world)
  expect(diagnostic(seen.logs)).toEqual(['warn: compact skipped', 'warn: handover failed (stage compact)'])
  expect(seen.logs.join('\n')).not.toContain('info:')
})

modTest('a compact the host refuses is a warning of its own', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('warn'))
  await reachThreshold($, world)
  expect(diagnostic(seen.logs)).toEqual(['warn: compact refused', 'warn: handover failed (stage compact)'])
})

modTest('after a compact the first pauses of the session are logged against the context before it, as after a handoff', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), compact: COMPACT_DONE })
  await reachThreshold($, world)
  world.tokens = 90_000
  await startTurn($, 'n0')
  await endTurn($, 'answer', { turnId: 'n0' })
  await stop($)
  await world.clock.settle()
  expect(seen.logs.filter(l => l.startsWith('debug: after handoff'))).toEqual([
    'debug: after handoff: context 90000 tokens (210000 before the handoff), pause 1',
  ])
})

// The first tool call after a compact that reads a size judges it, once; one that reads none says nothing and leaves it to the next.
modTest('the tool call that judges a compact logs what it found at debug, and no other call does', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), compact: COMPACT_DONE })
  await reachThreshold($, world)
  const call = () => $.tool.call({ tool: 'Read', file_path: '/tmp/a', tool_use_id: 'u1' } as never)
  const judged = () => seen.logs.filter(l => l.startsWith('debug: compact left'))
  world.tokens = undefined
  await call()
  expect(judged()).toEqual([])
  world.tokens = 90_000
  await call()
  world.tokens = 250_000
  await call()
  expect(judged()).toEqual(['debug: compact left 90000 tokens, below the threshold'])
})

modTest('a compact the first tool call finds not enough is said once at debug, not again at the pause', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), compact: COMPACT_DONE })
  await reachThreshold($, world)
  world.tokens = 250_000
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a', tool_use_id: 'u1' } as never)
  await startTurn($, 'n0')
  await endTurn($, 'answer', { turnId: 'n0' })
  await stop($)
  await world.clock.settle()
  expect(seen.logs.filter(l => l.startsWith('debug: compact left'))).toEqual(['debug: compact left the context above the threshold'])
})

modTest('a size the first tool call after a compact cannot read is said at debug, and the pause judges the compact', COMPACT_ONLY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), compact: COMPACT_DONE })
  await reachThreshold($, world)
  world.usageError = 'down'
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a', tool_use_id: 'u1' } as never)
  expect(seen.logs.filter(l => l.includes('tool call'))).toEqual(['debug: could not read the context size at a tool call, the pause judges the compact'])
})

modTest('a pause that cannot be read is a warning once, as the line the person gets', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { usageError: 'down' })
  hostWith(on, AT('warn'))
  await startSession($)
  for (const turn of ['t1', 't2']) {
    await startTurn($, turn)
    await endTurn($, 'answer', { turnId: turn })
    await stop($)
  }
  expect(diagnostic(seen.logs)).toEqual(['warn: could not check for a handoff'])
})

modTest('settings the mod rejects are a warning with their number', { options: { handoff_command: '/handoff', min_gap_turns: 2.5 } }, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('warn'))
  await startSession($)
  expect(diagnostic(seen.logs)).toEqual(['warn: settings rejected, 2 errors'])
})

modTest('a redelivery is logged where it starts and where it ends', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { ...AT('info'), files: { [FILE]: NOTES }, dropSubmit: 'no' })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  host.dropSubmit = undefined
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(lines(diagnostic(seen.logs)).slice(-2)).toEqual(['info: redeliver starts', 'info: redeliver ends, delivered'])
})

modTest('a redelivery that fails ends with a warning that names its stage', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('info'), files: { [FILE]: NOTES }, dropSubmit: 'no' })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(lines(diagnostic(seen.logs)).slice(-3)).toEqual([
    'info: redeliver starts',
    'info: redeliver ends, not delivered',
    'warn: redelivery failed (stage submit)',
  ])
})

modTest('the raw stop is logged at trace before any judgement, with the agent it came from', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('trace'))
  await startSession($)
  await stop($, { agent_id: 'a1' })
  expect(lines(seen.logs)).toEqual(['trace: stop, agent a1', 'debug: stop of agent a1, not a pause'])
})

modTest('the raw stop is not logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on, AT('debug'))
  await startSession($)
  await stop($)
  expect(lines(seen.logs)).toEqual(['debug: stop, not handing over', 'debug: judge: waiting for the end of the turn'])
})

// A failure caught with nothing to show for it would leave no trace at all: each has a line at `debug`.

modTest('a pending message the store does not let go of is logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES }, failStore: ['delete:pending:old'] })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('debug: could not forget the pending message')
})

modTest('a failure reason the store does not keep, or does not let go of, is logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES }, failRun: ['clear'], failStore: ['set:failure', 'delete:failure'] })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('debug: could not keep the failure')
  expect(seen.logs).not.toContain('debug: could not forget the failure')
})

modTest('a success whose old failure reason the store does not let go of is logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES }, failStore: ['delete:failure'] })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('debug: could not forget the failure')
})

modTest('a session id that cannot be read after the clear is logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES } })
  host.during['run clear'] = async () => void (host.sessionIdFails = true)
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('debug: session id unknown after the clear')
})

modTest('a session id that cannot be read at a redelivery is logged at debug', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { ...AT('debug'), files: { [FILE]: NOTES }, dropSubmit: 'no' })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  host.sessionIdFails = true
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(seen.logs).toContain('debug: session id unknown at redelivery')
})

// No line of the diagnostic output carries what a person or the host wrote: each scenario plants marked text wherever the mod could pick
// it up, and no line at any level may show it.

const SECRET = /SECRET/
const scenarios: [string, Partial<import('./test-support').Host>, string][] = [
  [
    'the command, with typing that is lost',
    {
      files: { [FILE]: 'NOTES-SECRET' },
      rejectSubmitAfter: 1,
      failStore: ['set:pending:new'],
    },
    `ANSWER-SECRET\nHANDOFF_PATH: ${FILE}`,
  ],
  [
    'the internal handoff, which fails for a reason of the host',
    { commands: [], files: { [PROMPT_FILE]: 'PROMPT-SECRET' }, modelFork: { isAnswered: false, reason: 'REASON-SECRET' } },
    '',
  ],
  ['the internal handoff, whose message is dropped', { commands: [], modelFork: { isAnswered: true, text: 'HANDOFF-SECRET' }, dropSubmit: 'DROP-SECRET' }, ''],
  ['a clear that fails', { files: { [FILE]: 'NOTES-SECRET' }, failRun: ['clear'] }, `ANSWER-SECRET HANDOFF_PATH: ${FILE}`],
]

for (const [name, host, answer] of scenarios) {
  modTest(`at trace no diagnostic line carries text of a person or the host: ${name}`, LIVE, async ($, on) => {
    const seen = withMod(on)
    seen.refuse = 'REFUSE-SECRET'
    const world = sessionWith(on)
    const h = hostWith(on, { ...AT('trace'), ...host })
    h.during.submit = async () => void (await typeInto($, 'TYPED-SECRET'))
    await reachThreshold($, world)
    if (answer !== '') await commandTurnEnds($, world, answer)
    await runRelay($, 'redeliver')
    await world.clock.settle()
    world.usageError = 'USAGE-SECRET'
    await startTurn($, 't9')
    await endTurn($, 'answer', { turnId: 't9' })
    await stop($)
    expect(seen.logs.some(l => SECRET.test(l))).toBe(true)
    expect(diagnostic(seen.logs).filter(l => SECRET.test(l))).toEqual([])
  })
}

// `/sweet-spot later`: what it made of the command at debug, the value a pause judges at in the pause line. Never what was typed.
const LATER_DRY = { options: { dry_run: true, min_gap_minutes: 0, min_gap_turns: 0 } }
const laterLines = (logs: string[]) => lines(diagnostic(logs)).filter(l => l.includes('later') || l.startsWith('info: pause:'))
const laterAt = async ($: TestEngine, world: ReturnType<typeof sessionWith>, tokens: number, args: string) => {
  world.tokens = tokens
  await runRelay($, args)
}

modTest('later is logged when it is taken, turned down and spent, and the pause line shows the value it judges at', LATER_DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('debug'))
  await startSession($)
  await laterAt($, world, 190_000, 'later 50k')
  await laterAt($, world, 195_000, 'later abc')
  await laterAt($, world, 195_000, 'later 10k')
  await pauseAt($, world, 240_000)
  expect(laterLines(seen.logs)).toEqual([
    'debug: later: from context 190000, 50000 tokens, hands over at 240000',
    'debug: later: turned down, not a number of tokens',
    'debug: later: turned down, not past 240000',
    'info: pause: context 240000 of 1000000 tokens (threshold 200000, later 240000, brake 350000), 0 background tasks, 0 timers, 0 subagents, turn 10, no attempt before, decided dry-run',
    'debug: later: spent by this handover',
  ])
})

modTest('later capped at the brake, turned down at it, and over when the context shrank', LATER_DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('debug'))
  await startSession($)
  await laterAt($, world, 300_000, 'later 100k')
  await laterAt($, world, 360_000, 'later 10k')
  await pauseAt($, world, 100_000)
  expect(laterLines(seen.logs)).toEqual([
    'debug: later: from context 300000, 100000 tokens, hands over at 350000, capped at the emergency brake',
    'debug: later: turned down, at the emergency brake',
    'debug: later: over, the context shrank below where it was asked',
    'info: pause: context 100000 of 1000000 tokens (threshold 200000, brake 350000), 0 background tasks, 0 timers, 0 subagents, turn 10, no attempt before, decided none',
  ])
})

modTest('later with settings the mod cannot trust is logged as turned down', { options: { handoff_command: '/handoff' } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('debug'))
  await startSession($)
  await laterAt($, world, 190_000, 'later 50k')
  expect(laterLines(seen.logs)).toEqual(['debug: later: turned down, the settings are rejected'])
})

modTest('later with no reading of the context, and while a handover runs, is logged as turned down', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { tokens: undefined })
  hostWith(on, AT('debug'))
  await startSession($)
  await runRelay($, 'later 50k')
  world.tokens = 210_000
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  await runRelay($, 'later 50k')
  expect(diagnostic(seen.logs).filter(l => l.includes('later:'))).toEqual([
    'debug: later: turned down, the context size is unknown',
    'debug: later: turned down, a handover is in progress',
  ])
  await world.clock.settle()
})

modTest('a context that cannot be read is a warning without the reason, and nothing typed is ever in a line', LATER_DRY, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, AT('trace'))
  await startSession($)
  await laterAt($, world, 190_000, 'later SECRET-TEXT')
  world.usageError = 'no usage'
  await laterAt($, world, 190_000, 'later 50k')
  expect(diagnostic(seen.logs).filter(l => l.includes('later:'))).toEqual([
    'debug: later: turned down, not a number of tokens',
    'warn: later: could not read the context size',
  ])
  expect(seen.logs.filter(l => l.includes('SECRET') || l.includes('no implementation'))).toEqual([])
})
