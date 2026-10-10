import type { EngineInterface as Engine, Register } from 'claude-code'

import { configOf, type Config, type ConfigResult } from './config'
import { activeTasks, brakeOf, decide, effectiveThreshold, oneShots, type Decision } from './decide'
import { hold } from './hold'
import { logger, refresh, shows } from './log'
import { carryOut, endOfTurn, redeliver, startOfTurn, throughChain, why, type Failure, type Io } from './relay'
import {
  HANDED_OVER,
  HANDOFF_UNDER_WAY,
  NOTHING_TO_REDELIVER,
  REDELIVER_UNDER_WAY,
  REDELIVERING,
  REDELIVERED,
  usageFor,
  CANCELLED,
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

// The log level, read afresh at the start of every handler (see `refresh`). The host wants the variable's name as a literal at the call.
// Each change to a level that shows `info` is marked with the settings in force, so that a log turned on halfway through a session says
// them too, and shows from where on its finer lines start. Settings the mod rejects have their own line, said where the person looks.
const readLevel = async ($: Engine, settings: ConfigResult, state: State) => {
  const before = await refresh(() => $.env.get('CONTEXT_RELAY_LOG_LEVEL'), toLog($), state)
  if (!settings.ok || state.logLevel === before || !shows(state.logLevel, 'info')) return
  const c = settings.config
  logTo($, state)(
    'info',
    `settings: threshold ${c.threshold}, dry_run ${c.dryRun ? 'on' : 'off'}, min gap ${c.minGapMinutes} minutes and ${c.minGapTurns} turns, handoff command ${commandShown(c.handoffCommand)}, log level ${state.logLevel}`,
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
  fork: async prompt => {
    const r = await $.model.fork({ prompt })
    return r.isAnswered ? { isAnswered: true, text: r.text } : { isAnswered: false, reason: r.reason, ...('status' in r ? { status: r.status } : {}) }
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
const COMMAND = 'context-relay'

const registerCommand = async ($: Engine, state: State) => {
  try {
    await $.command.register({ name: COMMAND, description: 'Submit again the handoff that did not reach the fresh session', argumentHint: 'redeliver' })
  } catch (err) {
    say($, unregisteredLine(why(err)))
    logTo($, state)('warn', 'could not register the command')
  }
}

// Says how a run ended. Whatever goes wrong ends here as a line, never as an error into the host. The log names the stage, not the
// reason: that can carry paths, the host's words and what was typed.
const settle = async ($: Engine, state: State, run: { name: 'handoff' | 'redelivery'; done: string }, carry: () => Promise<Failure | undefined>) => {
  const log = logTo($, state)
  try {
    const failure = await carry()
    if (failure === undefined) say($, run.done)
    else if (failure.stage === 'cancelled') {
      say($, CANCELLED)
      log('info', `${run.name} cancelled`)
    } else {
      say($, failedLine(failure.reason))
      log('warn', `${run.name} failed (stage ${failure.stage})`)
    }
  } catch (err) {
    say($, failedLine(why(err)))
    log('warn', `${run.name} failed (unexpected error)`)
  }
}

// The submit waits for the session to be idle, so it is not waited for in the command: the command answers at once.
const redeliverLater = async ($: Engine, state: State) => {
  try {
    await settle($, state, { name: 'redelivery', done: REDELIVERED }, () => redeliver(sessionIo($, state), state))
  } finally {
    state.redelivering = false
  }
}

// Without usable settings (`config` undefined) the mod never handed anything over, so there is nothing to redeliver.
const commandText = ($: Engine, config: Config | undefined, args: string, state: State): string => {
  if (args.trim() !== 'redeliver') return usageFor(args)
  if (state.handingOver) return HANDOFF_UNDER_WAY
  if (state.redelivering) return REDELIVER_UNDER_WAY
  if (state.pending === undefined || config === undefined) return NOTHING_TO_REDELIVER
  state.redelivering = true
  $.clock.after(0, () => void redeliverLater($, state))
  return REDELIVERING
}

// Runs the handoff to its end and says how it went.
const handoff = async ($: Engine, config: Config, state: State, tokens: number) => {
  const io = sessionIo($, state)
  io.log('info', `handoff starts, command ${commandShown(config.handoffCommand)}`)
  try {
    await settle($, state, { name: 'handoff', done: HANDED_OVER }, async () => {
      const failure = await carryOut(io, state, () => throughChain(io, state, config.handoffCommand))
      if (failure === undefined) state.afterHandoff = { before: tokens, pauses: 0 }
      return failure
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
  say($, reportOf(decision))
  state.handingOver = true
  state.held = []
  $.clock.after(0, () => void handoff($, config, state, decision.tokens))
}

// The pauses after a handoff that are logged against the context it left: enough to see where the fresh session starts and how it grows.
const AFTER_HANDOFF_PAUSES = 3

// The account's windows as the status line shows them; none off a subscription, and then the line has nothing of it.
const limitsOf = (limits: readonly { kind: string; percentUsed: number }[]): string =>
  limits.length === 0 ? '' : `, limits ${limits.map(l => `${l.kind} ${l.percentUsed}%`).join(', ')}`

const atPause = async ($: Engine, e: Stop, config: Config, state: State) => {
  const [{ context, rateLimits }, agents, turns, now] = await Promise.all([$.session.usage(), $.agent.list(), $.session.turns(), $.clock.now()])
  const snapshot = {
    tokens: context.tokens,
    window: context.window,
    backgroundTasks: activeTasks(e.background_tasks),
    oneShotTimers: oneShots(e.session_crons),
    subagents: agents.filter(a => a.status === 'running').length,
    now,
    turns,
    lastAttempt: state.lastAttempt,
  }
  const log = logTo($, state)
  const fresh = state.afterHandoff
  if (fresh !== undefined && fresh.pauses < AFTER_HANDOFF_PAUSES && snapshot.tokens !== undefined && snapshot.tokens < fresh.before) {
    fresh.pauses += 1
    log('debug', `after handoff: context ${snapshot.tokens} tokens (${fresh.before} before the handoff), pause ${fresh.pauses}`)
  }
  const decision = decide(snapshot, config)
  const threshold = effectiveThreshold(config.threshold, snapshot.window)
  log(
    'info',
    `pause: context ${snapshot.tokens} of ${snapshot.window} tokens (threshold ${threshold}, brake ${brakeOf(threshold, snapshot.window)}), ${snapshot.backgroundTasks} background tasks, ${snapshot.oneShotTimers} timers, ${snapshot.subagents} subagents, turn ${turns}, ${state.lastAttempt === undefined ? 'no attempt before' : `last attempt at turn ${state.lastAttempt.turns}`}${limitsOf(rateLimits)}, decided ${decision.kind}${decision.kind === 'defer' ? ` (${decision.reason})` : ''}${'forced' in decision && decision.forced !== undefined ? `, forced past the brake by ${decision.forced}` : ''}`,
  )
  if (decision.kind === 'none') {
    state.said = undefined
    return
  }
  if (decision.kind === 'defer') {
    sayOnce($, state, decision.reason, reportOf(decision))
    return
  }
  // A dry run counts as an attempt too: it shows the pace the real run would keep.
  state.said = undefined
  state.lastAttempt = { at: now, turns }
  if (decision.kind === 'act') handOver($, decision, config, state)
  else say($, reportOf(decision))
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
    const text = commandText($, config, e.args, state)
    await readLevel($, settings, state)
    return { text }
  }).catch((_, e, next) => next(e))

  // A reload puts the mod into a session that is already running, which raises no session start: the first turn says the settings then.
  on('turn.start', async ($, e, next) => {
    turnStarted(state.pairing)
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

  on('turn.complete', async ($, e, next) => {
    const main = e.agentId === undefined
    if (main) endSeen(state.pairing, e.reason)
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
