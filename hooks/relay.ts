// What a handoff does to the session: runs the user's command as a turn of its own, waits for the end of that turn, reads the file the
// command wrote, clears the session and submits the handoff as the first message of the new one. When the command gives no handoff, a
// fork of the history writes it instead.

import {
  ASK_FOR_PATH,
  firstMessage,
  FORK_TIMEOUT_MS,
  forkFailure,
  forkKind,
  handoffPath,
  newestHandoff,
  promptFrom,
  promptPath,
  unfit,
  withHeld,
  withoutTrailingSeparator,
  type Entry,
  type ForkAnswer,
} from './handoff'
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
  fork: (prompt: string) => Promise<ForkAnswer>
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

// The stage says how far the handoff got, and so what is left to put right: up to `read`, and at `fork`, nothing has changed in the
// session (`cancelled`: the user's own Esc, not tried another way), `clear` failed before it changed anything, and `submit` failed after it, in the fresh session. `error` is what no stage
// expected. `fork` is the last way tried: its reason carries the reason the command failed first.
export type Failure = { stage: 'command' | 'cancelled' | 'turn' | 'path' | 'read' | 'fork' | 'clear' | 'submit' | 'error'; reason: string }

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

export const endOfTurn = (state: State, e: { turnId: string; answer: string; reason: string }): 'own' | 'foreign' | undefined => {
  const wait = state.turnWait
  if (wait === undefined) return undefined
  if (e.turnId !== wait.own) return 'foreign'
  if (e.reason === 'answer') wait.end({ answer: e.answer })
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
const deliver = async (io: Io, state: State, text: string, file?: string): Promise<Failure | undefined> => {
  const included = state.held.length
  const message = withHeld(text, state.held)
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
    return back === undefined ? failure : joined(failure, `the typing held meanwhile could not be ${back}, \`/context-relay redeliver\` submits it`)
  } catch (err) {
    io.log('warn', `held typing lost, ${typing.length} characters`)
    return joined(failure, `the typing held meanwhile could not be ${back === undefined ? '' : `${back} or `}kept (${why(err)}), it is lost: ${typing}`)
  }
}

// Puts in what is still held, until nothing is left. The last look and the end of holding are one step with no wait between
// them, so that nothing typed in between is held and then forgotten.
const release = async (io: Io, state: State, failure: Failure | undefined): Promise<Failure | undefined> => {
  for (;;) {
    const late = state.held.splice(0)
    if (late.length === 0) {
      state.handingOver = false
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
export const carryOut = async (io: Io, state: State, produce: () => Promise<Failure | undefined>): Promise<Failure | undefined> => {
  // A message pending from an earlier handoff is not this one's: this one's typing must not be added to it.
  const earlier = state.pending
  state.pending = undefined
  let sessionId = 'unknown'
  let failure: Failure | undefined
  try {
    sessionId = await io.sessionId()
    failure = await produce()
  } catch (err) {
    failure = failed('error', why(err))
  }
  failure = await release(io, state, failure)
  state.pending ??= earlier
  await record(io, sessionId, failure)
  return failure
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

const throughCommand = async (io: Io, state: State, command: string): Promise<Failure | undefined> => {
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
  io.log(
    'debug',
    named !== undefined
      ? `the answer names ${named}`
      : `the answer names no file, ${file === undefined ? 'the temp directory has none' : `the temp directory has ${file}`}`,
  )
  if (file === undefined) return failed('path', 'the answer names no handoff file and the temp directory has none from this run')
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
  return deliver(io, state, firstMessage(handoff), file)
}

// `$.model.fork` cannot be cancelled: the wait is limited, and an answer after the limit finds nobody waiting.
const forkWithin = async (io: Io, prompt: string): Promise<ForkAnswer> => {
  let timer: { cancel: () => void } | undefined
  const late = new Promise<ForkAnswer>(resolve => {
    timer = io.after(FORK_TIMEOUT_MS, () => resolve({ isAnswered: false, reason: 'timeout' }))
  })
  try {
    return await Promise.race([io.fork(prompt), late])
  } finally {
    timer?.cancel()
  }
}

// The prompt of the user's own under `~/.claude`, else the one the mod brings: no home directory and no readable file are no failure.
const forkPrompt = async (io: Io): Promise<{ prompt: string; source: string }> => {
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

const throughFork = async (io: Io, state: State): Promise<Failure | undefined> => {
  let answer: ForkAnswer
  const began = await io.now()
  try {
    const { prompt, source } = await forkPrompt(io)
    io.log('debug', `fork asked, ${source}`)
    answer = await forkWithin(io, prompt)
  } catch (err) {
    return failed('fork', `the fork gave no handoff: the fork failed (${why(err)})`)
  }
  const took = `after ${(await io.now()) - began} ms`
  if (answer.isAnswered) io.log('info', `fork answered, ${answer.text.length} characters, ${took}`)
  else io.log('warn', `fork gave nothing (${forkKind(answer)}), ${took}`)
  if (!answer.isAnswered) return failed('fork', `the fork gave no handoff: ${forkFailure(answer)}`)
  if (answer.text.trim() === '') return failed('fork', 'the fork gave no handoff: the fork replied with no text')
  return deliver(io, state, firstMessage(answer.text))
}

// With no command set the fork writes the handoff at once; nothing was tried before, so there is no fallback to report. Otherwise the
// command first. Where it is missing or gives no handoff the session is as it was, and a fork writes the handoff: the change is said
// with its reason, and if the fork gives nothing either the handoff fails with both reasons. A failure at `clear`, `submit` or an
// unexpected one is not a missing handoff and is not tried again another way.
const MISSING: Failure['stage'][] = ['command', 'turn', 'path', 'read']

export const throughChain = async (io: Io, state: State, command: string): Promise<Failure | undefined> => {
  if (command === '') return throughFork(io, state)
  const first = await throughCommand(io, state, command)
  if (first === undefined || !MISSING.includes(first.stage)) return first
  io.tell(fellBackLine(first.reason))
  io.log('warn', `fork fallback (stage ${first.stage})`)
  const second = await throughFork(io, state)
  return second?.stage === 'fork' ? { ...second, reason: `${first.reason}; ${second.reason}` } : second
}
