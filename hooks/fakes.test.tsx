import type { Register } from 'claude-code'
import { expect } from 'claude-code/testing'

import { compactByHand, hostWith, modTest, runRelay, sessionWith, startSession, startTurn, withMod, COMPACT_DONE } from './test-support'

// What the host beneath the mod refuses, pinned, so that a test about a call the host refuses cannot pass because the floor let it through.
// Inside a `command.run` hook the host refuses a command and a compact (measured, see host-behaviour.md); the engine refuses them too, so
// the fakes need not. Should a later engine stop doing it, these tests fall and the fakes take it over. A plugin above the mod makes the
// calls, inside the hook of the mod's command or at the start of a turn, and says in a toast what came of each. The engine loads it as a
// module of its own that shares nothing with the test, and `$` is spelled out at each call, so the two hooks repeat themselves.
const register: Register = on => {
  on('command.run', async ($, e, next) => {
    // The calls raise `command.run` themselves; only the mod's command is probed.
    if (e.command !== 'sweet-spot') return next(e)
    try {
      await $.command.run({ command: 'clear' })
      $.ui.toast('run clear: ran')
    } catch (error) {
      $.ui.toast(`run clear: ${String(error)}`)
    }
    try {
      await $.session.compact()
      $.ui.toast('compact: ran')
    } catch (error) {
      $.ui.toast(`compact: ${String(error)}`)
    }
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    try {
      await $.command.run({ command: 'clear' })
      $.ui.toast('run clear: ran')
    } catch (error) {
      $.ui.toast(`run clear: ${String(error)}`)
    }
    try {
      await $.session.compact()
      $.ui.toast('compact: ran')
    } catch (error) {
      $.ui.toast(`compact: ${String(error)}`)
    }
    return next(e)
  })
}
const PROBE = { plugins: [{ name: 'probe', tier: 'prepend' as const, register }] }
const outcomes = (toasts: string[]) => toasts.map(t => t.replace(/: .*called from a command\.run hook.*/, ': refused from the hook'))

modTest('inside the hook of the mod command, the engine refuses a command and a compact as the host does', PROBE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await runRelay($, 'redeliver')
  expect(outcomes(seen.toasts)).toEqual(['run clear: refused from the hook', 'compact: refused from the hook'])
  expect(host.steps).toEqual([])
})

modTest('outside that hook the same calls run', PROBE, async ($, on) => {
  const seen = withMod(on)
  sessionWith(on)
  const host = hostWith(on, { compact: COMPACT_DONE })
  await startSession($)
  await startTurn($)
  expect(outcomes(seen.toasts)).toEqual(['run clear: ran', 'compact: ran'])
  expect(host.steps).toEqual(['run clear', 'compact'])
})

modTest('a compact by hand is the step compact manual and answers with a compaction unless the test sets another answer', async ($, on) => {
  withMod(on)
  sessionWith(on)
  const host = hostWith(on)
  await startSession($)
  expect(await compactByHand($)).toEqual(COMPACT_DONE)
  host.manualCompact = { skip: 'held by another hook' }
  expect(await compactByHand($)).toEqual({ skip: 'held by another hook' })
  expect(host.steps).toEqual(['compact manual', 'compact manual'])
})

// A plugin above the mod that reads what the countdown will read and sets a status line, at the start of a turn.
const reader: Register = on => {
  on('turn.start', async ($, e, next) => {
    const surfaces = await $.session.surfaces()
    const agents = await $.agent.list()
    const prompt = await $.prompt.read()
    $.ui.toast(`surfaces ${surfaces.join(' ')}, agents ${agents.length}, prompt "${prompt.text}" at ${prompt.cursor}`)
    $.ui.status('waiting')
    $.ui.status(undefined)
    return next(e)
  })
}
const READER = { plugins: [{ name: 'reader', tier: 'prepend' as const, register: reader }] }

modTest('the session answers where it draws and what the prompt holds, and a read can be held up by what happens meanwhile', READER, async ($, on) => {
  const seen = withMod(on)
  const world = sessionWith(on, { surfaces: ['vscode'], draft: 'half a thought', agents: [{ status: 'running' }] })
  hostWith(on)
  world.during['agent.list'] = async () => void (world.agents = [])
  world.during['prompt.read'] = async () => void (world.draft = 'half a thought, and more')
  await startSession($)
  await startTurn($)
  expect(seen.toasts).toEqual(['surfaces vscode, agents 0, prompt "half a thought, and more" at 24'])
  expect(seen.status).toEqual(['waiting', undefined])
  expect(world.reads).toEqual(['surfaces', 'prompt'])
})
