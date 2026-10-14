import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH, firstMessage } from './handoff'
import { HOUR_TRANSCRIPT, LIVE_IDLE, T, answer, idleLines, idleSession, step } from './idle-support'
import {
  endTurn,
  FILE,
  MINUTE,
  modTest,
  NOTES,
  REJECTED_BY_USER,
  reachThreshold,
  sessionWith,
  hostWith,
  LIVE,
  startTurn,
  typeInto,
  withMod,
  type TestEngine,
} from './test-support'

// The handoff after a long pause written by the person's own command: its turn is added to the session, nothing else changes, and a command
// that gives no handoff leaves the writing to the mod unless the fallback is none. A permission the command asks for while nobody is there
// is turned down at once.

const COMMAND = { options: { dry_run: false, handoff_method: 'external-command', handoff_command: 'handoff' } }
const RUN = `run handoff ${ASK_FOR_PATH}`
const BACK = 'hello again'
const NO_COMMAND = 'the command "handoff" does not exist'

const permission = ($: TestEngine, extra: object = {}) =>
  $.classic.PermissionRequest({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'touch /var/T/x' }, ...extra } as never)

// The turn the command started at minute 55: one request, then the answer.
const commandTurn = async ($: TestEngine, answerText: string, during: () => Promise<unknown> = async () => undefined) => {
  await startTurn($, 'c1')
  await step($, 'c1')
  await during()
  await endTurn($, 'answer', { turnId: 'c1', answer: answerText })
}

modTest('the command writes the handoff in a turn of its own, which ends no pause and plans nothing', COMMAND, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: HOUR_TRANSCRIPT, [FILE]: NOTES } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN])
  await commandTurn($, `HANDOFF_PATH: ${FILE}`)
  await world.clock.settle()
  expect(host.modelForkPrompts).toEqual([])
  expect(idleLines(seen.logs).filter(l => l.includes('planned in'))).toHaveLength(1)
  expect(idleLines(seen.logs)).toContain(`info: idle: handoff prepared, ${firstMessage(NOTES).length} characters`)
  // The handoff written is still there an hour later, and goes with the message that comes back.
  await world.clock.advance(65 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}\n\nThe person's next message:\n${BACK}`])
})

modTest("the command's request reads the cache: the touch moves to its start", COMMAND, async ($, on) => {
  const { world, host } = idleSession(on, { files: { [T]: HOUR_TRANSCRIPT, [FILE]: NOTES } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  await world.clock.advance(MINUTE)
  expect(host.steps).toEqual([RUN])
  await commandTurn($, `HANDOFF_PATH: ${FILE}`)
  await world.clock.settle()
  // 59 minutes after the command's request, 115 after the person's: warm.
  await world.clock.advance(59 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(host.steps).toEqual([RUN, `submit ${BACK}`])
})

for (const fallback of ['internal-handoff', 'builtin-compact']) {
  modTest(
    `a command that gives no handoff leaves the writing to the mod, with the fallback ${fallback} too`,
    { options: { ...COMMAND.options, handoff_fallback: fallback } },
    async ($, on) => {
      const { seen, world, host } = idleSession(on, { commands: [] })
      await answer($)
      await world.clock.advance(55 * MINUTE)
      expect(host.modelForkPrompts).toHaveLength(1)
      expect(host.steps).toEqual([])
      expect(seen.toasts).toEqual([])
      expect(idleLines(seen.logs)).toContain('warn: idle: the command gave no handoff (stage command), the mod writes it')
      expect(idleLines(seen.logs)).toContain('info: idle: handoff prepared, 100 characters')
    },
  )
}

modTest(
  'with the fallback none a command that gives no handoff is said once, and nothing else is tried',
  { options: { ...COMMAND.options, handoff_fallback: 'none' } },
  async ($, on) => {
    const { seen, world, host } = idleSession(on, { commands: [] })
    await answer($)
    await world.clock.advance(55 * MINUTE)
    expect(host.modelForkPrompts).toEqual([])
    expect(seen.toasts).toEqual([`could not prepare the idle handoff (${NO_COMMAND}), the session goes on as is`])
  },
)

modTest('a failing command and a failing mod give both reasons', COMMAND, async ($, on) => {
  const { seen, world } = idleSession(on, { commands: [], modelFork: { isAnswered: false, reason: 'nothing-to-fork' } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(seen.toasts).toEqual([
    `could not prepare the idle handoff (${NO_COMMAND}; the mod could not write the handoff: there is no conversation yet to write a handoff from), the session goes on as is`,
  ])
})

for (const [method, fallback] of [
  ['internal-handoff', 'external-command'],
  ['builtin-compact', 'external-command'],
] as const) {
  modTest(
    `with ${method} first the mod writes the handoff, and the fallback ${fallback} is not tried`,
    { options: { dry_run: false, handoff_method: method, handoff_fallback: fallback, handoff_command: 'handoff' } },
    async ($, on) => {
      const { seen, world, host } = idleSession(on, { modelFork: { isAnswered: false, reason: 'nothing-to-fork' } })
      await answer($)
      await world.clock.advance(55 * MINUTE)
      expect(host.modelForkPrompts).toHaveLength(1)
      expect(host.steps).toEqual([])
      expect(seen.toasts).toHaveLength(1)
    },
  )
}

modTest("a command's turn ended with Esc gives no handoff, and the mod writes it", COMMAND, async ($, on) => {
  const { seen, world, host } = idleSession(on)
  await answer($)
  await world.clock.advance(55 * MINUTE)
  await startTurn($, 'c1')
  await step($, 'c1')
  await endTurn($, 'aborted', { turnId: 'c1' })
  await world.clock.settle()
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(seen.toasts).toEqual([])
  expect(idleLines(seen.logs).filter(l => l.startsWith('warn:'))).toEqual(['warn: idle: the command gave no handoff (stage cancelled), the mod writes it'])
})

modTest("a permission the command's turn asks for is turned down at once, and the mod writes the handoff", COMMAND, async ($, on) => {
  const { seen, world, host } = idleSession(on, { toolResults: [REJECTED_BY_USER] })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  let asked: unknown
  await commandTurn($, '', async () => {
    asked = await permission($)
    await $.tool.call({ tool: 'Bash', command: 'touch /var/T/x', description: 'make the file', tool_use_id: 'u1' } as never)
  })
  await world.clock.settle()
  expect(asked).toEqual({ decision: { behavior: 'deny', interrupt: true } })
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(seen.toasts).toEqual([])
  expect(idleLines(seen.logs)).toContain('debug: idle: a permission for Bash was turned down while the handoff is written')
  expect(idleLines(seen.logs)).toContain('warn: idle: the command gave no handoff (stage cancelled), the mod writes it')
  expect(seen.logs.filter(l => l.includes('touch'))).toEqual([])
})

modTest('a permission asked outside the writing goes to the person as it is', LIVE_IDLE, async ($, on) => {
  const { world } = idleSession(on)
  await answer($)
  expect(await permission($)).toEqual({})
  await world.clock.advance(55 * MINUTE)
  expect(await permission($)).toEqual({})
})

modTest("a permission in the command's turn at the threshold goes to the person as it is", LIVE, async ($, on) => {
  withMod(on)
  const world = sessionWith(on)
  hostWith(on)
  await reachThreshold($, world)
  await startTurn($, 't2')
  expect(await permission($)).toEqual({})
})

modTest('a permission asked while the model writes the handoff is no turn of the mod: it goes to the person as it is', LIVE_IDLE, async ($, on) => {
  const { world, host } = idleSession(on)
  await answer($)
  let asked: unknown
  host.during['model.fork'] = async () => {
    await startTurn($, 't2')
    asked = await permission($)
  }
  await world.clock.advance(55 * MINUTE)
  expect(asked).toEqual({})
})

modTest("a subagent's permission while the handoff is written goes to the person as it is", COMMAND, async ($, on) => {
  const { world } = idleSession(on)
  await answer($)
  await world.clock.advance(55 * MINUTE)
  expect(await permission($, { agent_id: 'a1' })).toEqual({})
})

modTest("a switch whose submit fails names the command's file, where the handoff still is", COMMAND, async ($, on) => {
  const { seen, world, host } = idleSession(on, { files: { [T]: HOUR_TRANSCRIPT, [FILE]: NOTES } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  await world.clock.settle()
  await commandTurn($, `HANDOFF_PATH: ${FILE}`)
  await world.clock.settle()
  host.rejectSubmit = true
  await world.clock.advance(65 * MINUTE)
  await typeInto($, BACK)
  await world.clock.settle()
  expect(seen.toasts).toHaveLength(1)
  expect(seen.toasts[0]).toEndWith(`; it is in ${FILE}`)
})

modTest("once the handoff written is no longer believed to keep the cache, the command's request does not move the touch", COMMAND, async ($, on) => {
  const { world, host, requests } = idleSession(on, { files: { [T]: HOUR_TRANSCRIPT, [FILE]: NOTES } })
  await answer($)
  await world.clock.advance(55 * MINUTE)
  await world.clock.settle()
  await commandTurn($, `HANDOFF_PATH: ${FILE}`)
  await world.clock.settle()
  // Back at minute 85, warm; the request of that turn misses the cache.
  await world.clock.advance(30 * MINUTE)
  await typeInto($, BACK)
  requests.usage = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 1_000, cache_creation_input_tokens: 119_000 }
  await answer($, 't2', {}, false)
  await world.clock.advance(55 * MINUTE)
  await world.clock.settle()
  await commandTurn($, `HANDOFF_PATH: ${FILE}`)
  await world.clock.settle()
  await world.clock.advance(6 * MINUTE)
  await typeInto($, 'and now')
  await world.clock.settle()
  expect(host.steps).toContain('run clear')
})
