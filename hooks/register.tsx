import type { EngineInterface as Engine, Register } from 'claude-code'

import { configOf, type Config, type ConfigResult } from './config'
import { activeTasks, brakeOf, decide, effectiveThreshold, oneShots, type Decision } from './decide'
import { hold } from './hold'
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

// One line per event, for finding out why a handoff did or did not happen. It goes to the transcript, where the host stamps the time.
const trace = ($: Engine, config: Config | undefined, text: string) => {
  if (config?.trace) $.ui.log(`trace: ${text}`)
}

// An empty name is no command of the user's own: shown as `none`, not as an empty quote.
const commandShown = (name: string) => (name === '' ? 'none' : `"${name}"`)

const announce = ($: Engine, settings: ConfigResult) => {
  if (settings.ok) {
    const c = settings.config
    $.ui.log(
      `settings: threshold ${c.threshold}, dry_run ${c.dryRun ? 'on' : 'off'}, min gap ${c.minGapMinutes} minutes and ${c.minGapTurns} turns, handoff command ${commandShown(c.handoffCommand)}, trace ${c.trace ? 'on' : 'off'}`,
      { to: 'debug' },
    )
  } else {
    say($, offLine(settings.errors))
  }
}

const sessionIo = ($: Engine, config: Config): Io => ({
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
  trace: text => trace($, config, text),
  submit: text => $.prompt.submit({ text }),
  sessionId: () => $.session.id(),
  keep: (key, value) => $.store.set(key, value),
  recall: key => $.store.get(key),
  forget: key => $.store.delete(key),
})

// The settings line and the command, once per load: at the session start, or at the first turn of a session that was already running.
const introduce = async ($: Engine, settings: ConfigResult, state: State) => {
  if (state.introduced) return
  state.introduced = true
  announce($, settings)
  await registerCommand($)
}

// The one command of the mod; what it does is the word after it.
const COMMAND = 'context-relay'

const registerCommand = async ($: Engine) => {
  try {
    await $.command.register({ name: COMMAND, description: 'Submit again the handoff that did not reach the fresh session', argumentHint: 'redeliver' })
  } catch (err) {
    say($, unregisteredLine(why(err)))
  }
}

// Says how a run ended. Whatever goes wrong ends here as a line, never as an error into the host.
const settle = async ($: Engine, done: string, run: () => Promise<Failure | undefined>) => {
  try {
    const failure = await run()
    say($, failure === undefined ? done : failure.stage === 'cancelled' ? CANCELLED : failedLine(failure.reason))
  } catch (err) {
    say($, failedLine(why(err)))
  }
}

// The submit waits for the session to be idle, so it is not waited for in the command: the command answers at once.
const redeliverLater = async ($: Engine, config: Config, state: State) => {
  try {
    await settle($, REDELIVERED, () => redeliver(sessionIo($, config), state))
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
  $.clock.after(0, () => void redeliverLater($, config, state))
  return REDELIVERING
}

// Runs the handoff to its end and says how it went.
const handoff = async ($: Engine, config: Config, state: State, tokens: number) => {
  const io = sessionIo($, config)
  io.trace(`handoff starts, command ${commandShown(config.handoffCommand)}`)
  try {
    await settle($, HANDED_OVER, async () => {
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
const sayOnce = ($: Engine, state: State, key: string, text: string) => {
  if (state.said === key) return
  state.said = key
  say($, text)
}

// `act` comes only with the dry run off. It starts the handoff after the stop has returned: the stop is a hook the turn waits on, and the
// command is a turn of its own that would wait on this one.
const handOver = ($: Engine, decision: Extract<Decision, { kind: 'act' }>, config: Config, state: State) => {
  say($, reportOf(decision))
  state.handingOver = true
  state.held = []
  $.clock.after(0, () => void handoff($, config, state, decision.tokens))
}

// The pauses after a handoff that are traced against the context it left: enough to see where the fresh session starts and how it grows.
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
  const fresh = state.afterHandoff
  if (fresh !== undefined && fresh.pauses < AFTER_HANDOFF_PAUSES && snapshot.tokens !== undefined && snapshot.tokens < fresh.before) {
    fresh.pauses += 1
    trace($, config, `after handoff: context ${snapshot.tokens} tokens (${fresh.before} before the handoff), pause ${fresh.pauses}`)
  }
  const decision = decide(snapshot, config)
  const threshold = effectiveThreshold(config.threshold, snapshot.window)
  trace(
    $,
    config,
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
    sayOnce($, state, line, line)
  }
}

// This is the one place that judges, once the stop and the end of its turn are both in; a stop whose turn ended otherwise is dropped.
const judge = async ($: Engine, config: Config, state: State) => {
  const paired = judgeable(state.pairing)
  if ('waitingFor' in paired) {
    trace($, config, `judge: waiting for ${paired.waitingFor}`)
    return
  }
  if (!state.handingOver && paired.end === 'answer') {
    trace($, config, 'judge: the stop and the end of the turn are both in, the turn ended in answer')
    await atPauseOrSay($, paired.stop, config, state)
  } else trace($, config, `judge: the turn ended in ${paired.end}, no pause`)
}

export const register: Register = (on, options) => {
  const settings = configOf(options)
  const config = settings.ok ? settings.config : undefined
  const state = freshState()

  on('session.start', async ($, e, next) => {
    await introduce($, settings, state)
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => ({ text: commandText($, config, e.args, state) })).catch((_, e, next) => next(e))

  // A reload puts the mod into a session that is already running, which raises no session start: the first turn says the settings then.
  on('turn.start', async ($, e, next) => {
    await introduce($, settings, state)
    turnStarted(state.pairing)
    const awaited = state.turnWait !== undefined
    const own = startOfTurn(state, e.turnId)
    state.mainTurnId = e.turnId
    trace($, config, `turn.start ${e.turnId}`)
    if (awaited) trace($, config, own ? `turn ${e.turnId} is the command's turn` : `turn ${e.turnId} is not the command's turn`)
    return next(e)
  })

  // A mod with settings it cannot trust goes no further: it has said why where the person looks, and answers its command.
  if (config === undefined) return

  // What is typed while a handoff runs is held, and goes in when it is done.
  on('prompt.submit', async ($, e, next) => {
    const reason = hold(state, e)
    if (state.handingOver) trace($, config, `input while handing over (${e.origin.kind}): ${reason === undefined ? 'let through' : 'held'}`)
    return reason === undefined ? next(e) : { drop: reason }
  }).catch((_, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    trace($, config, `turn.complete ${e.turnId} ${e.reason}${e.agentId === undefined ? '' : `, agent ${e.agentId}, not a pause`}`)
    if (e.agentId === undefined) {
      endSeen(state.pairing, e.reason)
      if (endOfTurn(state, e) === 'foreign') trace($, config, `the end of turn ${e.turnId} is not the command's, still waiting for it`)
      state.mainTurnId = e.turnId
      await judge($, config, state)
    }
    return next(e)
  })

  // The end of an answer. A subagent's end is not a pause of the session, and a turn that did not end in an answer is not one either.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) {
      trace($, config, `stop of agent ${e.agent_id}, not a pause`)
      return next(e)
    }
    const out = await next(e)
    // Another hook that asks the session to go on has the last word: it is no pause. Nor is the end of the handoff command's own turn.
    if (out.block !== undefined || state.handingOver) {
      trace($, config, out.block !== undefined ? 'stop blocked by another hook, not a pause' : 'stop while handing over, not a pause')
      return out
    }
    trace($, config, 'stop, not handing over')
    stopSeen(state.pairing, e)
    await judge($, config, state)
    return out
  }).catch((_, e, next) => next(e))
}
