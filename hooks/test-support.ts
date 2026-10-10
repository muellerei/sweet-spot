// What the tests share: the floor beneath the mod's calls and the questions a test asks of it.

import { mock, type TestBody } from 'claude-code/testing'
import type { TurnEnd } from './pairing'

export type TestEngine = Parameters<TestBody>[0]
export type TestOn = Parameters<TestBody>[1]

// The engine's own answer to what the mod shows; the tests read what was said.
export const withMod = (on: TestOn) => {
  const seen = { toasts: [] as string[], logs: [] as string[], debug: [] as string[], registered: [] as string[], refuse: undefined as string | undefined }
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('command.register', async (_, e) => {
    if (seen.refuse !== undefined) return { deny: seen.refuse }
    seen.registered.push(e.name)
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
}

// The session as a test says it: what the mod may read at a stop. `reads` lists the questions asked, for the tests that need to know it asked none.
export const sessionWith = (on: TestOn, world: Partial<World> = {}) => {
  const w: World = { tokens: 210_000, window: 1_000_000, turns: 10, agents: [], rateLimits: [], reads: [], block: undefined, usageError: undefined, ...world }
  on('session.usage', async () => {
    w.reads.push('usage')
    if (w.usageError !== undefined) throw new Error(w.usageError)
    return {
      value: { startedAt: 0, rateLimits: w.rateLimits, context: { window: w.window, ...(w.tokens === undefined ? {} : { tokens: w.tokens }) } },
    } as never
  })
  on('session.turns', async () => ({ value: w.turns }))
  on('agent.list', async () => ({ value: w.agents }) as never)
  on('classic.Stop', async () => (w.block === undefined ? {} : { block: w.block }))
  on('turn.start', async (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', async () => ({ text: '' }))
  return Object.assign(w, { clock: mock.clock(on) })
}

type StopInput = { background_tasks?: { status: string }[]; session_crons?: { recurring: boolean }[]; agent_id?: string }

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
  // Run while a step is under way, for what a person does in the middle of a handoff: the step is `run <command>`, `model.fork`, `submit` or `set <store key>`.
  // `read log level` holds up one read of the log level, for a read that comes back after a later one.
  during: Record<string, () => Promise<void>>
}

// What a person does in the middle of a step happens once; their own doing goes through the same steps.
const once = async (h: Host, step: string) => {
  const act = h.during[step]
  delete h.during[step]
  await act?.()
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
    toolResults: [],
    steps: [],
    sessionId: 'old',
    sessionIdFails: false,
    clearKeepsSession: false,
    store: new Map(),
    failStore: [],
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
  on('session.compact', async () => {
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
export const modelForkAnswer = (text: string) => ({ isAnswered: true, text, usage: {} })
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

// A person typing into the prompt.
export const typeInto = ($: TestEngine, text: string, extra: object = {}) =>
  $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...extra } as never)

// A person running the mod's command.
export const runRelay = ($: TestEngine, args: string) => $.command.run({ command: 'sweet-spot', args } as never)

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
