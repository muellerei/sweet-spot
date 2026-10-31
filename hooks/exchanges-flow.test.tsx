import { expect } from 'claude-code/testing'

import { DEFAULT_PROMPT, promptPath } from './handoff'
import { LIVE_IDLE, T, idleSession, step } from './idle-support'
import {
  ANSWERED,
  FILE,
  LIVE,
  MINUTE,
  NOTES,
  commandTurnEnds,
  endTurn,
  runRelay,
  startTurn,
  hostWith,
  methods,
  modTest,
  sessionWith,
  startSession,
  stop,
  typeInto,
  withMod,
  type Host,
  type SessionWorld,
  type TestEngine,
} from './test-support'

// The last exchanges, through the host: what is typed and answered, and what the fresh session's first message then carries.

const INTERNAL = methods('internal-handoff', 'none')
const HANDOFF = 'goal: finish the parser\nnext: the lexer'
const INTRO =
  'The last exchanges with the user in the previous session, word for word, oldest first, for reference only. The handoff above says what to do next.'
const OUTRO = 'End of the verbatim exchanges.'

// A prompt typed at rest, in the host's order: its turn starts before the submit resolves (docs/host-behaviour.md, Requests and turns).
const ask = async ($: TestEngine, host: Host, text: string, turnId: string, extra: object = {}) => {
  host.during.submit = async () => void (await $.turn.start({ text, turnId }))
  await typeInto($, text, extra)
}

// The turn ends in this answer, the stop follows, and what the stop started runs.
const answer = async ($: TestEngine, world: SessionWorld, turnId: string, text: string) => {
  await endTurn($, 'answer', { turnId, answer: text })
  await stop($)
  await world.clock.settle()
}

// The fake lists every submit, the person's own too; the first message is the one that starts as the mod writes it.
const firstSubmit = (host: Host) => host.steps.find(s => s.startsWith('submit Handoff from'))?.slice('submit '.length)

const exchange = (request: string, reply: string) =>
  ['<previous-exchange>', '<request>', request, '</request>', '<answer>', reply, '</answer>', '</previous-exchange>'].join('\n')

const handedOver = (attachment: string) =>
  `Handoff from the previous session. Read it and carry on with the next step.\n\n${HANDOFF}${attachment === '' ? '' : `\n\n${attachment}`}`

modTest('the request and the answer before the handover follow the handoff in the first message', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'what does the lexer do?', 't1')
  await answer($, world, 't1', 'It splits the input into tokens.')
  expect(firstSubmit(host)).toBe(undefined)
  world.tokens = 210_000
  await ask($, host, 'and the parser?', 't2')
  await answer($, world, 't2', 'It builds the tree from the tokens.')
  expect(firstSubmit(host)).toBe(handedOver([INTRO, exchange('and the parser?', 'It builds the tree from the tokens.'), OUTRO].join('\n')))
})

modTest('what is typed during the handover still comes last, after the exchanges', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  host.during['model.fork'] = async () => void (await typeInto($, 'one more thing'))
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  const text = firstSubmit(host) ?? ''
  expect(text.indexOf(OUTRO)).toBeGreaterThan(text.indexOf(HANDOFF))
  expect(text.indexOf('one more thing')).toBeGreaterThan(text.indexOf(OUTRO))
})

modTest('with last_exchanges 0 the first message is the one of today', methods('internal-handoff', 'none', { last_exchanges: 0 }), async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(''))
})

modTest(
  'only what the user typed is a request: a plugin message is not, nor a request another hook dropped',
  methods('internal-handoff', 'none', { last_exchanges: 5 }),
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on, { tokens: 100_000 })
    const host = hostWith(on, { modelFork: ANSWERED })
    await startSession($)
    await ask($, host, 'R1', 't1')
    await answer($, world, 't1', 'A1')
    host.during.submit = async () => void (await $.turn.start({ text: 'P', turnId: 't2' }))
    await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
    await endTurn($, 'answer', { turnId: 't2', answer: 'plugin answer' })
    await stop($)
    world.tokens = 210_000
    await ask($, host, 'R3', 't3')
    host.dropSubmit = 'not here'
    await typeInto($, 'dropped', { turnId: 't3' })
    host.dropSubmit = undefined
    await answer($, world, 't3', 'A3')
    expect(firstSubmit(host)).toBe(handedOver([INTRO, exchange('R1', 'A1'), exchange('R3', 'A3'), OUTRO].join('\n')))
  },
)

modTest('the diagnostic line counts the exchanges, and says nothing of what they hold', INTERNAL, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, logLevel: 'debug' })
  await startSession($)
  await ask($, host, 'secret request', 't1')
  await answer($, world, 't1', 'secret answer')
  expect(seen.logs).toContain('debug: last exchanges: 1 of 1, 0 shortened')
  expect(seen.logs.filter(l => l.includes('secret'))).toEqual([])
})

modTest("A24: a prompt of the user's own is asked as it is, and the exchanges still follow the handoff", INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, files: { [promptPath('/home/me')]: 'my own prompt' } })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  expect(host.modelForkPrompts).toEqual(['my own prompt'])
  expect(firstSubmit(host)).toBe(handedOver([INTRO, exchange('R', 'A'), OUTRO].join('\n')))
})

// Every way that ends in /clear carries the same attachment; builtin compact carries none.

const ONE = (request = 'R', reply = 'A') => [INTRO, exchange(request, reply), OUTRO].join('\n')
const byCommand = (attachment: string) =>
  `Handoff from the previous session. Read it and carry on with the next step.\n\n${NOTES}${attachment === '' ? '' : `\n\n${attachment}`}`

modTest("A2: through the user's command the same attachment goes, without the command's own turn", LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES } })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  await commandTurnEnds($, world, `All written.\nHANDOFF_PATH: ${FILE}`)
  expect(firstSubmit(host)).toBe(byCommand(ONE()))
})

modTest('the fallback after a failed command carries the same attachment', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(ONE()))
})

modTest('builtin compact submits nothing', methods('builtin-compact', 'none'), async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { compact: { messages: [{ role: 'user', text: 'summary', toolUses: [] }] } })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  expect(host.steps.filter(s => !s.startsWith('submit R'))).toEqual(['compact'])
})

modTest('a fallback through /clear after a refused compact carries the attachment', methods('builtin-compact', 'internal-handoff'), async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(ONE()))
})

modTest('the idle handoff carries the exchanges before the pause, and the message that came back stays last', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await startSession($)
  await $.classic.SessionStart({ source: 'startup', transcript_path: T } as never)
  await ask($, host, 'R', 't1')
  await step($, 't1')
  await stop($, { transcript_path: T } as never)
  await endTurn($, 'answer', { turnId: 't1', answer: 'A' })
  await world.clock.advance(130 * MINUTE)
  await typeInto($, 'hello again')
  await world.clock.settle()
  const handoff = 'Handoff from the previous session. Read it and carry on with the next step.\n\ngoal: finish the parser'
  expect(firstSubmit(host)).toBe(`${handoff}\n\n${ONE()}\n\nThe person's next message:\nhello again`)
})

modTest("A7: in the host's order, the stop before the end of the turn, the answer of that turn is in the attachment", INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  await stop($)
  await endTurn($, 'answer', { turnId: 't1', answer: 'A' })
  await world.clock.settle()
  expect(firstSubmit(host)).toBe(handedOver(ONE()))
})

modTest('the message kept for redeliver carries the attachment', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  host.dropSubmit = 'held by another hook'
  await answer($, world, 't1', 'A')
  host.dropSubmit = undefined
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(host.steps.at(-1)).toBe(`submit ${handedOver(ONE())}`)
})

modTest('a last turn with no request (a command run as a fork) leaves the exchange before it, and the prompt as it is', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R1', 't1')
  await answer($, world, 't1', 'A1')
  world.tokens = 210_000
  await startTurn($, 't2')
  await answer($, world, 't2', 'what the fork said')
  expect(host.modelForkPrompts).toEqual([DEFAULT_PROMPT])
  expect(firstSubmit(host)).toBe(handedOver(ONE('R1', 'A1')))
})

modTest('with no exchange recorded (as after a reload) nothing is attached', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await startTurn($, 't1')
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(''))
})

modTest("A20: a /clear of the user's own starts the record over", methods('internal-handoff', 'none', { last_exchanges: 5 }), async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R1', 't1')
  await answer($, world, 't1', 'A1')
  await $.command.run({ command: 'clear' } as never)
  world.tokens = 210_000
  await ask($, host, 'R2', 't2')
  await answer($, world, 't2', 'A2')
  expect(firstSubmit(host)).toBe(handedOver(ONE('R2', 'A2')))
})

// Which input is a request, and which answer it stands with.

const TWO = methods('internal-handoff', 'none', { last_exchanges: 2 })

modTest('with only turns of plugin messages nothing is attached, the prompt stays whole, and the line says 0 of 1', INTERNAL, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, logLevel: 'debug' })
  await startSession($)
  host.during.submit = async () => void (await $.turn.start({ text: 'P', turnId: 't1' }))
  await $.prompt.submit({ text: 'from a plugin', wait: false, origin: { kind: 'plugin', name: 'other' } } as never)
  await answer($, world, 't1', 'plugin answer')
  expect(host.modelForkPrompts).toEqual([DEFAULT_PROMPT])
  expect(firstSubmit(host)).toBe(handedOver(''))
  expect(seen.logs).toContain('debug: last exchanges: 0 of 1, 0 shortened')
})

modTest('a turn ended with Esc shows as interrupted, and does not take the answer of the turn before', TWO, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R1', 't1')
  await answer($, world, 't1', 'A1')
  await ask($, host, 'R2', 't2')
  await endTurn($, 'aborted', { turnId: 't2' })
  world.tokens = 210_000
  await startTurn($, 't3')
  await answer($, world, 't3', 'a background task reported')
  const interrupted = ['<previous-exchange>', '<request>', 'R2', '</request>', '<no-answer>The turn was interrupted.</no-answer>', '</previous-exchange>']
  expect(firstSubmit(host)).toBe(handedOver([INTRO, exchange('R1', 'A1'), ...interrupted, OUTRO].join('\n')))
})

modTest('typed over a turn it joins that turn; a background notice and a hidden prompt are no request', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R1', 't1')
  await typeInto($, 'R2', { turnId: 't1' })
  await $.prompt.submit({ text: 'task done', wait: false, turnId: 't1', origin: { kind: 'task-notification' } } as never)
  await typeInto($, 'hidden', { turnId: 't1', isMeta: true })
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(ONE('R1\n\nR2', 'A')))
})

modTest('typed over a turn that ends first, it starts the next turn and stands with that answer', TWO, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R1', 't1')
  await typeInto($, 'R2', { turnId: 't1' })
  await answer($, world, 't1', 'A1')
  world.tokens = 210_000
  await $.turn.start({ text: 'R2', turnId: 't2' })
  await answer($, world, 't2', 'A2')
  expect(firstSubmit(host)).toBe(handedOver([INTRO, exchange('R1', 'A1'), exchange('R2', 'A2'), OUTRO].join('\n')))
})

modTest('a typed slash command stands as typed, an image as a line', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  host.during.submit = async () => void (await $.turn.start({ text: '<command-message>to-spec</command-message>', turnId: 't1' }))
  await typeInto($, '/to-spec x', { command: { name: 'to-spec', args: 'x' }, attachments: [{ type: 'image', mediaType: 'image/png' }] })
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(ONE('/to-spec x\n[image]', 'A')))
})

modTest(
  'a slash command let through while the handover runs is no request, even when that handover fails',
  methods('external-command', 'none', { last_exchanges: 5, min_gap_minutes: 0, min_gap_turns: 0 }),
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES } })
    await startSession($)
    await ask($, host, 'R', 't1')
    await answer($, world, 't1', 'A')
    // The command's turn: a slash command typed over it goes through, and the turn ends with no file.
    await startTurn($, 't2')
    await typeInto($, '/status', { turnId: 't2', command: { name: 'status', args: '' } })
    await endTurn($, 'answer', { turnId: 't2', answer: 'no file' })
    await world.clock.settle()
    // The next pause hands over again, and this time the command names its file.
    await startTurn($, 't3')
    await answer($, world, 't3', 'more work')
    await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`, 't4')
    expect(firstSubmit(host)).toBe(byCommand(ONE()))
  },
)

modTest(
  'the fresh session starts its record empty: a second handover with no request in between attaches nothing',
  methods('internal-handoff', 'none', { min_gap_minutes: 0, min_gap_turns: 0 }),
  async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { modelFork: ANSWERED })
    await startSession($)
    await ask($, host, 'R', 't1')
    await answer($, world, 't1', 'A')
    expect(firstSubmit(host)).toBe(handedOver(ONE()))
    host.steps.length = 0
    // The host ends the old session at /clear (`session.end`, reason `clear`); the fake does not raise it by itself.
    await $.session.end({ reason: 'clear', sessionId: 'old', resume: { id: 'old' } } as never)
    await startTurn($, 't2')
    await answer($, world, 't2', 'the fresh session read the handoff')
    expect(firstSubmit(host)).toBe(handedOver(''))
  },
)

modTest('a request a hook beneath rewrote goes along as it arrived, not as it was typed', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { modelFork: ANSWERED, rewriteSubmit: text => text.replace('abc123', '***') })
  await startSession($)
  await ask($, host, 'token=abc123', 't1')
  await answer($, world, 't1', 'A')
  expect(firstSubmit(host)).toBe(handedOver(ONE('token=***', 'A')))
})

modTest('a /clear or /resume of the user ends the record, before any request of the next session', INTERNAL, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 100_000 })
  const host = hostWith(on, { modelFork: ANSWERED })
  await startSession($)
  await ask($, host, 'R', 't1')
  await answer($, world, 't1', 'A')
  await $.session.end({ reason: 'resume', sessionId: 'old', resume: { id: 'old' } } as never)
  world.tokens = 210_000
  await startTurn($, 't2')
  await answer($, world, 't2', 'a background task reported')
  expect(firstSubmit(host)).toBe(handedOver(''))
})
