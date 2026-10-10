// The parts of a handoff through the user's own command that need no session: what to ask, where the file is, what the first message says.

// The mod hands over at a size limit and not at the end of a piece of work, so the work is often in the middle of a task.
const MID_TASK =
  'This session is handed over because its context is large, often in the middle of a task. Cover everything the current task needs to carry on without reading it all again: the state of the work, the next step, the files it touches by path with what matters in each, and the decisions still open.'

// The command prints no path by itself; this is the request it gets as its argument: what the handoff has to cover, and the path line.
export const ASK_FOR_PATH = `${MID_TASK} End your final answer with one line: HANDOFF_PATH: <absolute path>`

const LINE = /^[\s>*_-]*HANDOFF_PATH:[ \t]*(.+?)\s*$/

// What the answer names is read by the mod, so it is held to an absolute markdown file that does not climb.
const usable = (path: string): boolean => /^(\/|[A-Za-z]:[\\/])/.test(path) && path.endsWith('.md') && !path.split(/[\\/]/).includes('..')

// Quotes, backticks and emphasis around the path, and a full stop after it, are the answer's prose and not part of the path.
const bare = (raw: string): string => raw.replace(/^[`'"*_]+|[`'"*_.]+$/g, '')

// The last usable line: an answer may quote the request before it gives the path.
export const handoffPath = (answer: string): string | undefined => {
  let found: string | undefined
  for (const line of answer.split('\n')) {
    const path = bare(LINE.exec(line)?.[1] ?? '')
    if (usable(path)) found = path
  }
  return found
}

export type Entry = { name: string; kind: string; mtimeMs: number; size: number }

// A handoff is a page or two; the limit only keeps a file that is not one from becoming the first message.
export const MAX_HANDOFF_BYTES = 200_000

// The way out when the answer names no path: the file the command wrote while it ran, found by its name in the temp directory.
export const newestHandoff = (entries: readonly Entry[], since: number): string | undefined =>
  entries.filter(e => e.kind === 'file' && /^handoff-.*\.md$/.test(e.name) && e.mtimeMs >= since).sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.name

// A file the answer names is checked against its entry in its directory: written since the command started, and of a size a handoff can be.
// Only a file that can be seen to fail is refused; one whose directory cannot be listed is let through.
export const unfit = (entry: Entry | undefined, file: string, since: number): { stage: 'path' | 'read'; reason: string } | undefined => {
  if (entry === undefined) return undefined
  if (entry.mtimeMs < since) return { stage: 'path', reason: `the handoff file ${file} was not written by this run` }
  if (entry.size > MAX_HANDOFF_BYTES) return { stage: 'read', reason: `the handoff file ${file} is too large (${entry.size} bytes)` }
  return undefined
}

// The first message with what the person typed while the handoff ran, so that nothing of it has to be sent on its own.
export const withHeld = (message: string, held: readonly string[]): string =>
  held.length === 0 ? message : `${message}\n\nTyped while the handoff ran:\n${held.join('\n\n')}`

export const firstMessage = (handoff: string): string => `Handoff from the previous session. Read it and carry on with the next step.\n\n${handoff}`

// The prompt the fork is asked when the user has none of their own. The fork sees the whole history and has no tools, so it only has to say
// what the next session needs; the length is a guide, and a prompt file of the user's can set another.
export const DEFAULT_PROMPT = [
  'Write a handoff for the session that takes over this work. It starts with no memory of this conversation and must be able to carry on from your text alone.',
  MID_TASK,
  'Write about 4,000 to 6,000 characters, in the language of the conversation; keep code, commands, paths and error messages as they are.',
  'Cover, in this order:',
  '1. Goal: what the work is for, and the ticket or spec it follows, if any.',
  '2. State: what is done, what is under way, what is left.',
  '3. Decisions made, each with its reason.',
  '4. Attempts that failed, and why, so that they are not tried again.',
  '5. Next step: the one thing to do first.',
  '6. Open questions for the user.',
  '7. The end of the conversation, as close to word for word as you can: the last request, your last answer, and anything the user said that is not yet acted on.',
  '8. Suggested skills: the skills the new session should call for this work, by name.',
  'State facts only. Name files by their path. Leave out what the new session can read from the files itself. Write no greeting and no closing remarks.',
  'Redact secrets such as API keys, passwords and personal data; say that something was left out, not what it was.',
].join('\n')

// A directory as the host gives it may or may not end in a separator.
export const withoutTrailingSeparator = (dir: string): string => dir.replace(/[\\/]$/, '')

// Where the user's own prompt lives. The mod reads it and never writes it.
export const promptPath = (home: string): string => `${withoutTrailingSeparator(home)}/.claude/context-relay/handoff-prompt.md`

// A file that is missing, unreadable or blank leaves the prompt the mod brings.
export const promptFrom = (file: unknown): string => (typeof file === 'string' && file.trim() !== '' ? file.trim() : DEFAULT_PROMPT)

// `$.model.fork` cannot be cancelled, so the wait for it is limited here; an answer after the limit is not used.
export const FORK_TIMEOUT_MS = 3 * 60_000

export type ForkAnswer = { isAnswered: true; text: string } | { isAnswered: false; reason: string; status?: number | null }

type NoFork = Extract<ForkAnswer, { isAnswered: false }>

// The reasons a fork gives nothing for that the mod knows, each in words for a person. The one list both the words and the log's kind read.
const FORK_REASONS: Record<string, (answer: NoFork) => string> = {
  'nothing-to-fork': () => 'there is nothing to fork yet (a fresh or just cleared session)',
  'api-error': answer => `the API failed${typeof answer.status === 'number' ? ` (status ${answer.status})` : ''}`,
  'empty-reply': () => 'the fork replied with nothing',
  aborted: () => 'the fork was aborted',
  timeout: () => `the fork did not answer within ${FORK_TIMEOUT_MS / 60_000} minutes`,
}

const known = (reason: string): boolean => Object.hasOwn(FORK_REASONS, reason)

// The kind of reason a fork gave nothing for, from a fixed set: a reason the mod does not know is the host's own words and stays out.
export const forkKind = (answer: NoFork): string => (known(answer.reason) ? answer.reason : 'other')

// What a fork that gave no handoff says, in words for a person; a reason the mod does not know as the host gave it.
export const forkFailure = (answer: NoFork): string => (known(answer.reason) ? FORK_REASONS[answer.reason](answer) : answer.reason)
