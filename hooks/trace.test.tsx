import { test, expect } from 'claude-code/testing'

import { firstMessage } from './handoff'
import {
  commandTurnEnds,
  endTurn,
  FILE,
  hostWith,
  LIVE,
  MINUTE,
  NOTES,
  reachThreshold,
  sessionWith,
  startSession,
  startTurn,
  stop,
  typeInto,
  withMod,
} from './test-support'

// `trace` is a development aid: one line per event the mod acts on, in the transcript, where the host stamps the time. Off, the mod says
// nothing but what a person needs.

const TRACE = { options: { ...LIVE.options, trace: true } }
const FORKED = { isAnswered: true, text: 'goal: finish' }
const PAUSE =
  'trace: pause: context 210000 of 1000000 tokens (threshold 200000, brake 350000), 0 background tasks, 0 timers, 0 subagents, turn 10, no attempt before, decided act'

test('a pause is traced from the turn to the decision', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  await world.clock.settle()
  expect(seen.logs.slice(0, 7)).toEqual([
    'trace: turn.start t1',
    'trace: turn.complete t1 answer',
    'trace: judge: waiting for the stop',
    'trace: stop, not handing over',
    'trace: judge: the stop and the end of the turn are both in, the turn ended in answer',
    PAUSE,
    'handing over now, context 210000 tokens',
  ])
})

test('a stop before the end of its turn is traced as waiting, and the end as the one that judges', TRACE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on)
  await startSession($)
  await startTurn($, 't1')
  await stop($)
  expect(seen.logs).toEqual(['trace: turn.start t1', 'trace: stop, not handing over', 'trace: judge: waiting for the end of the turn'])
})

test('an end that is no answer is traced as no pause', TRACE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on)
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'aborted', { turnId: 't1' })
  await stop($)
  expect(seen.logs.at(-1)).toBe('trace: judge: the turn ended in aborted, no pause')
})

test('the handoff is traced step by step', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `All written.\nHANDOFF_PATH: ${FILE}`)
  const message = firstMessage(NOTES)
  expect(seen.logs.slice(7)).toEqual([
    'trace: handoff starts, command "handoff"',
    'trace: command "handoff" is listed',
    'trace: command started, waiting for its turn',
    'trace: turn.start t2',
    "trace: turn t2 is the command's turn",
    'trace: turn.complete t2 answer',
    'trace: judge: waiting for the stop',
    `trace: the command's turn ended, the answer names ${FILE}`,
    `trace: file read, ${NOTES.length} characters`,
    'trace: clear, session old',
    `trace: submit, session new, ${message.length} characters`,
    'trace: submit done',
    'handed over, the fresh session carries on from the handoff',
  ])
})

test('with no handoff command set the trace says so, as the settings line does', { options: { ...TRACE.options, handoff_command: '' } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { fork: FORKED })
  await reachThreshold($, world)
  expect(seen.logs).toContain('trace: handoff starts, command none')
})

// What the fresh session starts at, and how it grows over its first pauses, is what the handoff's reload costs: read from the log and not
// worked out from the transcript afterwards.
test('after a handoff the first three pauses of the fresh session are traced against the context before it', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
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
  expect(seen.logs.filter(l => l.startsWith('trace: after handoff'))).toEqual([
    'trace: after handoff: context 90000 tokens (210000 before the handoff), pause 1',
    'trace: after handoff: context 120000 tokens (210000 before the handoff), pause 2',
    'trace: after handoff: context 135000 tokens (210000 before the handoff), pause 3',
  ])
})

// The account's windows next to each pause let the log be read against the week's limit; off a subscription there are none and the line stays as it was.
test('a pause is traced with the rate-limit windows the account reports', TRACE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, {
    rateLimits: [
      { kind: 'five_hour', percentUsed: 34.5 },
      { kind: 'seven_day', percentUsed: 61 },
    ],
  })
  hostWith(on)
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs.find(l => l.startsWith('trace: pause:'))).toContain(', limits five_hour 34.5%, seven_day 61%, decided')
})

test('with trace off the mod says nothing of the kind', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  hostWith(on)
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs.filter(l => l.startsWith('trace:'))).toEqual([])
})

test('the emergency brake is traced with the threshold, the brake and the work it went past', TRACE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 360_000, agents: [{ status: 'running' }] })
  hostWith(on)
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
  expect(seen.logs).toContain(
    'trace: pause: context 360000 of 1000000 tokens (threshold 200000, brake 350000), 0 background tasks, 0 timers, 1 subagents, turn 10, no attempt before, decided act, forced past the brake by subagent',
  )
})

test('while the command is awaited, a turn that is not its own is traced, at its start and at its end', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await startTurn($, 't2')
  await startTurn($, 't3')
  await endTurn($, 'answer', { turnId: 't3' })
  await endTurn($, 'answer', { turnId: 't2', answer: `HANDOFF_PATH: ${FILE}` })
  await world.clock.settle()
  expect(seen.logs).toContain("trace: turn t2 is the command's turn")
  expect(seen.logs).toContain("trace: turn t3 is not the command's turn")
  expect(seen.logs).toContain("trace: the end of turn t3 is not the command's, still waiting for it")
})

const PROMPT_FILE = '/home/me/.claude/context-relay/handoff-prompt.md'

test('the fork is traced with where its prompt came from and how long it took', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [], fork: FORKED })
  await reachThreshold($, world)
  expect(seen.logs).toContain("trace: fork asked, the mod's own prompt")
  expect(seen.logs).toContain('trace: fork answered, 12 characters, after 0 ms')
})

test('the prompt file of the user is named in the trace when the fork reads it', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [], fork: FORKED, files: { [PROMPT_FILE]: 'Write it in German.' } })
  await reachThreshold($, world)
  expect(seen.logs).toContain(`trace: fork asked, prompt from ${PROMPT_FILE}`)
})

test('a fork that never answers is traced with the time it was waited for', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { commands: [], fork: 'hang' })
  await reachThreshold($, world)
  await world.clock.advance(3 * MINUTE)
  expect(seen.logs).toContain('trace: fork gave nothing, the fork did not answer within 3 minutes, after 180000 ms')
})

test('typing held before the `/clear` is traced as part of the first message', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await typeInto($, 'early')
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('trace: held inputs in the message: 1')
})

test('typing held while the message is submitted is put in afterwards, and traced', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES }, during: { submit: async () => void (await typeInto($, 'late')) } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('trace: held typing put in, 4 characters')
})

test('typing held while the message is submitted and refused afterwards is traced as kept for redelivery', TRACE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  hostWith(on, { files: { [FILE]: NOTES }, rejectSubmitAfter: 1, during: { submit: async () => void (await typeInto($, 'late')) } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(seen.logs).toContain('trace: held typing kept for redelivery, 4 characters')
})
