import { test, expect } from 'claude-code/testing'

import {
  commandTurnEnds,
  endTurn,
  forkAnswer,
  hostWith,
  reachThreshold,
  sessionWith,
  startSession,
  startTurn,
  stop,
  withMod,
  LIVE,
  type TestOn,
} from './test-support'

// Listens beneath each call that would leave the session, and lists the ones that were made.
const listenForOutside = (on: TestOn) => {
  const calls: string[] = []
  for (const name of ['http.fetch', 'process.run', 'fs.write'] as const) {
    on(name, async () => {
      calls.push(name)
      return { value: undefined } as never
    })
  }
  on('process.spawn', async function* () {
    calls.push('process.spawn')
    throw new Error('process.spawn must not be called')
  })
  return calls
}

// Nothing leaves the machine, no process starts, nothing is written: the floor beneath each of those answers and keeps count.
test('a session through every outcome of a stop calls neither http nor a process, and writes nothing', async ($, on) => {
  const calls = listenForOutside(on)
  const seen = withMod(on)
  const world = sessionWith(on)
  await startSession($)
  await startTurn($)
  await endTurn($)
  await stop($)
  await stop($, { background_tasks: [{ status: 'running' }] })
  world.tokens = undefined
  await stop($)
  await startTurn($)
  await endTurn($, 'aborted')
  await stop($)
  await stop($, { agent_id: 'a1' } as never)
  expect(seen.logs.length).toBeGreaterThan(0)
  expect(calls).toEqual([])
})

// The command is the user's to write with; the mod asks it for the path of its file and for nothing else.
test('a handoff through the command calls neither http nor a process, writes nothing, and asks the command for nothing to be written', LIVE, async ($, on) => {
  const calls = listenForOutside(on)
  const seen = withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { files: { '/tmp/handoff-1.md': 'notes' } })
  await reachThreshold($, world)
  await commandTurnEnds($, world, 'HANDOFF_PATH: /tmp/handoff-1.md')
  expect(host.steps).toHaveLength(3)
  expect(host.steps[0]).not.toMatch(/writ|creat|sav|edit/i)
  expect(seen.logs).toHaveLength(2)
  expect(calls).toEqual([])
})

// The fork is the model's to run, and its answer is submitted: nothing else leaves the session, and the prompt file is only read.
test('a handoff through a fork calls neither http nor a process, and writes nothing', { options: { dry_run: false } }, async ($, on) => {
  const calls = listenForOutside(on)
  withMod(on)
  const world = sessionWith(on)
  const host = hostWith(on, { commands: [], fork: forkAnswer('notes') })
  await reachThreshold($, world)
  expect(host.steps).toHaveLength(2)
  expect(calls).toEqual([])
})
