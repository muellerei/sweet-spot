import type { EngineInterface as Engine, Register } from 'claude-code'

import { configOf, type Config, type ConfigResult } from './config'
import { activeTasks, brakeOf, decide, effectiveThreshold, laterAt, oneShots, thresholdInForce, type Decision } from './decide'
import { hold } from './hold'
import { LATER_OVER, laterFor, tokensOf } from './later'
import { checkOf, firstMethod, judgedLine } from './compact-check'
import { logger, refresh, shows, type Level } from './log'
import { carryOut, endOfTurn, noteToolResult, redeliver, startOfTurn, throughMethods, why, type Failure, type Io, type Outcome } from './relay'
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
  CONTEXT_UNKNOWN,
  contextUnreadLine,
  failedLine,
  offLine,
  reportOf,
  unreadLine,
  unregisteredLine,
} from './report'
import { endSeen, judgeable, stopSeen, turnStarted, type Stop } from './pairing'
import { freshState, type State } from './state'

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
    `settings: threshold ${c.threshold}, dry_run ${c.dryRun ? 'on' : 'off'}, min gap ${c.minGapMinutes} minutes and ${c.minGapTurns} turns, later_tokens ${c.laterTokens}, countdown_seconds ${c.countdownSeconds}, method ${c.handoffMethod}, fallback ${c.handoffFallback}${usesCommand(c) ? `, handoff command ${commandShown(c.handoffCommand)}` : ''}, log level ${state.logLevel}`,
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
    return r.isAnswered ? { isAnswered: true, text: r.text } : { isAnswered: false, reason: r.reason, ...('status' in r ? { status: r.status } : {}) }
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

// The message about invalid settings and the command, once per load: at the session start, or at the first turn of a session that was already running.
const introduce = async ($: Engine, settings: ConfigResult, state: State) => {
  if (state.introduced) return
  state.introduced = true
  announce($, settings, state)
  await registerCommand($, state)
}

// The one command of the mod; what it does is the word after it.
const COMMAND = 'sweet-spot'

const registerCommand = async ($: Engine, state: State) => {
  try {
    // Immediate: a command typed while an answer runs would otherwise wait until the pause that ends the answer has been judged
    // (docs/host-behaviour.md, Commands).
    await $.command.register({
      name: COMMAND,
      description: 'Move the next handover back, or submit again the handoff that did not reach the fresh session',
      argumentHint: 'redeliver | later [tokens]',
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
  if (state.handingOver) return HANDOFF_UNDER_WAY
  if (state.answerRunning) return ANSWER_RUNNING
  if (state.redelivering) return REDELIVER_UNDER_WAY
  if (state.pending === undefined || config === undefined) return NOTHING_TO_REDELIVER
  state.redelivering = true
  $.clock.after(0, () => void runRedelivery($, state))
  return REDELIVERING
}

// What the command answers, and the diagnostic lines about it, which its handler writes after its read of the log level. A line never
// holds what was typed.
type Answer = { text: string; lines?: [Exclude<Level, 'off'>, string][] }

const turnedDown = (text: string, why: string): Answer => ({ text, lines: [['debug', `later: turned down, ${why}`]] })

// Moves the next handover back. It needs the context at the time it is typed, so its answer waits for that read.
const laterText = async ($: Engine, settings: ConfigResult, rest: string, state: State): Promise<Answer> => {
  const asked = tokensOf(rest)
  if ('error' in asked) return turnedDown(asked.error, 'not a number of tokens')
  if (!settings.ok) return turnedDown(offLine(settings.errors), 'the settings are rejected')
  if (state.handingOver) return turnedDown(HANDOFF_UNDER_WAY, 'a handover is in progress')
  // The command answers whatever goes wrong with the read; the hook's `.catch` would only pass the error to the host.
  let context: { tokens?: number; window: number }
  try {
    context = (await $.session.usage()).context
  } catch (err) {
    return { text: contextUnreadLine(why(err)), lines: [['warn', 'later: could not read the context size']] }
  }
  // A pause may have started a handover during the read: a later handover set beside it would come too late for it and hold on in the
  // fresh session.
  if (state.handingOver) return turnedDown(HANDOFF_UNDER_WAY, 'a handover is in progress')
  if (context.tokens === undefined) return turnedDown(CONTEXT_UNKNOWN, 'the context size is unknown')
  const config = settings.config
  const result = laterFor(config, context.window, context.tokens, state.later, asked.tokens === 'setting' ? config.laterTokens : asked.tokens)
  state.later = result.later
  return { text: result.text, lines: result.lines.map(line => ['debug', line]) }
}

// What the command does is the word after it. `later` takes an argument, so the rest is its argument; `redeliver` takes none.
const commandText = ($: Engine, settings: ConfigResult, args: string, state: State): Promise<Answer> | Answer => {
  const words = args.trim()
  const verb = words.split(/\s/, 1)[0]
  if (verb === 'later') return laterText($, settings, words.slice(verb.length), state)
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
const handOver = ($: Engine, decision: Extract<Decision, { kind: 'act' }>, config: Config, state: State) => {
  // Without a first way (a compact that was not enough, and no fallback) there is nothing to announce: the run fails at the mark.
  const first = firstMethod(config, state)
  if (first !== undefined) say($, reportOf(decision, first))
  state.handingOver = true
  state.held = []
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

const atPause = async ($: Engine, e: Stop, config: Config, state: State) => {
  const [{ context, rateLimits }, agents, turns, now] = await Promise.all([$.session.usage(), $.agent.list(), $.session.turns(), $.clock.now()])
  // A context below where `later` was asked has shrunk (a compact, /clear): the later handover is over before `decide` judges.
  const kept = laterAt(state.later, context.tokens)
  const over = state.later !== undefined && kept === undefined
  state.later = kept
  const snapshot = {
    tokens: context.tokens,
    window: context.window,
    backgroundTasks: activeTasks(e.background_tasks),
    oneShotTimers: oneShots(e.session_crons),
    subagents: agents.filter(a => a.status === 'running').length,
    now,
    turns,
    lastAttempt: state.lastAttempt,
    later: state.later,
  }
  const log = logTo($, state)
  if (over) log('debug', LATER_OVER)
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
    `pause: context ${snapshot.tokens} of ${snapshot.window} tokens (threshold ${threshold}${state.later === undefined ? '' : `, later ${thresholdInForce(config.threshold, snapshot.window, state.later)}`}, brake ${brakeOf(threshold, snapshot.window)}), ${snapshot.backgroundTasks} background tasks, ${snapshot.oneShotTimers} timers, ${snapshot.subagents} subagents, turn ${turns}, ${state.lastAttempt === undefined ? 'no attempt before' : `last attempt at turn ${state.lastAttempt.turns}`}${limitsOf(rateLimits)}, decided ${decision.kind}${decision.kind === 'defer' ? ` (${decision.reason})` : ''}${'forced' in decision && decision.forced !== undefined ? `, forced past the brake by ${decision.forced}` : ''}`,
  )
  if (decision.kind === 'none') {
    state.said = undefined
    return
  }
  const report = () => reportOf(decision, firstMethod(config, state) ?? config.handoffMethod)
  if (decision.kind === 'defer') {
    sayOnce($, state, decision.reason, report())
    return
  }
  // A dry run counts as an attempt too: it shows the pace the real run would keep.
  state.said = undefined
  state.lastAttempt = { at: now, turns }
  // `later` held for this handover, whether it goes through or not: the next one comes at the threshold.
  if (state.later !== undefined) log('debug', 'later: spent by this handover')
  state.later = undefined
  if (decision.kind === 'act') handOver($, decision, config, state)
  else say($, report())
}

// The stop is a hook the turn waits on and can only be asked to go on: an error here is said once and the stop ends as if the mod were absent.
const atPauseOrSay = async ($: Engine, e: Stop, config: Config, state: State) => {
  try {
    await atPause($, e, config, state)
  } catch (err) {
    const line = unreadLine(why(err))
    if (sayOnce($, state, line, line)) logTo($, state)('warn', 'could not check for a handoff')
  }
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
    await atPauseOrSay($, paired.stop, config, state)
  } else log('debug', `judge: the turn ended in ${paired.end}, no pause`)
}

export const register: Register = (on, options) => {
  const settings = configOf(options)
  const config = settings.ok ? settings.config : undefined
  const state = freshState()

  // Every handler reads the log level, each on its own: a value changed in a settings file reaches the host at the next turn. The read is a
  // wait, and two handlers' reads need not come back in the order they went out, so a handler changes the state before it reads, as it
  // would with no read at all, and logs after.
  on('session.start', async ($, e, next) => {
    await readLevel($, settings, state)
    await introduce($, settings, state)
    return next(e)
  })

  // The redelivery's timer runs outside any handler; its lines come after its own waits, by when the read here is in.
  on('command.run', { command: COMMAND }, async ($, e) => {
    const { text, lines = [] } = await commandText($, settings, e.args, state)
    await readLevel($, settings, state)
    const log = logTo($, state)
    for (const [level, line] of lines) log(level, line)
    return { text }
  }).catch((_, e, next) => next(e))

  // A reload puts the mod into a session that is already running, which raises no session start: the first turn says the settings then.
  on('turn.start', async ($, e, next) => {
    turnStarted(state.pairing)
    // Only a mod with settings it can trust sees the end of the answer (`turn.complete` is past the gate below), so only it marks one running.
    if (config !== undefined) state.answerRunning = true
    const awaited = state.turnWait !== undefined
    const own = startOfTurn(state, e.turnId)
    await readLevel($, settings, state)
    await introduce($, settings, state)
    const log = logTo($, state)
    log('trace', `turn.start ${e.turnId}`)
    if (awaited) log('debug', own ? `turn ${e.turnId} is the command's turn` : `turn ${e.turnId} is not the command's turn`)
    return next(e)
  })

  // A mod with settings it cannot trust goes no further: it has said why where the person looks, and answers its command.
  if (config === undefined) return

  // What is typed while a handoff runs is held, and goes in when it is done. The hold comes first and at once, before any wait: the handoff
  // may end during one, and the input must be judged by the state it was typed in.
  on('prompt.submit', async ($, e, next) => {
    const reason = hold(state, e)
    const handingOver = state.handingOver
    await readLevel($, settings, state)
    if (handingOver) logTo($, state)('debug', `input while handing over (${e.origin.kind}): ${reason === undefined ? 'let through' : 'held'}`)
    return reason === undefined ? next(e) : { drop: reason }
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

  on('turn.complete', async ($, e, next) => {
    const main = e.agentId === undefined
    if (main) {
      endSeen(state.pairing, e.reason)
      state.answerRunning = false
    }
    const paired = main ? judgeable(state.pairing) : undefined
    const handingOver = state.handingOver
    await readLevel($, settings, state)
    const log = logTo($, state)
    log('trace', `turn.complete ${e.turnId} ${e.reason}${e.agentId === undefined ? '' : `, agent ${e.agentId}`}`)
    if (!main) log('debug', `agent ${e.agentId}, not a pause`)
    // Passed on after the read: it goes by the turn's own id, which no other event changes, and the handoff it wakes logs after this line.
    if (main && endOfTurn(state, e) === 'foreign') log('debug', `the end of turn ${e.turnId} is not the command's, still waiting for it`)
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
    const out = await next(e)
    // Another hook that asks the session to go on has the last word: it is no pause. Nor is the end of the handoff command's own turn.
    const blocked = out.block !== undefined
    const handingOver = state.handingOver
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
