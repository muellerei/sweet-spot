import { expect } from 'claude-code/testing'

import { ASK_FOR_PATH, DEFAULT_PROMPT, firstMessage } from './handoff'
import {
  commandTurnEnds,
  DUE,
  failure,
  fellBack,
  fellBackToCommand,
  FILE,
  HANDED,
  hostWith,
  NOTES,
  reachThreshold,
  sessionWith,
  withMod,
  methods,
  ANSWERED,
  modTest,
} from './test-support'

// The main method and the fallback, as the two settings choose them. The tests use the settings, not the names inside the mod.

const RUN = `run handoff ${ASK_FOR_PATH}`
const NO_COMMAND = 'the command "handoff" does not exist'
const MOD_GAVE_NOTHING = 'the mod could not write the handoff: there is no conversation yet to write a handoff from'
const FALLBACK_NEEDS_CLEAR = '/clear failed (no implementation for command.run), the session is as it was; the fallback needs /clear too'

modTest(
  'the main method internal-handoff alone writes the handoff, and the command that is set does not run',
  methods('internal-handoff', 'none'),
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { modelFork: ANSWERED })
    await reachThreshold($, world)
    expect(host.steps).toEqual(['run clear', `submit ${firstMessage(ANSWERED.text)}`])
    expect(host.modelForkPrompts).toEqual([DEFAULT_PROMPT])
    expect(seen.logs).toEqual([DUE, HANDED])
  },
)

modTest(
  'the main method external-command with no fallback says why it failed, and the mod does not write one',
  methods('external-command', 'none'),
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { commands: [], modelFork: ANSWERED })
    await reachThreshold($, world)
    expect(host.steps).toEqual([])
    expect(host.modelForkPrompts).toEqual([])
    expect(seen.logs).toEqual([DUE, failure(NO_COMMAND)])
  },
)

modTest(
  'the main method internal-handoff, failing, hands over to the command as the fallback and says why',
  methods('internal-handoff', 'external-command'),
  async ($, on) => {
    const seen = withMod(on)
    const world = sessionWith(on)
    const host = hostWith(on, { files: { [FILE]: NOTES } })
    await reachThreshold($, world)
    expect(host.steps).toEqual([RUN])
    await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
    expect(host.steps).toEqual([RUN, 'run clear', `submit ${firstMessage(NOTES)}`])
    expect(seen.logs).toEqual([DUE, fellBackToCommand(MOD_GAVE_NOTHING), HANDED])
  },
)

modTest('both ways failing: both reasons are said, the first one first', methods('internal-handoff', 'external-command'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [] })
  await reachThreshold($, world)
  expect(host.steps).toEqual([])
  expect(seen.logs).toEqual([DUE, fellBackToCommand(MOD_GAVE_NOTHING), failure(`${MOD_GAVE_NOTHING}; ${NO_COMMAND}`)])
})

modTest('the same value in both settings is no fallback: the way is tried once', methods('internal-handoff', 'internal-handoff'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on)
  await reachThreshold($, world)
  expect(host.modelForkPrompts).toHaveLength(1)
  expect(host.steps).toEqual([])
  expect(seen.logs).toEqual([DUE, failure(MOD_GAVE_NOTHING)])
})

// `/clear` failed before it changed anything, but the fallback would need it too: the second try is skipped, and the reason says so.
modTest('after /clear failed, a fallback that needs /clear too is not tried', methods('external-command', 'internal-handoff'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { [FILE]: NOTES }, failRun: ['clear'], modelFork: ANSWERED })
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  expect(host.steps).toEqual([RUN, 'run clear'])
  expect(host.modelForkPrompts).toEqual([])
  expect(seen.logs).toEqual([DUE, failure(FALLBACK_NEEDS_CLEAR)])
})

modTest('a fallback that fails at /clear adds its reason to the first one', methods('external-command', 'internal-handoff'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], modelFork: ANSWERED, failRun: ['clear'] })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['run clear'])
  expect(seen.logs).toEqual([DUE, fellBack(NO_COMMAND), failure(`${NO_COMMAND}; /clear failed (no implementation for command.run), the session is as it was`)])
})

modTest('a fallback that fails at the submit says its own reason only', methods('external-command', 'internal-handoff'), async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], modelFork: ANSWERED, rejectSubmit: true })
  await reachThreshold($, world)
  expect(host.steps).toEqual(['run clear', `submit ${firstMessage(ANSWERED.text)}`])
  expect(seen.logs[1]).toBe(fellBack(NO_COMMAND))
  expect(seen.logs[2]).toMatch(/^handover failed, the fresh session did not get the handoff/)
  expect(seen.logs[2]).not.toContain(NO_COMMAND)
})
