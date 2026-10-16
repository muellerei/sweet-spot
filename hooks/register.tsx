import type { EngineInterface as Engine, Register } from 'claude-code'

import { configOf, type Config, type ConfigResult } from './config'
import { ASAP_OVER, RUNNING_UNKNOWN, asapFor } from './asap'
import {
  brakeFor,
  brakeOf,
  busyReason,
  decide,
  effectiveThreshold,
  laterAt,
  oneShots,
  shrunk,
  standingOf,
  thresholdInForce,
  waiting,
  type Decision,
  type Snapshot,
} from './decide'
import { claim, hold, HELD_MOMENT } from './hold'
import { LATER_OVER, laterFor, tokensOf } from './later'
import { idlePart, statusFor, statusTail } from './status'
import { checkOf, firstMethod, judgedLine } from './compact-check'
import { bandOf, kindAt, moveBack, NOT_NOW_KEY, typed, type Countdown, type Start } from './countdown'
import { standingPart } from './standing'
import { begin, end, endedLine, press, surveyed, type Answer, type CountdownIo, type EndReason, type Expiry } from './countdown-flow'
import { logger, refresh, shows } from './log'
import {
  carryOut,
  deliverReturn,
  endOfTurn,
  noteToolResult,
  prepare,
  redeliver,
  release,
  startOfTurn,
  throughMethods,
  why,
  type Failure,
  type Io,
  type Outcome,
} from './relay'
import {
  ANSWER_RUNNING,
  COMPACTED,
  HANDED_OVER,
  HANDOFF_UNDER_WAY,
  NOTHING_TO_REDELIVER,
  REDELIVER_UNDER_WAY,
  REDELIVERING,
  REDELIVERED,
  usageFor,
  CANCELLED,
  notPreparedLine,
  switchedLine,
  COLD_BAND,
  IDLE_DROPPED,
  ATTACHMENTS_STAY,
  DRY_RUN_RETURN,
  WORK_STAYS,
  CONTEXT_UNKNOWN,
  contextUnreadLine,
  decidedOf,
  failedLine,
  offLine,
  reportOf,
  unreadLine,
  unregisteredLine,
} from './report'
import { endSeen, judgeable, stopSeen, turnStarted, type Stop } from './pairing'
import { freshIdle, freshState, underWay, type IdlePrepared, type State } from './state'
import {
  HOUR_MS,
  baselineOfUsage,
  fireVerdict,
  firstBaselineOf,
  floorOf,
  hasAnswer,
  idleFor,
  isHit,
  lifetimeOf,
  planVerdict,
  prepareDueAt,
  readPlan,
  returnVerdict,
  TAIL_BYTES,
  type InputUsage,
} from './idle-handoff'

// The host follows `$` only into functions declared at the top of this file, so what takes `$` lives here and not inside `register`.

const say = ($: Engine, text: string) => {
  $.ui.toast(text)
  $.ui.log(text)
}

// One line of the diagnostic output, for finding out why a handoff did or did not happen. It goes to the transcript, where the host stamps
// the time. The level is looked up at each line, so a line from a timer goes by the latest read.
const toLog = ($: Engine) => (text: string) => $.ui.log(text)

const logTo = ($: Engine, state: State) => logger(() => state.logLevel, toLog($))

// An empty name is no command of the user's own: shown as `none`, not as an empty quote.
const commandShown = (name: string) => (name === '' ? 'none' : `"${name}"`)

// The command's name is of interest only where a way uses it.
const usesCommand = (c: Config) => c.handoffMethod === 'external-command' || c.handoffFallback === 'external-command'

// The log level, read afresh at the start of every handler (see `refresh`). The host wants the variable's name as a literal at the call.
// Each change to a level that shows `info` is marked with the settings in force, so that a log turned on halfway through a session says
// them too, and shows from where on its finer lines start. Settings the mod rejects have their own line, said where the person looks.
const readLevel = async ($: Engine, settings: ConfigResult, state: State) => {
  const before = await refresh(() => $.env.get('SWEET_SPOT_LOG_LEVEL'), toLog($), state)
  if (!settings.ok || state.logLevel === before || !shows(state.logLevel, 'info')) return
  const c = settings.config
  logTo($, state)(
    'info',
    `settings: threshold ${c.threshold}, dry_run ${c.dryRun ? 'on' : 'off'}, min gap ${c.minGapMinutes} minutes and ${c.minGapTurns} turns, later_tokens ${c.laterTokens}, countdown_seconds ${c.countdownSeconds}, idle_handoff ${c.idleHandoff ? 'on' : 'off'}, idle_handoff_min_tokens ${c.idleHandoffMinTokens}, method ${c.handoffMethod}, fallback ${c.handoffFallback}${usesCommand(c) ? `, handoff command ${commandShown(c.handoffCommand)}` : ''}, log level ${state.logLevel}`,
  )
}

const announce = ($: Engine, settings: ConfigResult, state: State) => {
  if (settings.ok) return
  say($, offLine(settings.errors))
  const n = settings.errors.length
  logTo($, state)('warn', `settings rejected, ${n} ${n === 1 ? 'error' : 'errors'}`)
}

const sessionIo = ($: Engine, state: State): Io => ({
  commands: async () => (await $.command.list()).map(c => c.name),
  now: () => $.clock.now(),
  run: (command, args) => $.command.run(args === undefined ? { command } : { command, args }),
  after: (ms, fn) => $.clock.after(ms, fn),
  readFile: path => $.fs.read(path),
  listDir: path => $.fs.list(path),
  tmpdir: () => $.env.get('TMPDIR'),
  home: () => $.env.get('HOME'),
  modelFork: async prompt => {
    const r = await $.model.fork({ prompt })
    return r.isAnswered
      ? { isAnswered: true, text: r.text, usage: r.usage }
      : { isAnswered: false, reason: r.reason, ...('status' in r ? { status: r.status } : {}) }
  },
  compact: async () => {
    const r = await $.session.compact()
    return r.skip === undefined ? {} : { skip: r.skip }
  },
  tell: text => say($, text),
  log: logTo($, state),
  submit: text => $.prompt.submit({ text }),
  sessionId: () => $.session.id(),
  keep: (key, value) => $.store.set(key, value),
  recall: key => $.store.get(key),
  forget: key => $.store.delete(key),
})

const countdownIo = ($: Engine, state: State): CountdownIo => ({
  now: () => $.clock.now(),
  after: (ms, fn) => $.clock.after(ms, fn),
  every: (ms, fn) => $.clock.every(ms, fn),
  surfaces: () => $.session.surfaces(),
  prompt: async () => (await $.prompt.read()).text,
  redraw: () => $.ui.invalidate('ui.render'),
  toast: text => $.ui.toast(text),
  log: logTo($, state),
})

// The message about invalid settings and the command, once per load: at the session start, or at the first turn of a session that was already running.
const introduce = async ($: Engine, settings: ConfigResult, state: State) => {
  if (state.introduced) return
  state.introduced = true
  announce($, settings, state)
  await registerCommand($, state)
}

const NOT_NOW_BUTTON = 'not-now'

// The one command of the mod; what it does is the word after it.
const COMMAND = 'sweet-spot'

const registerCommand = async ($: Engine, state: State) => {
  try {
    // Immediate: a command typed while an answer runs would otherwise wait until the pause that ends the answer has been judged
    // (docs/host-behaviour.md, Commands).
    await $.command.register({
      name: COMMAND,
      description:
        'Show where the context stands, move the next handover back or drop the idle handoff, hand over at the next pause, or submit again the handoff that did not reach the fresh session',
      argumentHint: 'status | later [tokens] | asap | redeliver',
      immediate: true,
    })
  } catch (err) {
    say($, unregisteredLine(why(err)))
    logTo($, state)('warn', 'could not register the command')
  }
}

// Says how a run ended. Whatever goes wrong ends here as a line, never as an error into the host. The log names the stage, not the
// reason: that can carry paths, the host's words and what was typed.
const settle = async (
  $: Engine,
  state: State,
  run: { name: 'handover' | 'redelivery'; done: (outcome: Outcome) => string; sayFailure?: (failure: Failure) => boolean },
  carry: () => Promise<Outcome>,
) => {
  const log = logTo($, state)
  try {
    const outcome = await carry()
    const failure = outcome.failure
    if (failure === undefined) say($, run.done(outcome))
    else if (failure.stage === 'cancelled') {
      say($, CANCELLED)
      log('info', `${run.name} cancelled`)
    } else {
      if (run.sayFailure?.(failure) ?? true) say($, failedLine(failure.reason))
      log('warn', `${run.name} failed (stage ${failure.stage})`)
    }
  } catch (err) {
    say($, failedLine(why(err)))
    log('warn', `${run.name} failed (unexpected error)`)
  }
}

// The submit waits for the session to be idle, so it is not waited for in the command: the command answers at once.
const runRedelivery = async ($: Engine, state: State) => {
  try {
    await settle($, state, { name: 'redelivery', done: () => REDELIVERED }, async () => ({ failure: await redeliver(sessionIo($, state), state) }))
  } finally {
    state.redelivering = false
  }
}

// Without usable settings (`config` undefined) the mod never handed anything over, so there is nothing to redeliver.
const redeliverText = ($: Engine, config: Config | undefined, args: string, state: State): string => {
  if (args.trim() !== 'redeliver') return usageFor(args)
  if (underWay(state)) return HANDOFF_UNDER_WAY
  if (state.answerRunning) return ANSWER_RUNNING
  if (state.redelivering) return REDELIVER_UNDER_WAY
  if (state.pending === undefined || config === undefined) return NOTHING_TO_REDELIVER
  state.redelivering = true
  $.clock.after(0, () => void runRedelivery($, state))
  return REDELIVERING
}

const turnedDown = (text: string, why: string, verb = 'later'): Answer => ({ text, lines: [['debug', `${verb}: turned down, ${why}`]] })

// What a command that acts on the context needs before it does: settings it can trust, no handover under way (nor, for `asap`, a step of
// its own still to come), and the context size, read at that moment. Otherwise the answer that turns it down. The command answers whatever
// goes wrong with the read; the hook's `.catch` would only pass the error to the host.
const contextFor = async (
  $: Engine,
  settings: ConfigResult,
  state: State,
  verb: 'later' | 'asap',
): Promise<{ config: Config; tokens: number; window: number } | Answer> => {
  if (!settings.ok) return turnedDown(offLine(settings.errors), 'the settings are rejected', verb)
  const busy = () => underWay(state) || (verb === 'asap' && state.asapScheduled)
  if (busy()) return turnedDown(HANDOFF_UNDER_WAY, 'a handover is in progress', verb)
  let context: { tokens?: number; window: number }
  try {
    context = (await $.session.usage()).context
  } catch (err) {
    return { text: contextUnreadLine(why(err)), lines: [['warn', `${verb}: could not read the context size`]] }
  }
  // A pause may have started a handover during the read: a later handover or a mark set beside it would come too late for it and hold on in
  // the fresh session.
  if (underWay(state)) return turnedDown(HANDOFF_UNDER_WAY, 'a handover is in progress', verb)
  if (context.tokens === undefined) return turnedDown(CONTEXT_UNKNOWN, 'the context size is unknown', verb)
  return { config: settings.config, tokens: context.tokens, window: context.window }
}

// Moves the next handover back. It needs the context at the time it is typed, so its answer waits for that read.
const laterText = async ($: Engine, settings: ConfigResult, rest: string, state: State): Promise<Answer> => {
  const asked = tokensOf(rest)
  if ('error' in asked) return turnedDown(asked.error, 'not a number of tokens')
  // Staying in this session after a long pause: the handoff written goes, and the rest is `later` as ever.
  if (state.idle.prepared !== undefined) {
    const over = endPause($, state, 'later')
    const answer = await laterText($, settings, rest, state)
    const lines: Answer['lines'] = over === undefined ? [] : [['debug', over]]
    return { text: IDLE_DROPPED + answer.text, lines: [...lines, ...(answer.lines ?? [])] }
  }
  const ready = await contextFor($, settings, state, 'later')
  if ('text' in ready) return ready
  const { config, tokens, window } = ready
  const before = laterAt(state.later, tokens)
  const result = laterFor(config, window, tokens, state.later, asked.tokens === 'setting' ? config.laterTokens : asked.tokens)
  state.later = result.later
  // The last word counts: `later` after `asap` takes the mark back, whether `later` itself was turned down or not.
  const withdrawn = state.asap !== undefined
  state.asap = undefined
  // A step of `asap` still to come finds no mark and does nothing; a new `asap` before it must not be turned down for it.
  state.asapScheduled = false
  // Moving the handover back is the person's answer, not a pause that dodged it: the deferred pauses start over. A later turned down moves
  // nothing and leaves them.
  if (result.later !== before) state.deferred = undefined
  const lines: Answer['lines'] = result.lines.map(line => ['debug', line])
  if (withdrawn) lines.unshift(['debug', 'asap: withdrawn by later'])
  return { text: withdrawn ? `asap withdrawn, ${result.text}` : result.text, lines }
}

const verbOf = (args: string) => args.trim().split(/\s/, 1)[0]

// Reads the context and says where it stands; nothing in the state changes. It answers during a handover too, and says so.
const statusText = async ($: Engine, settings: ConfigResult, state: State): Promise<Answer> => {
  if (!settings.ok) return { text: offLine(settings.errors) }
  let context: { tokens?: number; window: number }
  try {
    context = (await $.session.usage()).context
  } catch (err) {
    return { text: contextUnreadLine(why(err)), lines: [['warn', 'status: could not read the context size']] }
  }
  const { tokens, window } = context
  const text =
    statusFor(settings.config, window, tokens, laterAt(state.later, tokens)) + statusTail(state.asap !== undefined, idlePart(state.idle, await $.clock.now()))
  return {
    text: state.handingOver ? `${text}, a handover is in progress` : text,
    lines: [
      [
        'debug',
        tokens === undefined ? `status: answered, context size unknown, window ${window} tokens` : `status: answered, context ${tokens} of ${window} tokens`,
      ],
    ],
  }
}

// Hands over at the next pause, wherever the context stands. It needs the context at the time it is typed, so its answer waits for that read.
const asapText = async ($: Engine, settings: ConfigResult, state: State): Promise<Answer> => {
  const ready = await contextFor($, settings, state, 'asap')
  if ('text' in ready) return ready
  const { config, tokens, window } = ready
  const result = asapFor(config, tokens)
  state.asap = result.asap
  // The last word counts: `asap` after `later` drops the later handover.
  const dropped = state.later !== undefined
  state.later = undefined
  const lines: NonNullable<Answer['lines']> = result.lines.map(line => ['debug', line])
  if (dropped) lines.unshift(['debug', 'later: dropped by asap'])
  const prefix = dropped ? 'later dropped, ' : ''
  // An answer that runs ends in a pause, and that pause judges. At rest no pause comes.
  if (state.answerRunning) return { text: prefix + result.text, lines }
  const rest = await asapAtRest($, config, state, tokens, window, result.text)
  if (rest === undefined) return { text: prefix + result.text, lines }
  return { text: prefix + rest, lines: [...lines, ['debug', 'asap: judged at rest']] }
}

// What the last stop said plus what runs now, as a pause would read them, for `asap` typed at rest.
const restSnapshot = async ($: Engine, state: State, tokens: number, window: number): Promise<Snapshot | undefined> => {
  const stop = state.lastStop
  if (stop === undefined) return undefined
  const [agents, turns, now] = await Promise.all([$.agent.list(), $.session.turns(), $.clock.now()])
  // `later` is gone: `asapText` dropped it before this reads.
  return { ...snapshotOf(stop, { tokens, window }, agents, turns, state), now, later: undefined }
}

// The step that starts the handover of `asap` at rest comes this long after the command's answer: the host refuses a compact, a /clear and a
// user command inside the command itself (docs/host-behaviour.md, Commands).
const ASAP_STEP_MS = 300

// `asap` typed with no answer running: no stop and no pause will judge, so the command does. It judges as a pause does, and the handover that
// follows begins in a step of its own. Not known what runs (no stop seen since the last turn started): the mark stays for the next pause.
// The text it answers with, or `undefined` for the answer of the mark alone.
const asapAtRest = async ($: Engine, config: Config, state: State, tokens: number, window: number, text: string): Promise<string | undefined> => {
  let snapshot: Snapshot | undefined
  try {
    snapshot = await restSnapshot($, state, tokens, window)
  } catch (err) {
    // Not known what runs, as with no stop seen: the mark stays for the next pause, which reads it again.
    logTo($, state)('warn', 'asap: could not read what runs')
    return `${text}, ${RUNNING_UNKNOWN}`
  }
  // A turn or a handover may have started during the reads: the mark waits for its pause.
  if (state.answerRunning || underWay(state)) return undefined
  if (snapshot === undefined) return `${text}, ${RUNNING_UNKNOWN}`
  const decision = decide(snapshot, config)
  if (decision.kind === 'none') return undefined
  if (decision.kind === 'defer') return reported(decision, config, state)
  // The answer says it; a toast would say it twice.
  if (decision.kind === 'dry-run') {
    spendMarks($, state, snapshot.now, snapshot.turns)
    return reported(decision, config, state)
  }
  state.asapScheduled = true
  $.clock.after(ASAP_STEP_MS, () => void asapStep($, config, state))
  return reported(decision, config, state)
}

// The step: it judges again with a fresh snapshot, and begins only if the judgment is still to hand over. Otherwise the mark stays and the
// next pause judges.
const asapStep = async ($: Engine, config: Config, state: State) => {
  state.asapScheduled = false
  try {
    if (state.asap === undefined) return
    const { tokens, window } = (await $.session.usage()).context
    if (tokens === undefined) return
    const snapshot = await restSnapshot($, state, tokens, window)
    if (snapshot === undefined || state.asap === undefined || state.answerRunning || underWay(state)) return
    const decision = decide(snapshot, config)
    if (decision.kind === 'defer') sayOnce($, state, decision.reason, reported(decision, config, state))
    else if (decision.kind === 'act' && handOverPrepared($, state, snapshot.now, snapshot.turns)) return
    // The command's answer has said it is handing over; saying it again would double the line.
    else if (decision.kind !== 'none') beginHandover($, decision, config, state, snapshot.now, snapshot.turns, false)
  } catch (err) {
    sayUnread($, state, err)
  }
}

// The handoff written in a long pause, when `asap` is about to hand over: cold, it is the one handed over, since writing it anew on a cold
// cache would read the whole context again; warm, it goes, and a fresh one carries everything up to now for little. True when it is handed over.
const handOverPrepared = ($: Engine, state: State, now: number, turns: number): boolean => {
  const prepared = state.idle.prepared
  if (prepared?.kind !== 'real') return false
  const log = logTo($, state)
  if (now - (state.idle.touch ?? now) < HOUR_MS) {
    const over = endPause($, state, 'asap with the cache warm')
    if (over !== undefined) log('debug', over)
    return false
  }
  // In one step with no wait, as a handover begins: the band and the timers go with the handoff.
  const over = endPause($, state, 'asap takes the handoff written')
  spendMarks($, state, now, turns)
  state.handingOver = true
  state.held = []
  if (over !== undefined) log('debug', over)
  log('info', 'idle: asap hands over the handoff written')
  void returnInto($, state, prepared, undefined, () => HANDED_OVER)
  return true
}

// A failed read is said once; the log carries the warning the first time only.
const sayUnread = ($: Engine, state: State, err: unknown) => {
  const line = unreadLine(why(err))
  if (sayOnce($, state, line, line)) logTo($, state)('warn', 'could not check for a handoff')
}

// What the command does is the word after it. `later` takes an argument, so the rest is its argument; `status` and `redeliver` take none.
const commandText = ($: Engine, settings: ConfigResult, args: string, state: State): Promise<Answer> | Answer => {
  const words = args.trim()
  const verb = verbOf(words)
  if (verb === 'later') return laterText($, settings, words.slice(verb.length), state)
  if (words === 'status') return statusText($, settings, state)
  if (words === 'asap') return asapText($, settings, state)
  return { text: redeliverText($, settings.ok ? settings.config : undefined, args, state) }
}

// Runs the handoff to its end and says how it went.
const handoff = async ($: Engine, config: Config, state: State, tokens: number) => {
  const io = sessionIo($, state)
  io.log('info', `handoff starts, method ${config.handoffMethod}`)
  try {
    const done = (outcome: Outcome) => (outcome.method === 'builtin-compact' ? COMPACTED : HANDED_OVER)
    // The failure that the mark alone causes (a compact as the only way, not asked because the last one was not enough) is told once for each mark.
    const sayFailure = (failure: Failure) => {
      const check = state.compactCheck
      const byMarkAlone = failure.stage === 'compact' && config.handoffMethod === 'builtin-compact' && config.handoffFallback === 'none'
      if (!byMarkAlone || check?.kind !== 'insufficient') return true
      if (check.said) return false
      check.said = true
      return true
    }
    await settle($, state, { name: 'handover', done, sayFailure }, async () => {
      const outcome = await carryOut(io, state, () => throughMethods(io, state, config))
      if (outcome.failure === undefined) {
        state.afterHandoff = { before: tokens, pauses: 0 }
        // A compact is checked at the first tool call or pause after it; a handoff into a fresh session starts over.
        state.compactCheck = outcome.method === 'builtin-compact' ? { kind: 'pending' } : undefined
      }
      return outcome
    })
  } finally {
    // `carryOut` ends the holding itself, in one step with its last look at what was held; this covers a throw before that.
    state.handingOver = false
    state.still = undefined
  }
}

// A reason for postponing, or a failure, is said once: `key` is what makes two lines the same one.
const sayOnce = ($: Engine, state: State, key: string, text: string): boolean => {
  if (state.said === key) return false
  state.said = key
  say($, text)
  return true
}

// `act` comes only with the dry run off. It starts the handoff after the stop has returned: the stop is a hook the turn waits on, and the
// command is a turn of its own that would wait on this one.
const handOver = ($: Engine, decision: Extract<Decision, { kind: 'act' }>, config: Config, state: State, announce = true) => {
  // Without a first way (a compact that was not enough, and no fallback) there is nothing to announce: the run fails at the mark.
  const first = firstMethod(config, state)
  if (announce && first !== undefined) say($, reportOf(decision, first))
  state.handingOver = true
  state.held = []
  const tasks = state.lastStop?.background_tasks
  state.still = { standing: standingOf(tasks), forced: decision.forced === undefined ? [] : waiting(tasks) }
  $.clock.after(0, () => void handoff($, config, state, decision.tokens))
}

// The first call of a tool in the main loop after a compact says whether it was enough. The size counts the model call that asked for the
// tool, not the tool's result, and reads the same before and after `next(e)`: it is what the compact left and the prompt (measured,
// host-behaviour). The pause would already hold the whole turn, and a turn that reads a lot would look like a compact that did too little.
// Only the first reading judges. One with no size leaves it to the next call, whose size holds at most the results before it: still nearer
// than the pause.
const checkAtToolCall = async ($: Engine, settings: ConfigResult, config: Config, state: State) => {
  if (state.compactCheck?.kind !== 'pending') return
  const { tokens, window } = (await $.session.usage()).context
  const before = state.compactCheck
  if (before?.kind !== 'pending') return
  state.compactCheck = checkOf(before, tokens, effectiveThreshold(config.threshold, window))
  const line = judgedLine(before, state.compactCheck, tokens)
  if (line === undefined) return
  await readLevel($, settings, state)
  logTo($, state)('debug', line)
}

// The pauses after a handoff that are logged against the context it left: enough to see where the fresh session starts and how it grows.
const AFTER_HANDOFF_PAUSES = 3

// The account's windows as the status line shows them; none off a subscription, and then the line has nothing of it.
const limitsOf = (limits: readonly { kind: string; percentUsed: number }[]): string =>
  limits.length === 0 ? '' : `, limits ${limits.map(l => `${l.kind} ${l.percentUsed}%`).join(', ')}`

// What a pause judges, but the clock, built the same way for the pause and for the end of a countdown. `later` is checked against the
// context: the pause has already ended it in the state, the end of a countdown only reads it.
const snapshotOf = (
  seen: Pick<Stop, 'background_tasks' | 'session_crons'>,
  context: { tokens?: number; window: number },
  agents: readonly { status: string }[],
  turns: number,
  state: State,
): Omit<Snapshot, 'now'> => ({
  tokens: context.tokens,
  window: context.window,
  backgroundTasks: waiting(seen.background_tasks).length,
  standingTasks: standingOf(seen.background_tasks).length,
  oneShotTimers: oneShots(seen.session_crons),
  subagents: agents.filter(a => a.status === 'running').length,
  turns,
  lastAttempt: state.lastAttempt,
  later: laterAt(state.later, context.tokens),
  asap: state.asap,
})

// The line for a decision names the way tried first; with none known (a compact that was not enough, and no fallback), the setting's way.
const reported = (decision: Exclude<Decision, { kind: 'none' }>, config: Config, state: State): string =>
  reportOf(decision, firstMethod(config, state) ?? config.handoffMethod)

// Carried out at the pause, when the countdown runs out with a judgment of its own, or by `asap` at rest: only then is it an attempt and are
// `later` and the mark spent. A countdown that ends without a handover leaves both as they were.
const spendMarks = ($: Engine, state: State, at: number, atTurns: number) => {
  const log = logTo($, state)
  // A dry run counts as an attempt too: it shows the pace the real run would keep.
  state.said = undefined
  state.lastAttempt = { at, turns: atTurns }
  // `later` held for this handover, whether it goes through or not: the next one comes at the threshold.
  if (state.later !== undefined) log('debug', 'later: spent by this handover')
  state.later = undefined
  // `asap` is spent by the same handover.
  if (state.asap !== undefined) log('debug', 'asap: spent by this handover')
  state.asap = undefined
  // A handover that began, whether it goes through or not, ends the deferred pauses.
  state.deferred = undefined
}

const beginHandover = ($: Engine, judged: Countdown['decision'], config: Config, state: State, at: number, atTurns: number, announce = true) => {
  // A second source of a handover (a countdown that was still being set up when `asap` began one at rest) finds it under way.
  if (underWay(state)) return logTo($, state)('debug', 'handover: already under way')
  spendMarks($, state, at, atTurns)
  if (judged.kind === 'act') handOver($, judged, config, state, announce)
  else say($, reported(judged, config, state))
}

// What a pause reads of the host, in one go. Planning the idle handoff after it goes by the same context.
const pauseRead = ($: Engine) => Promise.all([$.session.usage(), $.agent.list(), $.session.turns(), $.clock.now()])
type PauseRead = Awaited<ReturnType<typeof pauseRead>>

const atPause = async ($: Engine, e: Stop, config: Config, state: State, [{ context, rateLimits }, agents, turns, now]: PauseRead) => {
  // A context below where `later` was asked has shrunk (a compact, /clear): the later handover is over before `decide` judges.
  const kept = laterAt(state.later, context.tokens)
  const over = state.later !== undefined && kept === undefined
  state.later = kept
  // The mark ends the same way.
  const asapKept = shrunk(state.asap, context.tokens)
  const asapOver = state.asap !== undefined && asapKept === undefined
  state.asap = asapKept
  // The deferred pauses end the same way.
  const deferred = shrunk(state.deferred, context.tokens)
  const deferredOver = state.deferred !== undefined && deferred === undefined
  state.deferred = deferred
  const snapshot = { ...snapshotOf(e, context, agents, turns, state), now }
  const log = logTo($, state)
  if (over) log('debug', LATER_OVER)
  if (asapOver) log('debug', ASAP_OVER)
  if (deferredOver) log('debug', 'countdown: deferred pauses over, the context shrank')
  const fresh = state.afterHandoff
  if (fresh !== undefined && fresh.pauses < AFTER_HANDOFF_PAUSES && snapshot.tokens !== undefined && snapshot.tokens < fresh.before) {
    fresh.pauses += 1
    log('debug', `after handoff: context ${snapshot.tokens} tokens (${fresh.before} before the handoff), pause ${fresh.pauses}`)
  }
  // Before `decide` judges and `firstMethod` names the first way: at the first pause after a compact that was not enough the context is above
  // the threshold, so `decide` says `act`, and a mark set only after it would let that run compact once more to no effect.
  const threshold = effectiveThreshold(config.threshold, snapshot.window)
  const before = state.compactCheck
  state.compactCheck = checkOf(before, snapshot.tokens, threshold)
  const judged = judgedLine(before, state.compactCheck, snapshot.tokens)
  if (judged !== undefined) log('debug', judged)
  const decision = decide(snapshot, config)
  log(
    'info',
    `pause: context ${snapshot.tokens} of ${snapshot.window} tokens (threshold ${threshold}${state.later === undefined ? '' : `, later ${thresholdInForce(config.threshold, snapshot.window, state.later)}`}${state.asap === undefined ? '' : ', asap'}, brake ${brakeOf(threshold, snapshot.window)}), ${snapshot.backgroundTasks + snapshot.standingTasks} background tasks (${snapshot.standingTasks} standing), ${snapshot.oneShotTimers} timers, ${snapshot.subagents} subagents, turn ${turns}, ${state.lastAttempt === undefined ? 'no attempt before' : `last attempt at turn ${state.lastAttempt.turns}`}${limitsOf(rateLimits)}, ${decidedOf(decision)}${'forced' in decision && decision.forced !== undefined ? `, forced past the brake by ${decision.forced}` : ''}`,
  )
  if (decision.kind === 'none') {
    state.said = undefined
    return
  }
  if (decision.kind === 'defer') {
    sayOnce($, state, decision.reason, reported(decision, config, state))
    return
  }
  // Carried out at the pause, or when the countdown runs out with a judgment of its own: only then is it an attempt and is `later` spent. A
  // countdown that ends without a handover leaves both as they were.
  const carry = (judged: Countdown['decision'], at: number, atTurns: number) => beginHandover($, judged, config, state, at, atTurns)
  const postpone = (judged: Extract<Decision, { kind: 'defer' }>) => void sayOnce($, state, judged.reason, reported(judged, config, state))
  const expiry: Expiry = { look: () => lookAgain($, e, state), judge: s => decide(s, config), carry, postpone }
  // `asap` was asked for by the person: there is no countdown to say it again.
  if (snapshot.asap === undefined && (await countdownBegun($, decision, config, state, snapshot, expiry))) return
  carry(decision, now, turns)
}

// What the end of a countdown reads to judge again, as a pause does. Background tasks and one-shot timers are the stop's: after it they
// cannot be read, and they change only in a turn, which ends the countdown.
const lookAgain = async ($: Engine, e: Stop, state: State): Promise<Omit<Snapshot, 'now'>> => {
  const [{ context }, agents, turns] = await Promise.all([$.session.usage(), $.agent.list(), $.session.turns()])
  return snapshotOf(e, context, agents, turns, state)
}

// A countdown before the handover, where one is set and the first way is known; without a first way the pause goes on as before and
// the run says why it fails.
const countdownBegun = async ($: Engine, decision: Countdown['decision'], config: Config, state: State, snapshot: Snapshot, expiry: Expiry) => {
  if (config.countdownSeconds === 0) return false
  const method = firstMethod(config, state)
  if (method === undefined) return false
  const { window } = snapshot
  const kind = kindAt(snapshot, config, state.deferred?.pauses ?? 0)
  if (kind === 'immediate') {
    logTo($, state)('debug', 'countdown: none, at the emergency brake')
    return false
  }
  // The countdown at the brake counts down to the brake, which is where it hands over.
  const threshold = kind === 'brake' ? brakeFor(config, window) : thresholdInForce(config.threshold, window, state.later)
  const running = standingOf(state.lastStop?.background_tasks)
    .map(t => standingPart(t.command ?? ''))
    .filter(part => part !== undefined)
  const start: Start = {
    ...(kind === 'button' ? { kind, moveBack: moveBack(config, window, decision.tokens) } : { kind }),
    method,
    decision,
    threshold,
    running,
  }
  return begin(countdownIo($, state), state, config.countdownSeconds, start, expiry)
}

// Ends a running countdown for what a person did, at once and before any wait of the handler; the line comes after its read of the log
// level. Nothing is moved back: the next pause counts down again.
//
// A hook that only watches for it passes the event on whatever goes wrong here (the `.catch` at its call): the event is the host's, and
// a `.catch` on the hook itself would pass it on a second time where `next(e)` was what failed.
const endCountdown = async ($: Engine, settings: ConfigResult, state: State, reason: EndReason) => {
  if (!end(countdownIo($, state), state)) return
  await readLevel($, settings, state)
  logTo($, state)('debug', endedLine(reason))
}

// Ends the mark for what happened to the session, at once; the line comes after its read of the log level. Like the countdown it only watches.
const endAsap = async ($: Engine, settings: ConfigResult, state: State, why: string) => {
  if (state.asap === undefined) return
  state.asap = undefined
  await readLevel($, settings, state)
  logTo($, state)('debug', `asap: ended, ${why}`)
}

// "Not now" moves the handover back as the command `later` with no number does, and answers the same way.
const notNow = async ($: Engine, settings: ConfigResult, state: State) => {
  const lines = await press(countdownIo($, state), state, () => laterText($, settings, '', state))
  await readLevel($, settings, state)
  const log = logTo($, state)
  for (const [level, line] of lines) log(level, line)
}

// The stop is a hook the turn waits on and can only be asked to go on: an error here is said once and the stop ends as if the mod were absent.
// The answer is what was read, or nothing where the read itself failed.
const atPauseOrSay = async ($: Engine, e: Stop, config: Config, state: State): Promise<PauseRead | undefined> => {
  let read: PauseRead | undefined
  try {
    read = await pauseRead($)
    await atPause($, e, config, state, read)
  } catch (err) {
    sayUnread($, state, err)
  }
  return read
}

// This is the one place that judges, once the stop and the end of its turn are both in; a stop whose turn ended otherwise is dropped.
// What it judges is taken by the caller before its read of the log level, together with whether a handoff runs: see `register`.
// Only a turn that ended in an answer is a pause: Esc, an error or a refusal never starts a handoff.
const judge = async ($: Engine, config: Config, state: State, paired: ReturnType<typeof judgeable>, handingOver: boolean) => {
  const log = logTo($, state)
  if ('waitingFor' in paired) {
    log('debug', `judge: waiting for ${paired.waitingFor}`)
    return
  }
  if (!handingOver && paired.end === 'answer') {
    log('debug', 'judge: the stop and the end of the turn are both in, the turn ended in answer')
    const read = await atPauseOrSay($, paired.stop, config, state)
    // A handover begun at this pause replaces the session: there is no pause of it to plan for.
    if (underWay(state)) return
    // The plan goes by the context the pause judged; where the pause could not read, the plan reads the context itself.
    try {
      const tokens = read === undefined ? (await $.session.usage()).context.tokens : read[0].context.tokens
      await planIdle($, config, state, paired.stop, tokens)
    } catch {
      log('warn', 'idle: could not plan')
    }
  } else log('debug', `judge: the turn ended in ${paired.end}, no pause`)
}

// The baseline belongs to the project's setup (system prompt, tools, MCP servers, CLAUDE.md), not to one session: kept per project folder.
const baselineKey = (cwd: string) => `idle-baseline:${cwd}`

// The first request of a fresh session is the project's baseline, unless the session is one a handoff of the mod began: its first message
// is the handoff. Whatever fails here leaves the baseline as it was; the next fresh session tries again.
const keepBaseline = async ($: Engine, state: State, usage: InputUsage) => {
  try {
    const [id, cwd, at] = await Promise.all([$.session.id(), $.session.cwd(), $.clock.now()])
    if (id === state.deliveredInto) return
    const tokens = baselineOfUsage(usage)
    state.idle.baseline = tokens
    await $.store.set(baselineKey(cwd), { tokens, at })
  } catch {
    // Not kept: the transcript of a resumed session is the fallback.
  }
}

// Reads the transcript for the cache lifetime, and finds the baseline where the first request did not give it: kept for the project, or for
// a resumed session with none kept, the first request in its transcript. A transcript above the limit is read at its end through `tail`, the
// one process the mod starts; it holds the latest writes, not the first request. The path is never logged.
const readIdle = async ($: Engine, state: State) => {
  const idle = state.idle
  idle.read = false
  const log = logTo($, state)
  let text: string | undefined
  let whole = false
  const path = idle.transcript
  if (path !== undefined) {
    try {
      const plan = readPlan((await $.fs.stat(path)).size)
      if (plan === 'read') text = String(await $.fs.read(path))
      else {
        const end = await $.process.run(['tail', '-c', String(TAIL_BYTES), path])
        if (end.exitCode !== 0) throw new Error(`tail ended with ${end.exitCode}`)
        text = end.stdout
      }
      whole = plan === 'read'
    } catch {
      if (!idle.unreadSaid) log('warn', 'idle: the transcript could not be read')
      idle.unreadSaid = true
    }
  }
  // An end read with no write in it leaves the lifetime read before.
  const lifetime = text === undefined ? undefined : lifetimeOf(text)
  if (lifetime !== undefined) idle.lifetime = lifetime
  // The first turn of a fresh session can end before the host has written its answer to the transcript (docs/host-behaviour.md, "the
  // transcript can still lack the turn's answer"): where what was read holds no answer yet, the next turn reads again. A transcript that
  // could not be read, or holds answers with no write, says the same next time.
  if (idle.lifetime === undefined && text !== undefined && !hasAnswer(text)) idle.read = true
  if (idle.baseline === undefined) {
    try {
      const kept = (await $.store.get(baselineKey(await $.session.cwd()))) as { tokens?: unknown } | undefined
      if (typeof kept?.tokens === 'number') idle.baseline = kept.tokens
    } catch {
      // Unknown, as with none kept.
    }
  }
  if (idle.baseline === undefined && !idle.fresh && whole && text !== undefined) idle.baseline = firstBaselineOf(text)
  log('debug', `idle: cache lifetime ${idle.lifetime ?? 'unknown'}, baseline ${idle.baseline === undefined ? 'unknown' : `${idle.baseline} tokens`}`)
}

// The line of a pause that is over, and whether a handoff written went with it.
const pauseOverLine = (why: string, dropped: boolean) => `idle: pause over, ${why}${dropped ? ', the handoff written is dropped' : ''}`

// The pause is over: the planned step and a handoff written for it go. Only the state changes here; the line it gives back, for the log,
// is the caller's to write once it has read the log level. `why` is for that line only.
const endPause = ($: Engine, state: State, why: string): string | undefined => {
  const idle = state.idle
  // The step under way has no timer and nothing written yet: it is told, and drops what it writes.
  if (state.preparing && idle.prepared === undefined) idle.endedWhilePreparing = why
  idle.reread?.cancel()
  idle.reread = undefined
  if (idle.timer === undefined && idle.prepared === undefined) return undefined
  idle.timer?.cancel()
  idle.timer = undefined
  idle.coldTimer?.cancel()
  idle.coldTimer = undefined
  if (idle.coldShown) void $.ui.invalidate('ui.render')
  idle.coldShown = false
  const dropped = idle.prepared !== undefined
  idle.prepared = undefined
  return pauseOverLine(why, dropped)
}

// Writes the line `endPause` gave back, after the read of the log level, for a handler that has nothing else to log.
const logPauseOver = async ($: Engine, settings: ConfigResult, state: State, over: string | undefined) => {
  if (over === undefined) return
  await readLevel($, settings, state)
  logTo($, state)('debug', over)
}

// At the end of each answer, the step that writes the handoff is planned anew, 55 minutes after the answer's last request.
const planIdle = async ($: Engine, config: Config, state: State, stop: Stop, tokens: number | undefined) => {
  const idle = state.idle
  idle.timer?.cancel()
  idle.timer = undefined
  const log = logTo($, state)
  const verdict = planVerdict({
    on: config.idleHandoff,
    lifetime: idle.lifetime,
    tokens,
    floor: floorOf(config.idleHandoffMinTokens, idle.baseline),
    handingOver: underWay(state),
    timers: stop.session_crons?.length ?? 0,
  })
  const touch = idle.touch
  if (!verdict.plan || touch === undefined) {
    log('debug', `idle: not planned, ${verdict.plan ? 'no request seen' : verdict.why}`)
    // The answer of the first turn may not be in the transcript yet: read once more a little later, and plan from that read.
    if (idle.lifetime === undefined && idle.read && idle.transcript !== undefined) {
      idle.reread = $.clock.after(REREAD_MS, () => void rereadIdle($, config, state, stop, tokens))
    }
    return
  }
  const now = await $.clock.now()
  const wait = armIdle($, config, state, touch, now, now)
  log('debug', `idle: planned in ${Math.round(wait / 60_000)} min`)
}

// The transcript missed the answer by 0.21 s, measured in one session (docs/host-behaviour.md, "the transcript can still lack the turn's
// answer"); five seconds leave room above that.
const REREAD_MS = 5_000

// A turn that starts while the read runs ends the pause, and finds nothing to cancel yet: it is seen here, after the read.
const rereadIdle = async ($: Engine, config: Config, state: State, stop: Stop, tokens: number | undefined) => {
  state.idle.reread = undefined
  await readIdle($, state).catch(() => {})
  if (state.idle.lifetime !== undefined && !state.answerRunning) await planIdle($, config, state, stop, tokens).catch(() => {})
}

// Sets the step for its time, from the touch; `since` is when the pause began, which the line at the return counts from. Gives the wait.
const armIdle = ($: Engine, config: Config, state: State, touch: number, since: number, now: number) => {
  const wait = Math.max(0, prepareDueAt(touch) - now)
  const timer = $.clock.after(wait, () => void prepareIdle($, config, state, since))
  state.idle.timer = { cancel: () => timer.cancel(), since }
  return wait
}

// Holds the planned step back while a compact runs, so that nothing is written of a context the compact replaces, and gives back what sets
// it again where the compact did not go through. Meanwhile a timer that never fires stands in its place: the pause still has a step
// planned, for `endPause` and the status, and a stop that plans anew replaces it as it would the step.
const holdIdle = ($: Engine, config: Config | undefined, state: State) => {
  const idle = state.idle
  const held = idle.timer
  if (held === undefined || config === undefined) return () => Promise.resolve()
  held.cancel()
  const standIn = { cancel: () => {}, since: held.since }
  idle.timer = standIn
  return async () => {
    if (idle.timer === standIn && idle.touch !== undefined) armIdle($, config, state, idle.touch, held.since, await $.clock.now())
  }
}

// The step itself: the reads first, then every check and the mark in one go with no wait between, so that a turn of the person's that starts
// meanwhile is seen and not taken for the mod's own.
const prepareIdle = async ($: Engine, config: Config, state: State, since: number) => {
  const idle = state.idle
  idle.timer = undefined
  idle.endedWhilePreparing = undefined
  const log = logTo($, state)
  try {
    const [agents, now, usage] = await Promise.all([
      $.agent.list(),
      $.clock.now(),
      $.session.usage(),
      idle.transcript === undefined ? undefined : readIdle($, state),
    ])
    const busy = state.answerRunning
      ? 'a turn runs'
      : underWay(state)
        ? 'a handover runs'
        : state.countdown !== undefined
          ? 'a countdown runs'
          : agents.some(a => a.status === 'running')
            ? 'a subagent runs'
            : undefined
    const verdict = fireVerdict({ busy, lifetime: idle.lifetime, now, touch: idle.touch ?? now })
    if (!verdict.go) return log('debug', `idle: not prepared, ${verdict.why}`)
    if (config.dryRun) {
      idle.prepared = { kind: 'simulated', since }
      return log('info', 'idle: would prepare')
    }
    state.preparing = true
    state.held = []
    const io = sessionIo($, state)
    // Nothing runs between this and the return (a turn ends the pause), so the list is the one the return is judged on. The first message is
    // written here and kept in `idle.prepared`, so the list goes as soon as it is.
    state.still = { standing: standingOf(state.lastStop?.background_tasks), forced: [] }
    try {
      const r = await prepare(io, state, config)
      state.still = undefined
      const over = idle.endedWhilePreparing
      if (over !== undefined) log('debug', pauseOverLine(over, true))
      else if ('stage' in r) {
        say($, notPreparedLine(r.reason))
        log('warn', `idle: preparing failed (stage ${r.stage})`)
      } else {
        idle.prepared = { kind: 'real', text: r.text, ...(r.file === undefined ? {} : { file: r.file }), since }
        log('info', `idle: handoff prepared, ${r.text.length} characters`)
        // Reading the cache keeps it for another hour from when the model was asked (measured); a request that missed it may have written a
        // short-lived entry of its own. The command's turn needs no check: its requests read or write the session's own entry, and each moved
        // the touch as it went out.
        if (r.began !== undefined && !idle.doubted) {
          if (isHit(r.usage, usage.context.tokens ?? Number.POSITIVE_INFINITY)) idle.touch = r.began
          else log('debug', 'idle: the handoff missed the cache, the touch stays')
        }
        const touch = idle.touch ?? now
        idle.coldTimer = $.clock.after(Math.max(0, touch + HOUR_MS - (await $.clock.now())), () => {
          idle.coldTimer = undefined
          showCold($, state)
        })
      }
    } finally {
      state.still = undefined
      await release(io, state, undefined, () => {
        state.preparing = false
      })
    }
  } catch (err) {
    state.preparing = false
    say($, notPreparedLine(why(err)))
    log('warn', 'idle: preparing failed (unexpected error)')
  }
}

// The message that came back after the handoff was written, which has already taken it (`claim`). Judged by the clock and by what runs;
// whatever the verdict, the handoff written is gone. Only a cold cache with nothing running switches: the message is turned away here and
// goes into the fresh session with the handoff, from a step of its own, since the host refuses a /clear from a hook that holds a turn.
// Everything else lets the message through into this session. The answer is the drop reason, or `undefined` to let it through.
const comeBack = async ($: Engine, state: State, prepared: IdlePrepared, input: { text: string; attachments?: readonly unknown[] }) => {
  const log = logTo($, state)
  let verdict: ReturnType<typeof returnVerdict>
  let now: number
  let turns: number
  let tokens: number | undefined
  try {
    const [agents, at, count, usage] = await Promise.all([$.agent.list(), $.clock.now(), $.session.turns(), $.session.usage()])
    now = at
    turns = count
    tokens = usage.context.tokens
    const stop = state.lastStop
    const busy =
      busyReason({
        subagents: agents.filter(a => a.status === 'running').length,
        backgroundTasks: waiting(stop?.background_tasks).length,
        oneShotTimers: oneShots(stop?.session_crons),
      }) !== undefined
    verdict = returnVerdict({ now, touch: state.idle.touch ?? now, busy, attachments: (input.attachments?.length ?? 0) > 0 })
  } catch {
    log('warn', 'idle: could not judge the return, the message stays in this session')
    endReturn($, state)
    return undefined
  }
  if (verdict === 'cold' && prepared.kind === 'real') {
    // In one step with no wait: from here the holding is the handover's, and the message is the first of what it carries.
    state.returning = false
    state.handingOver = true
    state.held.unshift(input.text)
    spendMarks($, state, now, turns)
    log('info', 'idle: return after the cache expired, handing over')
    $.clock.after(0, () => void returnInto($, state, prepared, input.text, () => switchedLine(idleFor(now - prepared.since))))
    return HELD_MOMENT
  }
  endReturn($, state)
  if (verdict === 'warm') {
    state.idle.checkAgainst = tokens
    log('debug', 'idle: return while the cache is warm, the handoff written is dropped')
    return undefined
  }
  // What remains keeps a cold cache in this session: running work, an attachment, or a dry run, which counts as an attempt as at the threshold.
  if (verdict === 'busy') say($, WORK_STAYS)
  else if (verdict === 'attachments') say($, ATTACHMENTS_STAY)
  else {
    spendMarks($, state, now, turns)
    say($, DRY_RUN_RETURN)
  }
  log('debug', `idle: return after the cache expired, ${verdict === 'cold' ? 'dry run' : verdict}, the message stays in this session`)
  return undefined
}

// The judgment is over and the message goes into this session: what was typed meanwhile follows it, from a step of its own so that it comes
// after the message the hook lets through.
const endReturn = ($: Engine, state: State) => {
  if (state.held.length === 0) {
    state.returning = false
    return
  }
  $.clock.after(
    0,
    () =>
      void release(sessionIo($, state), state, undefined, () => {
        state.returning = false
      }),
  )
}

// The switch: /clear, then the handoff with the message that came back. The host leaves a message a hook turned away in the prompt, and that
// survives the /clear: once the message is in, the prompt is cleared of it, unless the person has changed it since.
// `asap` hands the handoff over the same way, with no message of its own (`text` undefined) and its own line at the end.
const returnInto = async ($: Engine, state: State, prepared: Extract<IdlePrepared, { kind: 'real' }>, text: string | undefined, done: () => string) => {
  const io = sessionIo($, state)
  try {
    let delivered = false
    await settle($, state, { name: 'handover', done }, () =>
      carryOut(io, state, async () => {
        const failure = await deliverReturn(io, state, prepared, text !== undefined)
        delivered = failure === undefined
        return failure === undefined ? {} : { failure }
      }),
    )
    if (delivered && text !== undefined && (await $.prompt.read()).text.trim() === text.trim()) await $.prompt.fill({ text: '', mode: 'replace' })
  } catch {
    io.log('debug', 'idle: could not clear the prompt after the switch')
  } finally {
    state.handingOver = false
  }
}

// The band says it once the handoff written has gone cold. A late timer (system sleep) shows it late: typing checks the clock as well.
const showCold = ($: Engine, state: State) => {
  const idle = state.idle
  if (idle.prepared?.kind !== 'real' || idle.coldShown) return
  idle.coldShown = true
  void $.ui.invalidate('ui.render')
  logTo($, state)('debug', 'idle: the handoff written has gone cold, the band says so')
}

// From typing: the level is read only once the band is to show, not at every key.
const checkCold = async ($: Engine, settings: ConfigResult, state: State) => {
  const touch = state.idle.touch
  if (touch === undefined || (await $.clock.now()) - touch < HOUR_MS) return
  await readLevel($, settings, state)
  showCold($, state)
}

export const register: Register = (on, options) => {
  const settings = configOf(options)
  const config = settings.ok ? settings.config : undefined
  const state = freshState()

  // Every handler reads the log level, each on its own: a value changed in a settings file reaches the host at the next turn. The read is a
  // wait, and two handlers' reads need not come back in the order they went out, so a handler changes the state before it reads, as it
  // would with no read at all, and logs after.
  on('session.start', async ($, e, next) => {
    // Every session reads the transcript at its first turn: a /clear does not reload the mod, but ends what was known of the session.
    state.idle.read = true
    await readLevel($, settings, state)
    await introduce($, settings, state)
    return next(e)
  })

  // The redelivery's timer runs outside any handler; its lines come after its own waits, by when the read here is in.
  on('command.run', { command: COMMAND }, async ($, e) => {
    // `later` and `asap` end a countdown before they move the handover back or ask for one. Typed, its first character has already ended
    // it; a command raises no submit, and from the history it is expected to come with no edit either (docs/host-behaviour.md, Commands).
    // `redeliver` leaves it running.
    const verb = verbOf(e.args)
    const ended = (verb === 'later' || verb === 'asap') && end(countdownIo($, state), state)
    const { text, lines = [] } = await commandText($, settings, e.args, state)
    await readLevel($, settings, state)
    const log = logTo($, state)
    if (ended) log('debug', endedLine('command'))
    for (const [level, line] of lines) log(level, line)
    return { text }
  }).catch((_, e, next) => next(e))

  // A reload puts the mod into a session that is already running, which raises no session start: the first turn says the settings then.
  on('turn.start', async ($, e, next) => {
    turnStarted(state.pairing)
    // Only a mod with settings it can trust sees the end of the answer (`turn.complete` is past the gate below), so only it marks one running.
    if (config !== undefined) state.answerRunning = true
    state.lastStop = undefined
    const awaited = state.turnWait !== undefined
    const own = startOfTurn(state, e.turnId)
    // A turn is the end of a pause, unless it is the command's own while it writes the handoff. Any other turn meanwhile ends it: a slash
    // command that starts one, or the message held meanwhile, whose turn starts while it is put in (its submit settles once the turn started).
    const over = state.preparing && own ? undefined : endPause($, state, 'a turn started')
    // A turn is work, whoever started it (a finished background task starts one too): no handover in the middle of it.
    const ended = end(countdownIo($, state), state)
    await readLevel($, settings, state)
    await introduce($, settings, state)
    const log = logTo($, state)
    log('trace', `turn.start ${e.turnId}`)
    if (ended) log('debug', endedLine('turn'))
    if (awaited) log('debug', own ? `turn ${e.turnId} is the command's turn` : `turn ${e.turnId} is not the command's turn`)
    if (over !== undefined) log('debug', over)
    return next(e)
  })

  // A mod with settings it cannot trust goes no further: it has said why where the person looks, and answers its command.
  if (config === undefined) return

  // How the session began: a start or a /clear has no conversation, so its first request is the project's baseline.
  on('classic.SessionStart', async ($, e, next) => {
    if (e.agent_id === undefined) {
      state.idle.fresh = e.source === 'startup' || e.source === 'clear'
      state.idle.baselineDue = state.idle.fresh
      state.idle.transcript = e.transcript_path
    }
    return next(e)
  })

  // A change of model says the cache lifetime outright, the one place the host does.
  on('classic.PostModelSwitch', async ($, e, next) => {
    if (e.agent_id === undefined) {
      state.idle.lifetime = e.cache_ttl
      await logPauseOver($, settings, state, endPause($, state, 'a change of model'))
    }
    return next(e)
  })

  // While the handoff is written nobody is there to answer a permission the command's turn asks for: it is turned down, which ends the turn
  // at once (measured), and the mod writes the handoff instead. The mod never grants one, and outside that turn every prompt shows as it is.
  on('classic.PermissionRequest', async ($, e, next) => {
    if (!state.preparing || state.turnWait?.own === undefined || e.agent_id !== undefined) return next(e)
    await readLevel($, settings, state)
    logTo($, state)('debug', `idle: a permission for ${e.tool_name} was turned down while the handoff is written`)
    return { decision: { behavior: 'deny', interrupt: true } }
  })

  // Only for the path of the transcript: the end of the first turn reads it, and may come before the stop. After a reload no session start
  // came to give it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (e.agent_id === undefined) state.idle.transcript = e.transcript_path
    return next(e)
  })

  // Each request of the main loop reads or writes the cache: its start is the touch, taken before the request goes out, which is never too
  // late. The first request of a fresh session gives the baseline. The level is not read here: a read at every request would be a round
  // trip each; the level in force is the one the turn's start read.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) return yield* next(e)
    const idle = state.idle
    // The command's turn writing the handoff reads the cache like any turn, unless that is no longer believed.
    if (!(state.preparing && idle.doubted)) idle.touch = await $.clock.now()
    const r = yield* next(e)
    const against = idle.checkAgainst
    if (against !== undefined && e.index === 0) {
      idle.checkAgainst = undefined
      if (r.usage !== null && !isHit(r.usage, against) && !idle.doubted) {
        idle.doubted = true
        logTo($, state)('warn', 'idle: the request after a warm return missed the cache, the handoff written no longer counts as reading it')
      }
    }
    if (idle.baselineDue && e.index === 0) {
      idle.baselineDue = false
      if (r.usage !== null) await keepBaseline($, state, r.usage)
    }
    return r
  })

  // What is typed while a handoff runs is held, and goes in when it is done. The hold comes first and at once, before any wait: the handoff
  // may end during one, and the input must be judged by the state it was typed in.
  on('prompt.submit', async ($, e, next) => {
    const reason = hold(state, e)
    const handingOver = underWay(state)
    // Only a message that is let through can be the one that comes back after the handoff was written.
    const shown = state.idle.coldShown
    const prepared = reason === undefined && !handingOver ? claim(state, e) : undefined
    if (prepared !== undefined && shown) void $.ui.invalidate('ui.render')
    const ended = end(countdownIo($, state), state)
    await readLevel($, settings, state)
    if (ended) logTo($, state)('debug', endedLine('submit'))
    if (handingOver) logTo($, state)('debug', `input while handing over (${e.origin.kind}): ${reason === undefined ? 'let through' : 'held'}`)
    const dropped = prepared === undefined ? reason : await comeBack($, state, prepared, e)
    return dropped === undefined ? next(e) : { drop: dropped }
  }).catch((_, e, next) => next(e))

  // Watches the calls of the command's turn for the user's decline at the permission prompt, and the first call after a compact for the size
  // it left; changes nothing about the calls, only the mod's own state. Whatever goes wrong here stays here: the call is the host's, and this hook is only a pair of eyes.
  on('tool.call', async ($, e, next) => {
    const out = await next(e)
    try {
      if (noteToolResult(state, e, out)) {
        await readLevel($, settings, state)
        logTo($, state)('debug', "the command's turn: a permission was declined")
      }
    } catch {
      // Not noting it leaves the run as it was before: the fallback follows.
    }
    try {
      if (e.agentId === undefined) await checkAtToolCall($, settings, config, state)
    } catch {
      // A size that cannot be read leaves the compact to the pause, as before.
      await readLevel($, settings, state)
      logTo($, state)('debug', 'could not read the context size at a tool call, the pause judges the compact')
    }
    return out
  })

  // The end of the session (exit, /clear, a resume) ends a countdown: a /clear can come with no edit, submit or turn, from the history.
  on('session.end', async ($, e, next) => {
    await endCountdown($, settings, state, 'session').catch(() => {})
    await endAsap($, settings, state, 'the session ended').catch(() => {})
    state.lastStop = undefined
    state.asapScheduled = false
    // What was known of the session's cache and baseline ends with it; the next session's first turn reads again.
    const over = endPause($, state, 'the session ended')
    state.idle = freshIdle()
    await logPauseOver($, settings, state, over)
    return next(e)
  })

  // A compact the mod did not start ends a countdown too. It raises no session end (the session id stays), no turn and no stop; the
  // context it leaves is unknown at first. Only watched. A precompute only prepares one and changes nothing. The mod's own compact comes
  // after its countdown ran out, and meets none.
  //
  // The countdown ends before the compact runs, so that no handover starts while it does; a compact held back costs it, and the next pause
  // counts down again. The pause and the mark wait for the outcome: another hook can hold the compact back (`{ skip }`), and the host does
  // not try its own compact at minute 54 of a pause again, so a pause ended beforehand would leave the session with no handoff at all. A
  // subagent's compact of its own transcript (`agentId`) leaves the main conversation as it was.
  on('session.compact', async ($, e, next) => {
    if (e.trigger !== 'precompute') await endCountdown($, settings, state, 'compact').catch(() => {})
    if (e.trigger === 'precompute' || e.agentId !== undefined) return next(e)
    const goOn = holdIdle($, config, state)
    const result = await next(e).catch(async (err: unknown) => {
      await goOn().catch(() => {})
      throw err
    })
    if ('skip' in result) {
      await goOn().catch(() => {})
      return result
    }
    // After a compact the context is unknown at first, and nothing would end the mark.
    await logPauseOver($, settings, state, endPause($, state, 'a compact'))
    await endAsap($, settings, state, 'a compact').catch(() => {})
    return result
  })

  // Typing ends a countdown with the button; the other two hand over with the draft, which stays in the prompt. Only the mod's own state
  // changes, and the edit lands as it would without the mod. The button shows unless a survey holds the band.
  on('prompt.edit', async ($, e, next) => {
    const countdown = state.countdown
    if (countdown?.kind === 'button' && typed(e, !countdown.survey)) await endCountdown($, settings, state, 'edit').catch(() => {})
    const out = await next(e)
    // After a sleep the step that shows the band may not have come yet: the typing finds the cache cold first. Never waited for.
    if (state.idle.prepared?.kind === 'real' && !state.idle.coldShown) void checkCold($, settings, state).catch(() => {})
    return out
  })

  // The band above the prompt, while a countdown runs or once the handoff written in a pause has gone cold: drawn from the state alone, so drawing waits on nothing and changes nothing but
  // whether a survey holds the band, which only the drawing sees. A survey has the band while it shows. The first draw measured gave
  // `hasSurvey` as undefined (docs/host-behaviour.md, Commands): that is no survey. The place is shared with every other mod: the band
  // stands on top of what the rest of the chain draws there, never in place of it, so another mod's warning or buttons stay.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const countdown = state.countdown
    if (countdown === undefined) {
      // The band of a handoff gone cold: no key and no countdown, and a survey has the band while it shows.
      if (!state.idle.coldShown || e.props.hasSurvey === true) return next(e)
      const { Box, Text } = $.ui.resolve(e)
      const below = await next(e)
      return (
        <Box flexDirection="column">
          <Box>
            <Text>{COLD_BAND}</Text>
          </Box>
          {below}
        </Box>
      )
    }
    const survey = e.props.hasSurvey === true
    surveyed(countdownIo($, state), state, survey)
    if (survey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const band = bandOf(countdown, e.props.bodyColumns)
    const below = await next(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Text>{band.text}</Text>
          {band.button === undefined ? null : (
            <Button key={NOT_NOW_BUTTON} label={band.button} hotkey={NOT_NOW_KEY} plain onPress={() => void notNow($, settings, state)} />
          )}
        </Box>
        {below}
      </Box>
    )
  })

  on('turn.complete', async ($, e, next) => {
    const main = e.agentId === undefined
    if (main) {
      endSeen(state.pairing, e.reason)
      state.answerRunning = false
    }
    const paired = main ? judgeable(state.pairing) : undefined
    const handingOver = underWay(state)
    await readLevel($, settings, state)
    const log = logTo($, state)
    log('trace', `turn.complete ${e.turnId} ${e.reason}${e.agentId === undefined ? '' : `, agent ${e.agentId}`}`)
    if (!main) log('debug', `agent ${e.agentId}, not a pause`)
    // Passed on after the read: it goes by the turn's own id, which no other event changes, and the handoff it wakes logs after this line.
    if (main && endOfTurn(state, e) === 'foreign') log('debug', `the end of turn ${e.turnId} is not the command's, still waiting for it`)
    // The first turn of a session that ended in an answer, and is none of the mod's own handoff, reads the transcript, and so does each turn
    // after it while the transcript read held no answer yet. With no path seen yet the read waits for a turn that has one.
    if (main && state.idle.read && state.idle.transcript !== undefined && !handingOver && e.reason === 'answer') await readIdle($, state).catch(() => {})
    if (paired !== undefined) await judge($, config, state, paired, handingOver)
    return next(e)
  })

  // The end of an answer. A subagent's end is not a pause of the session, and a turn that did not end in an answer is not one either.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) {
      await readLevel($, settings, state)
      const log = logTo($, state)
      log('trace', `stop, agent ${e.agent_id}`)
      log('debug', `stop of agent ${e.agent_id}, not a pause`)
      return next(e)
    }
    // What runs besides the answer, as this stop reports it: `asap` at rest judges from it until the next turn starts.
    state.lastStop = { background_tasks: e.background_tasks, session_crons: e.session_crons }
    state.idle.transcript = e.transcript_path
    const out = await next(e)
    // Another hook that asks the session to go on has the last word: it is no pause. Nor is the end of the handoff command's own turn.
    const blocked = out.block !== undefined
    const handingOver = underWay(state)
    if (!blocked && !handingOver) stopSeen(state.pairing, e)
    const paired = blocked || handingOver ? undefined : judgeable(state.pairing)
    await readLevel($, settings, state)
    const log = logTo($, state)
    log('trace', 'stop')
    if (paired === undefined) {
      log('debug', blocked ? 'stop blocked by another hook, not a pause' : 'stop while handing over, not a pause')
      return out
    }
    log('debug', 'stop, not handing over')
    await judge($, config, state, paired, handingOver)
    return out
  }).catch((_, e, next) => next(e))
}
