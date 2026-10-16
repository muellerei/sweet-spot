// What the tests share: the floor beneath the mod's calls and the questions a test asks of it.

import { mock, test, type TestBody, type TestOptions, type TestRest } from 'claude-code/testing'
import type { TaskSummary, TurnEnd } from './pairing'

export type TestEngine = Parameters<TestBody>[0]
export type TestOn = Parameters<TestBody>[1]

// A test through the host, with the countdown off unless the test sets it: the tests that are not about the countdown hand over at the pause,
// as they did before there was one. Only the tests that pin the defaults of plugin.json take the engine's own `test`.
export const modTest = (name: string, ...rest: TestRest) => {
  const [options, body]: [TestOptions, TestBody] = rest.length === 1 ? [{}, rest[0]] : [rest[0], rest[1]]
  test(name, { ...options, options: { countdown_seconds: 0, ...options.options } }, body)
}

// The band above the prompt as the host draws it with nothing of the mod's in it: empty.
const EMPTY_BAND = { type: 'Box', props: {}, children: [] }

// The engine's own answer to what the mod shows; the tests read what was said. `below` is what the chain under the mod draws above the
// prompt, another mod's band in a test about sharing that place.
export const withMod = (on: TestOn, below: object = EMPTY_BAND) => {
  const seen = {
    toasts: [] as string[],
    logs: [] as string[],
    debug: [] as string[],
    registered: [] as string[],
    // What the menu shows of each command the mod registered.
    menu: [] as { name: string; description: string; argumentHint: string | undefined; immediate: true | undefined }[],
    refuse: undefined as string | undefined,
    // Each status line the mod set, in order; undefined where it cleared the line.
    status: [] as (string | undefined)[],
  }
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('command.register', async (_, e) => {
    if (seen.refuse !== undefined) return { deny: seen.refuse }
    seen.registered.push(e.name)
    seen.menu.push({ name: e.name, description: e.description, argumentHint: e.argumentHint, immediate: e.immediate })
    return { value: { command: e.name } } as never
  })
  on('ui.toast', async (_, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', async (_, e) => {
    ;(e.to === 'debug' ? seen.debug : seen.logs).push(e.text)
    return { value: undefined }
  })
  on('ui.render', async () => below as never)
  on('ui.status', async (_, e) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  return seen
}

export const startSession = ($: TestEngine) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

export type World = {
  tokens: number | undefined
  window: number
  turns: number
  agents: { status: string }[]
  // The account's rate-limit windows as the host reports them; empty off a subscription.
  rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[]
  reads: string[]
  // What a hook beneath the mod answers a stop with: a reason to go on.
  block: string | undefined
  // A reason the session cannot be read with at a stop.
  usageError: string | undefined
  // Where the session draws, as `$.session.surfaces()` answers; the band of the mod shows on `terminal` and `desktop` only.
  surfaces: string[]
  // What the prompt holds, as `$.prompt.read()` answers. A test sets it without `prompt.edit`, as the history, Tab or another mod fill it.
  draft: string
  // Run while a read is under way, for what happens in the middle of one: the step is `usage`, `agent.list`, `surfaces` or `prompt.read`.
  during: Record<string, () => Promise<void>>
  // System sleep: how far the time the mod reads has jumped past the clock in memory, which fires the timers and did not move.
  slept: number
}

// What happens in the middle of a step happens once; a later read of the same kind goes through.
const once = async (h: { during: Record<string, () => Promise<void>> }, step: string) => {
  const act = h.during[step]
  delete h.during[step]
  await act?.()
}

// The session as a test says it: what the mod may read at a stop. `reads` lists the questions asked, for the tests that need to know it asked none.
export const sessionWith = (on: TestOn, world: Partial<World> = {}) => {
  const w: World = {
    tokens: 210_000,
    window: 1_000_000,
    turns: 10,
    agents: [],
    rateLimits: [],
    reads: [],
    block: undefined,
    usageError: undefined,
    surfaces: ['terminal'],
    draft: '',
    during: {},
    slept: 0,
    ...world,
  }
  on('session.usage', async () => {
    await once(w, 'usage')
    w.reads.push('usage')
    if (w.usageError !== undefined) throw new Error(w.usageError)
    return {
      value: { startedAt: 0, rateLimits: w.rateLimits, context: { window: w.window, ...(w.tokens === undefined ? {} : { tokens: w.tokens }) } },
    } as never
  })
  on('session.turns', async () => ({ value: w.turns }))
  on('agent.list', async () => {
    await once(w, 'agent.list')
    return { value: w.agents } as never
  })
  on('session.surfaces', async () => {
    await once(w, 'surfaces')
    w.reads.push('surfaces')
    return { value: w.surfaces } as never
  })
  on('prompt.read', async () => {
    await once(w, 'prompt.read')
    w.reads.push('prompt')
    return { value: { text: w.draft, cursor: w.draft.length } }
  })
  // An edit as the editor makes it: the span from `start` to `end` replaced by what was typed, the cursor after it. `draft` stays what the
  // test set: the key of a band button raises an edit and leaves the prompt empty (docs/host-behaviour.md, Commands).
  on('prompt.edit', async (_, e) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  // A fill as the box takes it: over the draft, after it, or at its end for the cursor, which a test leaves there.
  on('prompt.fill', async (_, e) => {
    w.draft = e.mode === 'replace' ? e.text : w.draft + e.text
    return { isFilled: true } as never
  })
  // The end of the session (exit, /clear, resume), which the host echoes.
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }))
  on('classic.Stop', async () => (w.block === undefined ? {} : { block: w.block }))
  // The classic events of a session the mod also watches, answered with nothing beneath.
  on('classic.SessionStart', async () => ({}))
  on('classic.UserPromptSubmit', async () => ({}))
  on('classic.PostModelSwitch', async () => ({}))
  // A permission prompt nobody beneath answers: the prompt shows.
  on('classic.PermissionRequest', async () => ({}))
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  // The clock in memory, with the time it answers moved on by what the session slept.
  const sleptOn = ((event: string, ...rest: unknown[]) => {
    if (event !== 'clock.now') return (on as (...a: unknown[]) => unknown)(event, ...rest)
    const handler = rest[rest.length - 1] as (...a: unknown[]) => Promise<{ value: number }>
    const later = async (...a: unknown[]) => {
      const r = await handler(...a)
      return { ...r, value: r.value + w.slept }
    }
    return (on as (...a: unknown[]) => unknown)(event, ...rest.slice(0, -1), later)
  }) as TestOn
  return Object.assign(w, { clock: mock.clock(sleptOn) })
}

// Every field of a task but `status` may be left out, so a test names only what it is about.
type StopInput = { background_tasks?: (Partial<TaskSummary> & { status: string })[]; session_crons?: { recurring: boolean }[]; agent_id?: string }

// The end of an answer, as the host raises it for the classic hook.
export const stop = ($: TestEngine, input: StopInput = {}) => $.classic.Stop({ stop_hook_active: false, ...input } as never)

export const endTurn = ($: TestEngine, reason: TurnEnd = 'answer', { agentId, answer, turnId }: { agentId?: string; answer?: string; turnId?: string } = {}) =>
  $.turn.complete({
    answer: answer ?? '',
    durationMs: 1,
    isAborted: reason === 'aborted',
    turnId: turnId ?? 't1',
    reason,
    ...(reason === 'refusal' ? { refusal: { category: null, explanation: null } } : {}),
    ...(agentId === undefined ? {} : { agentId }),
  } as never)

// The end of an answer and the stop that follows it, in the order most tests assume: `turn.complete` first. The host sends the stop
// first; the tests about the order send it that way themselves.
export const pause = async ($: TestEngine, input: StopInput = {}) => {
  await endTurn($, 'answer')
  await stop($, input)
}

export const startTurn = ($: TestEngine, turnId = 't1') => $.turn.start({ text: 'go', turnId })

// An answer ends at this context size: a pause.
export const pauseAt = async ($: TestEngine, world: SessionWorld, tokens: number | undefined) => {
  world.tokens = tokens
  await startTurn($)
  await pause($)
}

export type Host = {
  // The names `$.command.list()` shows.
  commands: string[]
  // Files by absolute path; a path that is not here cannot be read.
  files: Record<string, string>
  // The temp directory: its name (TMPDIR) and what lies in it; the home directory (HOME).
  tmpdir: string | undefined
  listing: { name: string; mtimeMs: number; size?: number }[]
  home: string | undefined
  // Commands whose run rejects (the engine's own words for it: a hook that throws leaves nothing to answer); a reason the submit is
  // answered with a drop for; whether the submit rejects.
  failRun: string[]
  dropSubmit: string | undefined
  rejectSubmit: boolean
  // The submits after this many are rejected: the first message gets through and what follows does not.
  rejectSubmitAfter: number
  // A reason the environment cannot be read, which no part of the handoff expects.
  envError: string | undefined
  // The value of the variable that sets the log level, unset by default; and whether reading that variable, and only that one, fails.
  // `envError` does not touch it: a test about the handoff's own reads keeps its log level.
  logLevel: string | undefined
  logLevelFails: boolean
  // In order, what the mod did to the session: `run <command> <args>` and `submit <text>`.
  steps: string[]
  // What a `$.model.fork` call answers with, or that it never answers or throws; `modelForkPrompts` lists the prompts it was asked.
  modelFork: Record<string, unknown> | 'hang' | 'throw'
  modelForkPrompts: string[]
  // What a `$.session.compact` call answers with: `{ messages }`, `{ skip }`, or `{ throws }` for a refusal. A headless session refuses every
  // call, which is what the default does. The engine hands the mod its own words for a refusal, not the hook's, so the host's wording cannot be
  // set here: the test of the user's Esc calls the way with its own `Io`. Each call is the step `compact`.
  compact: Record<string, unknown>
  // What a compact by hand (`compactByHand`, trigger `manual`) answers with: a compaction by default, or `{ skip }` for one another hook
  // held back. Each is the step `compact manual`.
  manualCompact: Record<string, unknown>
  // What the next `tool.call`s answer with, in order; once they are used up a call answers with an ordinary result.
  toolResults: Record<string, unknown>[]
  // The session's id, which a /clear changes unless `clearKeepsSession` is set (a /clear that returned without effect).
  sessionId: string
  clearKeepsSession: boolean
  // Whether reading the session's id fails, from the moment it is set.
  sessionIdFails: boolean
  // What the store holds, and the store calls that fail, as `<op>:<key>` (`set:failure`; `*` for any key).
  store: Map<string, unknown>
  failStore: string[]
  // Files whose size `fs.stat` answers with instead of their length, for a transcript too large to read whole.
  sizes: Record<string, number>
  // What `process.run` answers for `tail -c <n> <path>`, by path; a path not here fails, as on a machine with no `tail`. Each run is listed in `runs`.
  tails: Record<string, string>
  runs: string[][]
  // The project folder, as `$.session.cwd()` answers it.
  cwd: string
  // Run while a step is under way, for what a person does in the middle of a handoff: the step is `run <command>`, `model.fork`, `submit` or `set <store key>`.
  // `read log level` holds up one read of the log level, for a read that comes back after a later one.
  during: Record<string, () => Promise<void>>
}

// The session as far as a handoff touches it: the command list, the commands that run, the files, the submit. Measured against the host:
// `command.run` settles at once, before the turn the command starts (that turn is the test's to end), and the list holds a user command
// and a plugin command of the same short name side by side. Everything else below is an assumption about the host, said where it is made.
export const hostWith = (on: TestOn, host: Partial<Host> = {}) => {
  const h: Host = {
    commands: ['handoff'],
    files: {},
    tmpdir: '/tmp',
    listing: [],
    home: '/home/me',
    failRun: [],
    dropSubmit: undefined,
    rejectSubmit: false,
    rejectSubmitAfter: Infinity,
    envError: undefined,
    logLevel: undefined,
    logLevelFails: false,
    modelFork: { isAnswered: false, reason: 'nothing-to-fork' },
    modelForkPrompts: [],
    compact: { throws: 'not available in a headless session' },
    manualCompact: COMPACT_DONE,
    toolResults: [],
    steps: [],
    sessionId: 'old',
    sessionIdFails: false,
    clearKeepsSession: false,
    store: new Map(),
    failStore: [],
    sizes: {},
    tails: {},
    runs: [],
    cwd: '/work',
    during: {},
    ...host,
  }
  const storeFails = (op: string, key: string) => h.failStore.includes(`${op}:${key}`) || h.failStore.includes(`${op}:*`)
  // /clear gives the session a new id (the `command.run` below does it), as the host does.
  on('session.id', async () => (h.sessionIdFails ? { deny: 'session is not readable' } : { value: h.sessionId }))
  on('store.get', async (_, e) => (storeFails('get', e.key) ? { deny: 'store is down' } : { value: h.store.get(e.key) }))
  on('store.set', async (_, e) => {
    await once(h, `set ${e.key}`)
    if (storeFails('set', e.key)) return { deny: 'store is down' }
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', async (_, e) => {
    if (storeFails('delete', e.key)) return { deny: 'store is down' }
    h.store.delete(e.key)
    return { value: undefined }
  })
  on('command.list', async () => ({ value: h.commands.map(name => ({ name, description: '', source: 'user' })) }) as never)
  on('command.run', async (_, e) => {
    h.steps.push(`run ${e.command}${e.args ? ` ${e.args}` : ''}`)
    await once(h, `run ${e.command}`)
    if (h.failRun.includes(e.command)) throw new Error('refused')
    if (e.command === 'clear' && !h.clearKeepsSession) h.sessionId = h.sessionId === 'old' ? 'new' : `${h.sessionId}+`
    return {}
  })
  on('fs.read', async (_, e) => {
    const text = h.files[e.path]
    if (text === undefined) return { deny: `no such file: ${e.path}` }
    return { value: text } as never
  })
  // Assumed: a file the test does not name does not exist.
  on('fs.stat', async (_, e) => {
    const text = h.files[e.path]
    if (text === undefined) return { deny: `no such file: ${e.path}` }
    return { value: { kind: 'file', size: h.sizes[e.path] ?? text.length, mtimeMs: 0, isLink: false } } as never
  })
  // Only `tail -c <n> <path>` is known; anything else, or a path with no end set, fails as a missing program does.
  on('process.run', async (_, e) => {
    h.runs.push([...e.argv])
    const [program, flag, , path] = e.argv
    const end = program === 'tail' && flag === '-c' && path !== undefined ? h.tails[path] : undefined
    if (end === undefined) return { deny: `spawn ${program} ENOENT` }
    return { value: { exitCode: 0, stdout: end, stderr: '', isStdoutTruncated: false } } as never
  })
  on('session.cwd', async () => ({ value: h.cwd }))
  // Assumed: every entry is a file; the host's listing also tells directories and links apart, which the mod does not read.
  on('fs.list', async () => ({ value: h.listing.map(l => ({ name: l.name, kind: 'file', size: l.size ?? 1, mtimeMs: l.mtimeMs, isLink: false })) }) as never)
  // Assumed: `env.get` answers a variable by its name; HOME, TMPDIR and the log level are asked for, and anything else gets the temp
  // directory. That a read can fail at all is an assumption too: nothing measured names a cause.
  on('env.get', async (_, e) => {
    if (e.name === 'SWEET_SPOT_LOG_LEVEL') await once(h, 'read log level')
    if (e.name === 'SWEET_SPOT_LOG_LEVEL') return h.logLevelFails ? { deny: 'environment is not readable' } : { value: h.logLevel }
    if (h.envError !== undefined) return { deny: h.envError }
    return { value: e.name === 'HOME' ? h.home : h.tmpdir }
  })
  on('tool.call', async () => (h.toolResults.shift() ?? { result: 'ok', text: 'ok' }) as never)
  on('session.compact', async (_, e) => {
    if (e.trigger === 'manual') {
      h.steps.push('compact manual')
      return h.manualCompact as never
    }
    h.steps.push('compact')
    await once(h, 'compact')
    if ('throws' in h.compact) throw new Error(String(h.compact.throws))
    return h.compact as never
  })
  on('model.fork', async (_, e) => {
    h.modelForkPrompts.push(e.prompt)
    await once(h, 'model.fork')
    if (h.modelFork === 'hang') return new Promise<never>(() => {})
    if (h.modelFork === 'throw') throw new Error('refused')
    return { value: h.modelFork } as never
  })
  // Assumed: a submit that gets through is answered with the text as it was sent.
  on('prompt.submit', async (_, e) => {
    h.steps.push(`submit ${e.text}`)
    await once(h, 'submit')
    if (h.rejectSubmit || h.steps.filter(s => s.startsWith('submit ')).length > h.rejectSubmitAfter) throw new Error('refused')
    return h.dropSubmit === undefined ? { text: e.text } : { drop: h.dropSubmit }
  })
  return h
}

// Most tests are about the user's own command, so they name it and keep the mod's own handoff as the fallback; the default is the internal handoff alone.
export const LIVE = { options: { dry_run: false, handoff_method: 'external-command', handoff_fallback: 'internal-handoff', handoff_command: 'handoff' } }
// The dry run, as the tests about what it reports want it; the default is off.
export const DRY_RUN = { options: { dry_run: true } }
export const NO_GAP = { options: { ...LIVE.options, min_gap_minutes: 0, min_gap_turns: 0 } }
// The way to hand over and the fallback, as the two settings name them; `extra` adds any other setting.
export const methods = (method: string, fallback: string, extra: object = {}) => ({
  options: { dry_run: false, handoff_method: method, handoff_fallback: fallback, handoff_command: 'handoff', ...extra },
})
export const COMPACT_ONLY = methods('builtin-compact', 'none')
export const FILE = '/var/T/handoff-1.md'
export const NOTES = 'goal: finish the parser'
// What the host says to a compact: a hook's veto, and a compaction done.
export const COMPACT_VETO = { skip: 'probe veto' }
// What a tool call answers with after the person pressed Esc or "No" at the permission prompt, with a hint typed after "No", and after a
// rule denied it (measured against 2.1.296). The words are spelled out here: a test that imported them from the mod would never notice
// the mod's copy drift from the host's.
const NOT_PROCEED = "The user doesn't want to proceed with this tool use."
export const REJECTED_BY_USER = { isError: true, result: NOT_PROCEED, text: `${NOT_PROCEED} The tool use was rejected. STOP what you are doing.` }
export const REJECTED_WITH_HINT = {
  isError: true,
  result: NOT_PROCEED,
  text: `${NOT_PROCEED} To tell you how to proceed, the user said: write it to /var/T instead`,
}
export const DENIED_BY_RULE = { isError: true, result: 'denied', text: 'Permission to use Bash with command touch /var/T/x has been denied.' }
export const COMPACT_DONE = { messages: [{ role: 'user', text: 'summary', toolUses: [] }] }
// What a `$.model.fork` call answers with when it gives a handoff.
export const modelForkAnswer = (text: string) => ({
  isAnswered: true,
  text,
  usage: { input_tokens: 3, output_tokens: 900, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 5 },
})
export const ANSWERED = modelForkAnswer('goal: finish the parser\nnext: the lexer')

export type SessionWorld = ReturnType<typeof sessionWith>

// The main turn ends in an answer and the stop follows. What the stop started has not run yet: the handoff is raised and under way.
export const raiseHandoff = async ($: TestEngine) => {
  await startSession($)
  await startTurn($, 't1')
  await endTurn($, 'answer', { turnId: 't1' })
  await stop($)
}

// The same, and what the stop started is let run.
export const reachThreshold = async ($: TestEngine, world: SessionWorld) => {
  await raiseHandoff($)
  await world.clock.settle()
}

// The turn the command started ends.
export const commandTurnEnds = async ($: TestEngine, world: SessionWorld, answer: string, turnId = 't2') => {
  await startTurn($, turnId)
  await endTurn($, 'answer', { answer, turnId })
  await world.clock.settle()
}

// One edit in the prompt, as the host raises it. The engine raises `prompt.edit`, though its types for a test leave it out.
export const editPrompt = ($: TestEngine, e: object) => ($.prompt as unknown as { edit: (e: object) => Promise<unknown> }).edit(e)

// A person typing into the prompt.
export const typeInto = ($: TestEngine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

// A person running the mod's command. Inside its hook the engine refuses a command and a compact, as the host does (`fakes.test.tsx`).
export const runRelay = ($: TestEngine, args: string) => $.command.run({ command: 'sweet-spot', args } as never)

// A person compacting by hand, with /compact.
export const compactByHand = ($: TestEngine) => $.session.compact({ trigger: 'manual', messages: [] } as never)

// What the command answered.
export const answered = async (run: ReturnType<typeof runRelay>) => ((await run) as { text?: string }).text

// A handoff whose first message does not reach the fresh session: it is dropped by another hook.
export const dropped = async ($: TestEngine, world: SessionWorld, host: Host) => {
  host.dropSubmit = 'held by another hook'
  await reachThreshold($, world)
  await commandTurnEnds($, world, `HANDOFF_PATH: ${FILE}`)
  host.dropSubmit = undefined
}

// Wording and numbers that several test files pin. They are spelled out here on purpose: a test that imported them from the mod would never
// notice the mod's wording change.
export const MINUTE = 60_000
export const DUE = 'handing over now, context 210000 tokens'
export const HANDED = 'handed over, the fresh session carries on from the handoff'
export const failure = (reason: string) => `handover failed, ${reason}`
// The change of way from the user's command to the mod's own handoff, and the other way round.
export const fellBack = (reason: string) => `the handoff through the command failed (${reason}), the mod writes the handoff instead`
export const fellBackToCommand = (reason: string) => `the handoff the mod writes failed (${reason}), the command is used instead`
export const COMPACTING = 'compacting now, context 210000 tokens'
export const COMPACTED = 'compacted, the session carries on'
export const INTERNAL_HANDOFF_ALSO_FAILED = 'the mod could not write the handoff: there is no conversation yet to write a handoff from'
export const PENDING = 'pending:old'
export const submits = (host: Host) => host.steps.filter(s => s.startsWith('submit '))
