// What the tests of the handoff after a long pause share: a session with an hour of cache above the lower bound, and its answers.

import {
  editPrompt,
  endTurn,
  hostWith,
  modelForkAnswer,
  sessionWith,
  startSession,
  startTurn,
  stop,
  withMod,
  type SessionWorld,
  type TestEngine,
  type TestOn,
} from './test-support'

export const T = '/home/me/.claude/projects/work/s1.jsonl'

const entry = (fiveMinutes: number, oneHour: number) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: false,
    message: {
      usage: {
        input_tokens: 3,
        cache_read_input_tokens: 31_000,
        cache_creation_input_tokens: fiveMinutes + oneHour,
        cache_creation: { ephemeral_5m_input_tokens: fiveMinutes, ephemeral_1h_input_tokens: oneHour },
      },
    },
  })

// A compact as Claude Code marks it in the transcript; only the fields the mod reads are kept.
export const compactMark = (timestamp: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'system', subtype: 'compact_boundary', isSidechain: false, timestamp, ...extra })

export const HOUR_TRANSCRIPT = [entry(0, 20_000), entry(0, 900)].join('\n')
export const FIVE_TRANSCRIPT = [entry(20_000, 0)].join('\n')
// The first request of the session: 51003 tokens, so the lower bound is 81003.
export const FIRST = { input_tokens: 3, output_tokens: 600, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 20_000 }

// What each request reads and writes, as its step reports it; a test sets another, or `null` for a request with no answer. Given the world
// and with `contextAfter` set, the step moves the context to it while it runs (`undefined` for none reported), as the host does: before the
// step the context is the previous one's.
export const answersSteps = (on: TestOn, world?: SessionWorld) => {
  const requests: { usage: Record<string, number> | null; contextAfter?: number | undefined } = { usage: FIRST }
  on('turn.step', async function* (_, e) {
    if (world !== undefined && 'contextAfter' in requests) world.tokens = requests.contextAfter
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: requests.usage } as never
  })
  return requests
}

export const step = async ($: TestEngine, turnId: string) => {
  const s = $.turn.step({ turnId, index: 0, model: 'claude', messageCount: 1 })
  for await (const _ of s);
}

// A session whose first answer ends at 120000 tokens with an hour of cache: above the lower bound, below the threshold.
export const idleSession = (
  on: TestOn,
  host: Parameters<typeof hostWith>[1] = {},
  world: Parameters<typeof sessionWith>[1] = {},
  below?: Parameters<typeof withMod>[1],
) => {
  const seen = withMod(on, below)
  const w = sessionWith(on, { tokens: 120_000, ...world })
  const h = hostWith(on, { logLevel: 'debug', files: { [T]: HOUR_TRANSCRIPT }, modelFork: modelForkAnswer('goal: finish the parser'), ...host })
  const requests = answersSteps(on, w)
  return { seen, world: w, host: h, requests }
}

export const answer = async ($: TestEngine, turnId = 't1', stopInput: object = {}, first = true) => {
  if (first) {
    await startSession($)
    await $.classic.SessionStart({ source: 'startup', transcript_path: T })
  }
  await startTurn($, turnId)
  await step($, turnId)
  await stop($, { transcript_path: T, ...stopInput } as never)
  await endTurn($, 'answer', { turnId })
}

// One key typed into an empty prompt, as the host raises it.
export const typeKey = ($: TestEngine, key: string) =>
  editPrompt($, {
    origin: { kind: 'composer' },
    text: '',
    cursor: 0,
    start: 0,
    end: 0,
    inputText: key,
    key: { key },
  })

export const idleLines = (lines: string[]) => lines.filter(l => l.includes('idle:') && !l.startsWith('debug: idle: cache lifetime'))

export const LIVE_IDLE = { options: { dry_run: false } }

// What the band says once the handoff written has gone cold.
export const COLD = 'the cache has expired, your next message starts a fresh session with a handoff (/sweet-spot later to stay here)'

// The band above the prompt, mounted as the host mounts it.
const bandProps = (hasSurvey = false) => ({ hasSurvey, isWorking: false, maxRows: 10, bodyColumns: 200, scroll: { offset: 0, bodyRows: 10 }, view: {} })

export const band = ($: TestEngine) => $.ui.mount({ plugin: 'sweet-spot', surface: 'terminal', component: 'AbovePrompt', props: bandProps() })

// What the band shows once the host draws it again; nothing when the mod draws none.
export const shown = async (ui: Awaited<ReturnType<typeof band>>, hasSurvey = false): Promise<string | undefined> => {
  await ui.redraw(bandProps(hasSurvey))
  return (await ui.find({ type: 'Text' }))?.text
}

// A change of model of the main loop, to one with an hour of cache.
export const modelSwitch = ($: TestEngine) =>
  $.classic.PostModelSwitch({
    from_model: 'a',
    to_model: 'b',
    requested_model: null,
    source: 'command',
    context_tokens: 1,
    prompt_cache_warm: true,
    cache_ttl: '1h',
  } as never)
