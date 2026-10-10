import { test, expect } from 'claude-code/testing'

import { ASK_FOR_PATH, DEFAULT_PROMPT, firstMessage, promptPath } from './handoff'
import {
  commandTurnEnds,
  endTurn,
  FILE,
  forkAnswer,
  hostWith,
  LIVE,
  NO_GAP,
  NOTES,
  raiseHandoff,
  reachThreshold,
  runRelay,
  sessionWith,
  startTurn,
  stop,
  typeInto,
  withMod,
  type Host,
  type SessionWorld,
  type TestEngine,
  MINUTE,
  DUE,
  HANDED,
  failure,
  fellBack,
  FORK_ALSO,
} from './test-support'

// When the user's command is missing or its turn brings no handoff, the mod hands over with a fork of the history instead: the same
// `/clear`, first message, held typing and `redeliver` follow, and the change of way is said with its reason.

const RUN = `run handoff ${ASK_FOR_PATH}`
const PROMPT_FILE = promptPath('/home/me')
const ANSWERED = forkAnswer('goal: finish the parser\nnext: the lexer')
const HANDOFF = firstMessage(ANSWERED.text)
const NO_COMMAND = 'the command "handoff" does not exist'

test('without the command the fork answers, and its text is the first message of the cleared session', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], fork: ANSWERED })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}`])
  expect(host.forked).toEqual([DEFAULT_PROMPT])
  expect(seen.logs).toEqual([DUE, fellBack(NO_COMMAND), HANDED])
  expect(seen.toasts).toEqual([DUE, fellBack(NO_COMMAND), HANDED])
})

// No handoff command set, the default: the fork writes the handoff at once. A command named `handoff` that happens to exist is not
// run, and there is no fallback to report, because nothing was tried before.
test('with no handoff command set the fork writes the handoff, and no command runs', { options: { dry_run: false } }, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { fork: ANSWERED })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}`])
  expect(host.forked).toEqual([DEFAULT_PROMPT])
  expect(seen.logs).toEqual([DUE, HANDED])
})

// Each of these stops the command from giving a handoff; the session is as it was when the fork is asked.
const fallingBack: [string, (host: Host) => void, (w: SessionWorld, $: TestEngine) => Promise<void>, string][] = [
  ['the command does not exist', host => (host.commands = []), async () => {}, NO_COMMAND],
  [
    'the command does not start',
    host => host.failRun.push('handoff'),
    async () => {},
    'the command "handoff" did not start (no implementation for command.run)',
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
  ],
  [
    'its turn never ends',
    () => {},
    async w => {
      await w.clock.advance(5 * MINUTE)
    },
    "the command's turn did not end within 5 minutes",
  ],
  [
    'no path is named and no file was written',
    () => {},
    (w, $) => commandTurnEnds($, w, 'Done, trust me.'),
    'the answer names no handoff file and the temp directory has none from this run',
  ],
  [
    'the file named cannot be read',
    () => {},
    (w, $) => commandTurnEnds($, w, 'HANDOFF_PATH: /var/T/missing.md'),
    'the handoff file could not be read (sweet-spot: $.fs.read: no such file: /var/T/missing.md)',
  ],
  [
    'the file named is older than the run',
    host => {
      host.files[FILE] = NOTES
      host.listing = [{ name: 'handoff-1.md', mtimeMs: -1 }]
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
    `the handoff file ${FILE} was not written by this run`,
  ],
  [
    'the file named is too large',
    host => {
      host.files[FILE] = NOTES
      host.listing = [{ name: 'handoff-1.md', mtimeMs: Number.MAX_SAFE_INTEGER, size: 300_000 }]
    },
    (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`),
    `the handoff file ${FILE} is too large (300000 bytes)`,
  ],
  ['the file is empty', host => (host.files[FILE] = ' \n'), (w, $) => commandTurnEnds($, w, `HANDOFF_PATH: ${FILE}`), 'the handoff file is empty'],
]

for (const [name, arrange, act, reason] of fallingBack) {
  test(`when ${name}, the fork takes over and the reason of the change is said`, LIVE, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { fork: ANSWERED })
    arrange(host)
    await reachThreshold($, world)
    await act(world, $)
    expect(host.forked).toEqual([DEFAULT_PROMPT])
    expect(host.steps.slice(-2)).toEqual(['run clear', `submit ${HANDOFF}`])
    expect(seen.logs).toEqual([DUE, fellBack(reason), HANDED])
  })
}

// An interrupted turn is the user's own stop: the session is left as it was, with no fork and no `/clear`.
test("when the command's turn is interrupted, the handoff is cancelled and the session is left as it was", LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { fork: ANSWERED })
  await reachThreshold($, world)
  await startTurn($, 't2')
  await endTurn($, 'aborted', { turnId: 't2' })
  await world.clock.settle()
  expect(host.forked).toEqual([])
  expect(host.steps).toEqual([RUN])
  expect(seen.logs).toEqual([DUE, 'handoff cancelled, the session is as it was'])
})

test('a /clear that returns without a new session fails the handoff and submits nothing', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { fork: ANSWERED, files: { [FILE]: NOTES } })
  host.clearKeepsSession = true
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.forked).toEqual([])
  expect(host.steps.filter(s => s.startsWith('submit'))).toEqual([])
  expect(seen.logs).toEqual([DUE, failure('/clear returned but the session is the same, the session is as it was')])
})

test('the fork is not asked before the command has failed', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { fork: ANSWERED, files: { [FILE]: NOTES } })
  await reachThreshold($, world)
  await world.clock.advance(MINUTE)
  expect(host.forked).toEqual([])
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.forked).toEqual([])
})

// What failed after the command gave its handoff, or what no stage expected, is not a missing handoff: a fork would not mend it.
const notFallingBack: [string, (host: Host) => void, string, string][] = [
  [
    '/clear fails',
    host => {
      host.files[FILE] = NOTES
      host.failRun.push('clear')
    },
    '/clear failed (no implementation for command.run), the session is as it was',
    `HANDOFF_PATH: ${FILE}`,
  ],
  [
    'the first message is dropped',
    host => {
      host.files[FILE] = NOTES
      host.dropSubmit = 'held'
    },
    `the fresh session did not get the handoff (a hook dropped it: held); it is in ${FILE}`,
    `HANDOFF_PATH: ${FILE}`,
  ],
  ['the environment cannot be read', host => (host.envError = 'denied'), 'sweet-spot: $.env.get: denied', 'no line'],
]

for (const [name, arrange, reason, answer] of notFallingBack) {
  test(`when ${name}, the fork is not asked and the handoff fails with its own reason`, LIVE, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { fork: ANSWERED })
    arrange(host)
    await reachThreshold($, world)
    await commandTurnEnds($, world, answer)
    expect(host.forked).toEqual([])
    expect(seen.logs).toEqual([DUE, failure(reason)])
  })
}

// The fork gives nothing: the handoff fails, the session stays as it was, and the next try waits for the minimum gap.
const givingNothing: [string, Record<string, unknown> | 'throw' | 'hang', string][] = [
  ['has nothing to fork', { isAnswered: false, reason: 'nothing-to-fork' }, FORK_ALSO],
  [
    'meets an API error',
    { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: {} },
    'the fork gave no handoff: the API failed (status 529)',
  ],
  ['gets an empty reply', { isAnswered: false, reason: 'empty-reply', usage: {} }, 'the fork gave no handoff: the fork replied with nothing'],
  ['is aborted', { isAnswered: false, reason: 'aborted' }, 'the fork gave no handoff: the fork was aborted'],
  ['answers with an empty text', { isAnswered: true, text: '', usage: {} }, 'the fork gave no handoff: the fork replied with no text'],
  ['answers with blanks only', { isAnswered: true, text: ' \n\t', usage: {} }, 'the fork gave no handoff: the fork replied with no text'],
  ['throws', 'throw', 'the fork gave no handoff: the fork failed (no implementation for model.fork)'],
  ['never answers', 'hang', 'the fork gave no handoff: the fork did not answer within 3 minutes'],
]

for (const [name, fork, reason] of givingNothing) {
  test(`when the fork ${name}, the handoff fails cleanly: both reasons are said and kept, nothing is cleared`, LIVE, async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { commands: [], fork })
    await reachThreshold($, world)
    if (fork === 'hang') await world.clock.advance(3 * MINUTE)
    const both = `${NO_COMMAND}; ${reason}`
    expect(host.steps).toEqual([])
    expect(seen.logs).toEqual([DUE, fellBack(NO_COMMAND), failure(both)])
    expect(host.store.get('failure')).toEqual({ at: world.clock.now(), sessionId: 'old', stage: 'fork', reason: both })
    expect(host.store.has('pending:old')).toBe(false)
  })
}

test('a fork that gave nothing is not asked again, and the minimum gap holds the next handoff back until it has passed', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [] })
  await reachThreshold($, world)
  await stop($)
  await world.clock.settle()
  await world.clock.advance(MINUTE)
  await stop($)
  await world.clock.settle()
  expect(host.forked).toHaveLength(1)
  expect(seen.logs.filter(l => l.includes('postponed'))).toEqual([
    'handoff postponed, the minimum gap since the last attempt has not passed, context 210000 tokens',
  ])
  await world.clock.advance(10 * MINUTE)
  await stop($)
  await world.clock.settle()
  expect(host.forked).toHaveLength(2)
})

test('without the minimum gap a fork that gave nothing is tried again at the next pause, and not before', NO_GAP, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [] })
  await reachThreshold($, world)
  await world.clock.advance(MINUTE)
  expect(host.forked).toHaveLength(1)
  await stop($)
  await world.clock.settle()
  expect(host.forked).toHaveLength(2)
})

test('a fork whose answer comes after the time limit hands nothing over', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], fork: ANSWERED })
  host.during.fork = () => world.clock.sleep(4 * MINUTE)
  await reachThreshold($, world)
  await world.clock.advance(4 * MINUTE)
  expect(host.steps).toEqual([])
  expect(seen.logs.at(-1)).toBe(failure(`${NO_COMMAND}; the fork gave no handoff: the fork did not answer within 3 minutes`))
})

// The prompt of the user's own, if there is one, and the one the mod brings if not.
const withPrompt = (files: Record<string, string>, extra: Partial<Host> = {}) => ({ commands: [], fork: ANSWERED, files, ...extra })

test('the fork is asked with the prompt file under ~/.claude, when there is one', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, withPrompt({ [PROMPT_FILE]: 'Write the handoff in German.\n' }))
  await reachThreshold($, world)
  expect(host.forked).toEqual(['Write the handoff in German.'])
})

const withoutPromptFile: [string, Partial<Host>][] = [
  ['the file is not there', {}],
  ['the file is empty', { files: { [PROMPT_FILE]: ' \n' } }],
  ['the home directory is unknown', { home: undefined, files: { [PROMPT_FILE]: 'x' } }],
  ['the environment cannot be read', { envError: 'denied', files: { [PROMPT_FILE]: 'x' } }],
]

for (const [name, extra] of withoutPromptFile) {
  test(`when ${name}, the fork is asked with the prompt the mod brings`, LIVE, async ($, on) => {
    withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, withPrompt({}, extra))
    await reachThreshold($, world)
    expect(host.forked).toEqual([DEFAULT_PROMPT])
    expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}`])
  })
}

test('typing while the fork works is held and goes into the first message, once', LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], fork: ANSWERED })
  host.during.fork = async () => {
    expect(await typeInto($, 'also fix the lexer')).toEqual({
      drop: 'sweet-spot: a handoff is in progress, your message is held and goes in when it is done',
    })
  }
  await reachThreshold($, world)
  expect(host.steps).toEqual(['run clear', `submit ${HANDOFF}\n\nTyped while the handoff ran:\nalso fix the lexer`])
})

test('a first message that does not reach the fresh session is kept, and redeliver submits it again', LIVE, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], fork: ANSWERED, dropSubmit: 'held' })
  await raiseHandoff($)
  await world.clock.settle()
  expect(seen.logs.at(-1)).toBe(failure('the fresh session did not get the handoff (a hook dropped it: held)'))
  expect(host.store.get('pending:old')).toBe(HANDOFF)
  host.dropSubmit = undefined
  await runRelay($, 'redeliver')
  await world.clock.settle()
  expect(host.steps.filter(s => s.startsWith('submit '))).toEqual([`submit ${HANDOFF}`, `submit ${HANDOFF}`])
  expect(host.store.has('pending:old')).toBe(false)
})
