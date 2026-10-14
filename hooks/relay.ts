// What a handoff does to the session: runs the user's command as a turn of its own, waits for the end of that turn, reads the file the
// command wrote, clears the session and submits the handoff as the first message of the new one. When the command gives no handoff, the
// mod writes it instead (the internal handoff).

import {
  ASK_FOR_PATH,
  COMPACT_CANCELLED,
  USER_REJECTED,
  firstMessage,
  MODEL_FORK_TIMEOUT_MS,
  NEXT_MESSAGE,
  modelForkFailure,
  modelForkKind,
  handoffPath,
  newestHandoff,
  promptFrom,
  promptPath,
  unfit,
  withHeld,
  withoutTrailingSeparator,
  type Entry,
  type ModelForkAnswer,
  type ModelForkUsage,
} from './handoff'
import type { Config, Method } from './config'
import { fellBackLine } from './report'
import type { Level } from './log'
import type { Ended, State } from './state'

// What the flow asks of the session. The host follows `$` only into functions of the file that declares `register`, so the calls on `$`
// are made there and this module gets them as functions.
export type Io = {
  commands: () => Promise<string[]>
  now: () => Promise<number>
  run: (command: string, args?: string) => Promise<unknown>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  readFile: (path: string) => Promise<unknown>
  listDir: (path: string) => Promise<Entry[]>
  tmpdir: () => Promise<string | undefined>
  home: () => Promise<string | undefined>
  modelFork: (prompt: string) => Promise<ModelForkAnswer>
  // Claude Code's own /compact, with no instructions. It resolves with `skip` when a hook vetoed it, and rejects when the host refuses.
  compact: () => Promise<{ skip?: string }>
  // Says a change of way where the person looks.
  tell: (text: string) => void
  // One line of the diagnostic output; shows only at the log level in force.
  log: (level: Exclude<Level, 'off'>, text: string) => void
  submit: (text: string) => Promise<{ drop?: string }>
  sessionId: () => Promise<string>
  // The store outlives the session and a reload; `/clear` does not touch it.
  keep: (key: string, value: unknown) => Promise<void>
  recall: (key: string) => Promise<unknown>
  forget: (key: string) => Promise<void>
}

// The command's turn takes seconds; this is for a turn that never ends, or one held by a permission prompt nobody answers.
const TURN_TIMEOUT_MS = 5 * 60_000

// The stage says how far the handoff got, and so what is left to put right: up to `read`, and at `model-fork`, nothing has changed in the
// session (`cancelled`: the user's own Esc, not tried another way), `clear` failed before it changed anything, and `submit` failed after it, in the fresh session. `error` is what no stage
// expected. `model-fork` is the last way tried: its reason carries the reason the command failed first.
export type Failure = { stage: 'command' | 'cancelled' | 'turn' | 'path' | 'read' | 'model-fork' | 'compact' | 'clear' | 'submit' | 'error'; reason: string }

// How a run ended: with the failure, or with the way that handed over (a redelivery has no way to name).
export type Outcome = { failure: Failure; method?: undefined } | { failure?: undefined; method?: Method }

// A handoff written and not yet handed over: the first message, where the command's file is, and for the internal way when the model was
// asked and what it read.
export type Prepared = { text: string; file?: string; usage?: ModelForkUsage; began?: number }

const failed = (stage: Failure['stage'], reason: string): Failure => ({ stage, reason })

export const why = (err: unknown): string => (err instanceof Error ? err.message : String(err))

// `command.run` settles at once, long before the turn it starts ends: the wait is for that turn's `turn.complete`, which `endOfTurn` passes
// on. Registered before the command runs, so that an end cannot come unseen.
const waitForTurnEnd = (io: Io, state: State) => {
  let timer: { cancel: () => void } | undefined
  const ended = new Promise<Ended>(resolve => {
    const end = (result: Ended) => {
      timer?.cancel()
      state.turnWait = undefined
      resolve(result)
    }
    state.turnWait = { own: undefined, end }
    timer = io.after(TURN_TIMEOUT_MS, () => end({ failure: `the command's turn did not end within ${TURN_TIMEOUT_MS / 60_000} minutes` }))
  })
  return { ended, cancel: () => state.turnWait?.end({ failure: 'cancelled' }) }
}

// Only the end of the command's turn, the first to start after the wait began, is the end awaited; not that of any other turn (a `/loop`
// trigger, a queued prompt), and a turn whose start was not seen cannot be the command's. The turn that raised the handoff has ended
// before the wait begins, since a stop is judged only once its turn has ended. An answer ends the wait with its text; a failed or refused
// turn ends it without one, and an interrupted one ends it as the user's own stop.
export const startOfTurn = (state: State, turnId: string): boolean => {
  const wait = state.turnWait
  if (wait !== undefined && wait.own === undefined) wait.own = turnId
  return wait?.own === turnId
}

// Looks at one finished tool call: the user's decline at the permission prompt in the command's own turn is noted. Which turn is by time: the
// input of `tool.call` carries no turn id, and while `own` is set that turn is the only one that runs. A subagent's calls (`agentId`, also
// from earlier turns still running) are not the user's answer to the command. True when the decline is new.
export const noteToolResult = (state: State, e: { agentId?: string }, out: { isError?: unknown; text?: unknown }): boolean => {
  const wait = state.turnWait
  if (wait === undefined || wait.own === undefined || e.agentId !== undefined || wait.rejected) return false
  if (out.isError !== true || typeof out.text !== 'string' || !out.text.startsWith(USER_REJECTED)) return false
  wait.rejected = true
  return true
}

export const endOfTurn = (state: State, e: { turnId: string; answer: string; reason: string }): 'own' | 'foreign' | undefined => {
  const wait = state.turnWait
  if (wait === undefined) return undefined
  if (e.turnId !== wait.own) return 'foreign'
  if (e.reason === 'answer') wait.end(wait.rejected ? { answer: e.answer, rejected: true } : { answer: e.answer })
  else if (e.reason === 'aborted') wait.end({ failure: "the command's turn was interrupted", cancelled: true })
  else wait.end({ failure: `the command's turn ended without an answer (${e.reason})` })
  return 'own'
}

// The user's command writes the file wherever it likes; when the answer does not say where, it is the newest one in the temp directory.
const newestInTemp = async (io: Io, since: number): Promise<string | undefined> => {
  const dir = withoutTrailingSeparator((await io.tmpdir()) ?? '/tmp')
  const name = newestHandoff(await io.listDir(dir).catch(() => []), since)
  return name === undefined ? undefined : `${dir}/${name}`
}

const FAILURE = 'failure'
const pendingKey = (sessionId: string) => `pending:${sessionId}`

// A hook that drops the message answers with `drop` and does not throw.
const submitChecked = async (io: Io, text: string) => {
  const r = await io.submit(text)
  if (r.drop !== undefined) throw new Error(`a hook dropped it: ${r.drop}`)
}

// Whether the store lets go of the key does not matter for the pointer: with `state.pending` cleared nothing submits it again.
const dropPending = async (io: Io, state: State, key: string) => {
  state.pending = undefined
  state.pendingIn = undefined
  await io.forget(key).catch(() => io.log('debug', 'could not forget the pending message'))
}

const notDelivered = (err: unknown, file?: string): Failure =>
  failed('submit', `the fresh session did not get the handoff (${why(err)})${file === undefined ? '' : `; it is in ${file}`}`)

// The step every way of getting a handoff ends in. `file` is where the text can still be found when the fresh session does not get it.
// The message is kept before `/clear` and until the fresh session has it: it is what `redeliver` submits, and the one place that still has it
// when the submit fails.
const deliver = async (io: Io, state: State, text: string, file?: string, heading?: string): Promise<Failure | undefined> => {
  const included = state.held.length
  const message = withHeld(text, state.held, heading)
  const before = await io.sessionId()
  const key = pendingKey(before)
  await io.keep(key, message)
  state.pending = key
  io.log('info', `clear, session ${before}`)
  try {
    await io.run('clear')
  } catch (err) {
    await dropPending(io, state, key)
    return failed('clear', `/clear failed (${why(err)}), the session is as it was`)
  }
  // The session the host reports once `/clear` has returned (the fresh one, see docs/host-behaviour.md, `/clear` and the session). The same id means `/clear` did nothing, and the
  // handoff would go into the session it was meant to leave.
  const after = await io.sessionId().catch(() => {
    io.log('debug', 'session id unknown after the clear')
    return undefined
  })
  if (after === before) {
    await dropPending(io, state, key)
    return failed('clear', '/clear returned but the session is the same, the session is as it was')
  }
  // From here the held typing up to `included` is in the message, wherever that ends up.
  state.held.splice(0, included)
  state.pendingIn = after
  state.deliveredInto = after
  if (included > 0) io.log('debug', `held inputs in the message: ${included}`)
  io.log('info', `submit, session ${after ?? 'unknown'}, ${message.length} characters`)
  try {
    await submitChecked(io, message)
  } catch (err) {
    return notDelivered(err, file)
  }
  io.log('info', 'submit done')
  await dropPending(io, state, key)
  return undefined
}

// The handoff written in a pause, with the message that came back after it: that message is the first of what is held, so a failure
// before `/clear` puts it into this session like any typing held, and one after keeps it in the message for `redeliver`. Handed over by
// `asap` there is no such message, and what is held is typing like during any handoff.
export const deliverReturn = (io: Io, state: State, prepared: { text: string; file?: string }, withMessage: boolean): Promise<Failure | undefined> =>
  deliver(io, state, prepared.text, prepared.file, withMessage ? NEXT_MESSAGE : undefined)

const joined = (failure: Failure | undefined, note: string): Failure =>
  failure === undefined ? failed('submit', note) : { ...failure, reason: `${failure.reason}; ${note}` }

// Typing that has no place to go is added to the message that is pending, or becomes it.
const park = async (io: Io, state: State, typing: string) => {
  const key = state.pending ?? pendingKey(await io.sessionId())
  const kept = await io.recall(key)
  await io.keep(key, typeof kept === 'string' ? `${kept}\n\n${typing}` : typing)
  state.pending = key
}

// Whatever happens, the typing ends up submitted, kept for `redeliver`, or named in the failure: never gone without a word.
const putIn = async (io: Io, state: State, typing: string, failure: Failure | undefined): Promise<Failure | undefined> => {
  let back: string | undefined
  if (state.pending === undefined) {
    try {
      await submitChecked(io, typing)
      io.log('info', `held typing put in, ${typing.length} characters`)
      return failure
    } catch (err) {
      back = `put back (${why(err)})`
    }
  }
  try {
    await park(io, state, typing)
    io.log('warn', `held typing kept for redelivery, ${typing.length} characters`)
    return back === undefined ? failure : joined(failure, `the typing held meanwhile could not be ${back}, \`/sweet-spot redeliver\` submits it`)
  } catch (err) {
    io.log('warn', `held typing lost, ${typing.length} characters`)
    return joined(failure, `the typing held meanwhile could not be ${back === undefined ? '' : `${back} or `}kept (${why(err)}), it is lost: ${typing}`)
  }
}

// Puts in what is still held, until nothing is left. The last look and the end of holding are one step with no wait between
// them, so that nothing typed in between is held and then forgotten.
// `done` ends the holding: a handover's by default, or the writing of the handoff after a long pause.
export const release = async (
  io: Io,
  state: State,
  failure: Failure | undefined,
  done: () => void = () => {
    state.handingOver = false
  },
): Promise<Failure | undefined> => {
  for (;;) {
    const late = state.held.splice(0)
    if (late.length === 0) {
      done()
      return failure
    }
    failure = await putIn(io, state, late.join('\n\n'), failure)
  }
}

// The reason stays in the store: the line that says it does not survive a `/clear`.
const record = async (io: Io, sessionId: string, failure: Failure | undefined) => {
  try {
    if (failure === undefined) await io.forget(FAILURE)
    else await io.keep(FAILURE, { at: await io.now(), sessionId, ...failure })
  } catch {
    // The line that says the reason is the other copy of it.
    io.log('debug', failure === undefined ? 'could not forget the failure' : 'could not keep the failure')
  }
}

// Runs one way of producing and delivering the handoff, then settles what was held meanwhile and what the failure leaves to put right.
export const carryOut = async (io: Io, state: State, produce: () => Promise<Outcome>): Promise<Outcome> => {
  // A message pending from an earlier handoff is not this one's: this one's typing must not be added to it.
  const earlier = state.pending
  state.pending = undefined
  let sessionId = 'unknown'
  let outcome: Outcome
  try {
    sessionId = await io.sessionId()
    outcome = await produce()
  } catch (err) {
    outcome = { failure: failed('error', why(err)) }
  }
  const failure = await release(io, state, outcome.failure)
  state.pending ??= earlier
  await record(io, sessionId, failure)
  return failure === outcome.failure ? outcome : { failure }
}

const pendingMessage = async (io: Io, state: State): Promise<{ key: string; text: string }> => {
  const key = state.pending
  const text = key === undefined ? undefined : await io.recall(key)
  if (key === undefined || typeof text !== 'string') throw new Error('the message is no longer in the store')
  return { key, text }
}

// Submits again the first message that did not reach the fresh session, into the session as it is: no `/clear`.
export const redeliver = async (io: Io, state: State): Promise<Failure | undefined> => {
  io.log('info', 'redeliver starts')
  const sessionId = await io.sessionId().catch(() => {
    io.log('debug', 'session id unknown at redelivery')
    return 'unknown'
  })
  let failure: Failure | undefined
  try {
    const { key, text } = await pendingMessage(io, state)
    if (state.pendingIn !== undefined && sessionId !== state.pendingIn) throw new Error('the message belongs to another session than this one')
    failure = await submitChecked(io, text).then(() => undefined, notDelivered)
    if (failure === undefined) await dropPending(io, state, key)
  } catch (err) {
    failure = failed('error', why(err))
  }
  await record(io, sessionId, failure)
  io.log('info', `redeliver ends, ${failure === undefined ? 'delivered' : 'not delivered'}`)
  return failure
}

// Runs the user's command and reads the file it wrote; hands nothing over.
export const prepareByCommand = async (io: Io, state: State, command: string): Promise<Prepared | Failure> => {
  // The name is compared whole: `claude-mem:handoff` stands beside `handoff` in the list and is not the user's command.
  if (!(await io.commands()).includes(command)) return failed('command', `the command "${command}" does not exist`)
  io.log('debug', `command "${command}" is listed`)
  const since = await io.now()
  const wait = waitForTurnEnd(io, state)
  try {
    await io.run(command, ASK_FOR_PATH)
    io.log('debug', 'command started, waiting for its turn')
  } catch (err) {
    wait.cancel()
    return failed('command', `the command "${command}" did not start (${why(err)})`)
  }
  const end = await wait.ended
  if ('failure' in end) return failed(end.cancelled ? 'cancelled' : 'turn', end.failure)
  const named = handoffPath(end.answer)
  const file = named ?? (await newestInTemp(io, since))
  io.log('trace', "the command's turn ended")
  // No path in the line: the answer names it, and a log line is copied into bug reports.
  io.log(
    'debug',
    named !== undefined
      ? 'the answer names a file'
      : `the answer names no file, ${file === undefined ? 'the temp directory has none' : 'the temp directory has one'}`,
  )
  if (file === undefined) {
    // No file because the user declined a permission the command asked for: their own stop, not a handoff that is missing.
    if (end.rejected) return failed('cancelled', 'you declined a permission the command asked for')
    return failed('path', 'the answer names no handoff file and the temp directory has none from this run')
  }
  if (named !== undefined) {
    const at = Math.max(named.lastIndexOf('/'), named.lastIndexOf('\\'))
    const entry = (await io.listDir(named.slice(0, at + 1) || '/').catch(() => [])).find(e => e.name === named.slice(at + 1))
    const bad = unfit(entry, named, since)
    if (bad !== undefined) return failed(bad.stage, bad.reason)
  }
  let handoff: unknown
  try {
    handoff = await io.readFile(file)
  } catch (err) {
    return failed('read', `the handoff file could not be read (${why(err)})`)
  }
  if (typeof handoff !== 'string' || handoff.trim() === '') return failed('read', 'the handoff file is empty')
  io.log('debug', `file read, ${handoff.length} characters`)
  return { text: firstMessage(handoff), file }
}

const isFailure = (r: Prepared | Failure): r is Failure => 'stage' in r

const throughCommand = async (io: Io, state: State, command: string): Promise<Failure | undefined> => {
  const r = await prepareByCommand(io, state, command)
  return isFailure(r) ? r : deliver(io, state, r.text, r.file)
}

// A `$.model.fork` call cannot be cancelled: the wait is limited. After the timeout it keeps running in the background and its late
// answer reaches no one, which is harmless.
const modelForkWithin = async (io: Io, prompt: string): Promise<ModelForkAnswer> => {
  let timer: { cancel: () => void } | undefined
  const late = new Promise<ModelForkAnswer>(resolve => {
    timer = io.after(MODEL_FORK_TIMEOUT_MS, () => resolve({ isAnswered: false, reason: 'timeout' }))
  })
  try {
    return await Promise.race([io.modelFork(prompt), late])
  } finally {
    timer?.cancel()
  }
}

// The prompt of the user's own under `~/.claude`, else the one the mod brings: no home directory and no readable file are no failure.
const internalHandoffPrompt = async (io: Io): Promise<{ prompt: string; source: string }> => {
  try {
    const home = await io.home()
    if (home === undefined) return { prompt: promptFrom(undefined), source: "the mod's own prompt" }
    const file = promptPath(home)
    const text = await io.readFile(file)
    const prompt = promptFrom(text)
    return { prompt, source: prompt === promptFrom(undefined) ? "the mod's own prompt" : `prompt from ${file}` }
  } catch {
    return { prompt: promptFrom(undefined), source: "the mod's own prompt" }
  }
}

// Asks the model for the handoff; hands nothing over.
export const prepareInternally = async (io: Io): Promise<Prepared | Failure> => {
  let answer: ModelForkAnswer
  const began = await io.now()
  try {
    const { prompt, source } = await internalHandoffPrompt(io)
    io.log('debug', `internal handoff asked, ${source}`)
    answer = await modelForkWithin(io, prompt)
  } catch (err) {
    return failed('model-fork', `the mod could not write the handoff: writing the handoff failed (${why(err)})`)
  }
  const took = `after ${(await io.now()) - began} ms`
  if (answer.isAnswered) io.log('info', `internal handoff answered, ${answer.text.length} characters, ${took}`)
  else io.log('warn', `internal handoff gave nothing (${modelForkKind(answer)}), ${took}`)
  if (!answer.isAnswered) return failed('model-fork', `the mod could not write the handoff: ${modelForkFailure(answer)}`)
  if (answer.text.trim() === '') return failed('model-fork', 'the mod could not write the handoff: the model replied with no text')
  return answer.usage === undefined ? { text: firstMessage(answer.text), began } : { text: firstMessage(answer.text), usage: answer.usage, began }
}

// The handoff written ahead in a long pause: by the user's command when that is the way, else by the mod. A compact is never used, since a
// warm return must find the whole context, and `throughMethods` is not either: whatever the command's failure, it has changed nothing but
// add its own turn, so the mod writes the handoff unless the fallback is none.
export const prepare = async (io: Io, state: State, config: Config): Promise<Prepared | Failure> => {
  if (config.handoffMethod !== 'external-command') return prepareInternally(io)
  const first = await prepareByCommand(io, state, config.handoffCommand)
  if (!isFailure(first) || config.handoffFallback === 'none') return first
  io.log('warn', `idle: the command gave no handoff (stage ${first.stage}), the mod writes it`)
  const second = await prepareInternally(io)
  return isFailure(second) ? { ...second, reason: `${first.reason}; ${second.reason}` } : second
}

const throughInternalHandoff = async (io: Io, state: State): Promise<Failure | undefined> => {
  const r = await prepareInternally(io)
  return isFailure(r) ? r : deliver(io, state, r.text)
}

// The session stays and only gets smaller: nothing is cleared, nothing is submitted, and nothing is left for `redeliver`. Called directly: the
// host refuses a compact from inside the stop, and the mod judges only once the stop and the end of its turn are both in, with the stop
// first (measured, 10 of 10 turns), so this runs from the end of the turn. If the end of a turn ever came before the stop, the host would
// refuse, which is a failure at stage `compact` like any other, and the fallback takes over.
const throughBuiltinCompact = async (io: Io, state: State): Promise<Failure | undefined> => {
  // A compact that left the context above the threshold fails before it is asked: it would do the same again.
  if (state.compactCheck?.kind === 'insufficient') return failed('compact', 'the last compact left the context above the threshold')
  const began = await io.now()
  io.log('debug', 'compact asked')
  let result: { skip?: string }
  try {
    result = await io.compact()
  } catch (err) {
    // Esc is the user's own stop: no other way hands over after it. The reason is in the refusal's words, which the log never carries.
    if (why(err).includes(COMPACT_CANCELLED)) return failed('cancelled', 'you canceled the compact')
    io.log('warn', 'compact refused')
    return failed('compact', `compact was refused (${why(err)})`)
  }
  if (result.skip !== undefined) {
    io.log('warn', 'compact skipped')
    return failed('compact', `compact was skipped (${result.skip})`)
  }
  io.log('info', `compacted, after ${(await io.now()) - began} ms`)
  return undefined
}

// The main method first. Where it fails before it changed the session, the fallback is tried: the change is said with its reason, and if
// the fallback fails as well, the handoff fails with both reasons. A failure after the session changed (`submit`), the user's own stop
// (`cancelled`) and what no stage expected (`error`) are not tried another way.
// The stages after which the session is as it was: one list, for the first failure and the second.
const FALLBACK_STAGES: Failure['stage'][] = ['command', 'turn', 'path', 'read', 'model-fork', 'compact', 'clear']

// Whether a way ends in `/clear`: a failure at `/clear` leaves a fallback that needs it nothing to try.
const NEEDS_CLEAR: Record<Method, boolean> = { 'external-command': true, 'internal-handoff': true, 'builtin-compact': false }

const through = (io: Io, state: State, config: Config, method: Method): Promise<Failure | undefined> =>
  ({
    'external-command': () => throughCommand(io, state, config.handoffCommand),
    'internal-handoff': () => throughInternalHandoff(io, state),
    'builtin-compact': () => throughBuiltinCompact(io, state),
  })[method]()

// `configOf` has turned the same way in both settings into `none`, so the fallback is a different way here.
export const throughMethods = async (io: Io, state: State, config: Config): Promise<Outcome> => {
  const first = await through(io, state, config, config.handoffMethod)
  if (first === undefined) return { method: config.handoffMethod }
  const fallback = config.handoffFallback
  if (fallback === 'none' || !FALLBACK_STAGES.includes(first.stage)) return { failure: first }
  if (first.stage === 'clear' && NEEDS_CLEAR[fallback]) return { failure: { ...first, reason: `${first.reason}; the fallback needs /clear too` } }
  io.tell(fellBackLine(first.reason, config.handoffMethod, fallback))
  io.log('warn', `fallback to ${fallback} (stage ${first.stage})`)
  const second = await through(io, state, config, fallback)
  if (second === undefined) return { method: fallback }
  return { failure: FALLBACK_STAGES.includes(second.stage) ? { ...second, reason: `${first.reason}; ${second.reason}` } : second }
}
