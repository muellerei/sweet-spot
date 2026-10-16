import { expect } from 'claude-code/testing'

import {
  endTurn,
  hostWith,
  modelForkAnswer,
  modTest,
  reachThreshold,
  sessionWith,
  startSession,
  startTurn,
  stop,
  withMod,
  type TestEngine,
  type TestOn,
} from './test-support'

// What the handoff after a long pause needs to know of a session before it can plan: how long the prompt cache lives, read from the
// transcript, and the baseline, what a fresh session of the project sends with its first message. Both are read at the end of the first
// turn of every session, whether it began with the mod's load, a /clear or a resume, and the transcript again at each turn while it
// holds no answer yet.

const T = '/home/me/.claude/projects/work/s1.jsonl'
const T2 = '/home/me/.claude/projects/work/s2.jsonl'

const entry = (fiveMinutes: number, oneHour: number, read = 40_000) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      usage: {
        input_tokens: 3,
        cache_read_input_tokens: read,
        cache_creation_input_tokens: fiveMinutes + oneHour,
        cache_creation: { ephemeral_5m_input_tokens: fiveMinutes, ephemeral_1h_input_tokens: oneHour },
      },
    },
  })

const HOUR = [entry(0, 20_000, 31_000), entry(0, 900)].join('\n')
const FIVE = [entry(20_000, 0), entry(400, 0)].join('\n')
const FIRST = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 20_000 }

// The answer of each model request, as the turn's steps report it; `null` for one with no answer.
const answersSteps = (on: TestOn) => {
  const usage: { next: Record<string, number> | null } = { next: FIRST }
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: usage.next } as never
  })
  return usage
}

const step = async ($: TestEngine, turnId: string, index = 0, agentId?: string) => {
  const s = $.turn.step({ turnId, index, model: 'claude', messageCount: 1, ...(agentId === undefined ? {} : { agentId }) })
  for await (const _ of s);
  return s.result
}

// A whole first turn of a session as the host raises it: the session starts, the turn makes one request, the stop comes before the end.
const firstTurn = async ($: TestEngine, path = T, source: 'startup' | 'clear' | 'resume' = 'startup', turnId = 't1') => {
  if (source === 'startup') await startSession($)
  await $.classic.SessionStart({ source, transcript_path: path })
  await startTurn($, turnId)
  await step($, turnId)
  await stop($, { transcript_path: path } as never)
  await endTurn($, 'answer', { turnId })
}

// A later turn of the same session, ending in an answer.
const laterTurn = async ($: TestEngine, turnId: string) => {
  await startTurn($, turnId)
  await step($, turnId)
  await stop($, { transcript_path: T } as never)
  await endTurn($, 'answer', { turnId })
}

const idleLines = (lines: string[]) => lines.filter(l => l.includes('idle:'))

modTest('a fresh session knows the cache lifetime from its transcript and keeps the baseline of its first request for the project', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { logLevel: 'debug', files: { [T]: HOUR } })
  answersSteps(on)
  await firstTurn($)
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline 51003 tokens')
  expect((host.store.get('idle-baseline:/work') as { tokens: number }).tokens).toBe(51_003)
  expect(host.runs).toEqual([])
})

modTest('a transcript above 4 MiB is read at its end only, through tail, and no other process runs', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { logLevel: 'debug', files: { [T]: 'too large to read' }, sizes: { [T]: 4_194_305 }, tails: { [T]: `cut line"}\n${FIVE}` } })
  answersSteps(on)
  await firstTurn($)
  expect(host.runs).toEqual([['tail', '-c', '262144', T]])
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 5m, baseline 51003 tokens')
})

modTest('without tail the lifetime stays unknown, and that is said once a session', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  hostWith(on, { logLevel: 'debug', files: { [T]: 'too large' }, sizes: { [T]: 5_000_000 } })
  answersSteps(on)
  await firstTurn($)
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime unknown, baseline 51003 tokens')
  expect(seen.logs.filter(l => l === 'warn: idle: the transcript could not be read')).toHaveLength(1)
})

// What the next turn would read says the same: a transcript that could not be read, and one whose answers wrote nothing to the cache
// (prompt caching off). Neither is read again, and no process starts at every turn.
for (const [name, files, sizes] of [
  ['that cannot be read', { [T]: 'too large' }, { [T]: 5_000_000 }],
  ['whose answers wrote nothing', { [T]: [entry(0, 0), entry(0, 0)].join('\n') }, {}],
] as const) {
  modTest(`a transcript ${name} is read once a session`, async ($, on) => {
    const seen = withMod(on)
    sessionWith(on, { tokens: 60_000 })
    const host = hostWith(on, { logLevel: 'debug', files, sizes })
    answersSteps(on)
    await firstTurn($)
    const runs = host.runs.length
    await laterTurn($, 't2')
    expect(idleLines(seen.logs).filter(l => l.startsWith('debug: idle: cache lifetime'))).toHaveLength(1)
    expect(host.runs).toHaveLength(runs)
    expect(seen.logs.filter(l => l === 'warn: idle: the transcript could not be read')).toHaveLength(name === 'that cannot be read' ? 1 : 0)
  })
}

// At the end of the first turn of a fresh session the transcript can hold no answer yet (docs/host-behaviour.md, "the transcript can still
// lack the turn's answer"). The next turn reads again.
modTest('a first turn whose transcript holds no answer yet leaves the lifetime to the next turn, which reads again', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { logLevel: 'debug', files: { [T]: '' } })
  answersSteps(on)
  await firstTurn($)
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime unknown, baseline 51003 tokens')
  host.files[T] = HOUR
  await laterTurn($, 't2')
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline 51003 tokens')
  // Once known, the next turn reads nothing.
  await laterTurn($, 't3')
  expect(idleLines(seen.logs).filter(l => l.startsWith('debug: idle: cache lifetime'))).toHaveLength(2)
})

modTest('after /clear the first turn of the fresh session reads again', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  hostWith(on, { logLevel: 'debug', files: { [T]: HOUR, [T2]: FIVE } })
  answersSteps(on)
  await firstTurn($)
  // A second turn of the same session reads nothing.
  await laterTurn($, 't2')
  expect(idleLines(seen.logs).filter(l => l.startsWith('debug: idle: cache lifetime'))).toHaveLength(1)
  await $.session.end({ sessionId: 'old', reason: 'clear' } as never)
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await firstTurn($, T2, 'clear', 't3')
  expect(idleLines(seen.logs).filter(l => l.startsWith('debug: idle: cache lifetime'))).toEqual([
    'debug: idle: cache lifetime 1h, baseline 51003 tokens',
    'debug: idle: cache lifetime 5m, baseline 51003 tokens',
  ])
})

modTest("the fresh session a handoff of the mod began does not change the project's baseline", { options: { dry_run: false } }, async ($, on) => {
  withMod(on)
  const world = sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { commands: [], modelFork: modelForkAnswer('notes'), files: { [T]: HOUR, [T2]: HOUR } })
  const usage = answersSteps(on)
  await startSession($)
  await $.classic.SessionStart({ source: 'startup', transcript_path: T })
  await startTurn($, 't0')
  await step($, 't0')
  await stop($, { transcript_path: T } as never)
  await endTurn($, 'answer', { turnId: 't0' })
  expect((host.store.get('idle-baseline:/work') as { tokens: number }).tokens).toBe(51_003)
  world.tokens = 210_000
  await reachThreshold($, world)
  expect(host.sessionId).toBe('new')
  // The handoff is the first message of the fresh session: its request is large, and is not what the project starts with.
  usage.next = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 60_000 }
  await firstTurn($, T2, 'clear', 't9')
  expect((host.store.get('idle-baseline:/work') as { tokens: number }).tokens).toBe(51_003)
})

modTest('a resumed session takes the baseline kept for its project, and without one the first request in its transcript', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { logLevel: 'debug', files: { [T]: HOUR } })
  answersSteps(on)
  await startSession($)
  await firstTurn($, T, 'resume')
  // The first request of the transcript: 3 + 31 000 read + 20 000 written.
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline 51003 tokens')
  expect(host.store.has('idle-baseline:/work')).toBe(false)
})

modTest('a resumed session prefers the kept baseline to its transcript', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  hostWith(on, { logLevel: 'debug', files: { [T]: HOUR }, store: new Map([['idle-baseline:/work', { tokens: 62_000, at: 0 }]]) })
  answersSteps(on)
  await startSession($)
  await firstTurn($, T, 'resume')
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline 62000 tokens')
})

modTest("a subagent's request and a request with no answer keep no baseline", async ($, on) => {
  withMod(on)
  sessionWith(on, { tokens: 60_000 })
  const host = hostWith(on, { logLevel: 'debug', files: { [T]: HOUR } })
  const usage = answersSteps(on)
  await startSession($)
  await $.classic.SessionStart({ source: 'startup', transcript_path: T })
  await startTurn($, 't1')
  await step($, 't1', 0, 'agent-1')
  usage.next = null
  await step($, 't1', 0)
  await stop($, { transcript_path: T } as never)
  await endTurn($, 'answer', { turnId: 't1' })
  expect(host.store.has('idle-baseline:/work')).toBe(false)
})

modTest('a change of model sets the cache lifetime it names, and a later read with no write in it keeps it', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  hostWith(on, { logLevel: 'debug', files: { [T]: '' } })
  answersSteps(on)
  await startSession($)
  await $.classic.PostModelSwitch({
    from_model: 'a',
    to_model: 'b',
    requested_model: null,
    source: 'command',
    context_tokens: 1,
    prompt_cache_warm: true,
    cache_ttl: '1h',
  } as never)
  await firstTurn($, T, 'resume')
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline unknown')
})

modTest('after a reload, with no session start, a first turn whose end comes before its stop still reads', async ($, on) => {
  const seen = withMod(on)
  sessionWith(on, { tokens: 60_000 })
  hostWith(on, { logLevel: 'debug', files: { [T]: HOUR } })
  answersSteps(on)
  await $.classic.UserPromptSubmit({ prompt: 'go on', transcript_path: T } as never)
  await startTurn($, 't1')
  await step($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($, { transcript_path: T } as never)
  expect(idleLines(seen.logs)).toContain('debug: idle: cache lifetime 1h, baseline 51003 tokens')
})
