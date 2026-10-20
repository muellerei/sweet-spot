import { test, expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import { endOfTurn, prepareByCommand, prepareInternally, startOfTurn, type Io } from './relay'
import { freshState } from './state'

// Writing a handoff without handing it over: the text (and the command's file) comes back, and the session is neither cleared nor
// submitted to. The handoff after a long pause writes it at one moment and hands it over at another.

const USAGE = { input_tokens: 3, output_tokens: 900, cache_read_input_tokens: 99_000, cache_creation_input_tokens: 10 }

const ioWith = (over: Partial<Io>, steps: string[]) =>
  ({
    now: async () => 1_000,
    log: () => {},
    tell: () => {},
    home: async () => undefined,
    readFile: async () => {
      throw new Error('no file')
    },
    after: () => ({ cancel: () => {} }),
    run: async (command: string, args?: string) => {
      steps.push(`run ${command}${args === undefined ? '' : ` ${args}`}`)
    },
    submit: async (text: string) => {
      steps.push(`submit ${text}`)
      return {}
    },
    sessionId: async () => 'old',
    keep: async () => {},
    recall: async () => undefined,
    forget: async () => {},
    ...over,
  }) as unknown as Io

test('the internal way written alone gives the handoff, when the model was asked and what it read, and clears and submits nothing', async () => {
  const steps: string[] = []
  const io = ioWith({ modelFork: async () => ({ isAnswered: true, text: 'Goal: ship it.', usage: USAGE }) }, steps)
  const r = await prepareInternally(io)
  expect(r).toEqual({ text: firstMessage('Goal: ship it.'), usage: USAGE, began: 1_000 })
  expect(steps).toEqual([])
})

test('the internal way written alone fails at its own stage when the model gives nothing', async () => {
  const steps: string[] = []
  const io = ioWith({ modelFork: async () => ({ isAnswered: false, reason: 'nothing-to-fork' }) }, steps)
  const r = await prepareInternally(io)
  expect('stage' in r && r.stage).toBe('model-fork')
  expect(steps).toEqual([])
})

test("the command's way written alone gives the handoff and its file once the command's turn ends, and clears and submits nothing", async () => {
  const steps: string[] = []
  const state = freshState()
  const io = ioWith(
    {
      commands: async () => ['handoff'],
      listDir: async () => [{ name: 'handoff-1.md', kind: 'file', mtimeMs: 2_000, size: 20 }],
      readFile: async () => 'Goal: ship it.',
    },
    steps,
  )
  const pending = prepareByCommand(io, state, 'handoff')
  // The command runs after the list and the clock are read: a few turns of the queue.
  for (let i = 0; i < 10; i++) await Promise.resolve()
  startOfTurn(state, 't1')
  endOfTurn(state, { turnId: 't1', answer: 'HANDOFF_PATH: /tmp/handoff-1.md', reason: 'answer' })
  const r = await pending
  expect(r).toEqual({ text: firstMessage('Goal: ship it.'), file: '/tmp/handoff-1.md' })
  expect(steps).toEqual([`run handoff ${ASK_FOR_PATH}`])
})
