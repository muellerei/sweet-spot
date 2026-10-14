// What a person types while a handover runs: the typing is held and goes in when the handover is done, so it is neither lost nor sent into a
// session that is about to be cleared. These lines carry the name themselves: the host puts it only in
// front of log lines and command replies.

import { underWay, type IdlePrepared, type State } from './state'

export const HELD = 'sweet-spot: a handover is in progress, your message is held and goes in when it is done'
export const NO_ATTACHMENTS = 'sweet-spot: a handover is in progress and attachments cannot be held, send the message again when it is done'

// While the handoff after a long pause is written, which takes seconds and changes nothing the person sees.
export const HELD_MOMENT = 'sweet-spot: your message is held for a moment and goes in right after'
export const NO_ATTACHMENTS_MOMENT = 'sweet-spot: attachments cannot be held, send the message again in a moment'

type Typing = { text: string; attachments?: readonly unknown[]; origin: { kind: string } }

// Typed at the prompt by a person, and no slash command.
const byPerson = (input: Typing): boolean => (input.origin.kind === 'composer' || input.origin.kind === 'bridge') && !input.text.trimStart().startsWith('/')

// The reason to drop the input with, when it is held; `undefined` lets it through. Only what a person types at the prompt is held: a slash
// command still runs, and what other parts of the system send is theirs.
export const hold = (state: State, input: Typing): string | undefined => {
  if (!underWay(state)) return undefined
  const quiet = !state.handingOver
  if (!byPerson(input)) return undefined
  // The mod cannot get at the content of an attachment, so the whole input is turned away and nothing of it is half kept.
  if ((input.attachments?.length ?? 0) > 0) return quiet ? NO_ATTACHMENTS_MOMENT : NO_ATTACHMENTS
  const text = input.text.trim()
  if (text === '') return undefined
  state.held.push(input.text)
  return quiet ? HELD_MOMENT : HELD
}

// The first message a person sends after the handoff was written takes it, at once and before any wait, so that a second message never sees
// it too. Typing that is empty, a slash command and what other parts of the system send leave it: a slash command is no message to carry
// into a fresh session (`/model`, `/clear`), and a turn it starts ends the pause.
export const claim = (state: State, input: Typing): IdlePrepared | undefined => {
  const prepared = state.idle.prepared
  if (prepared === undefined || !byPerson(input) || input.text.trim() === '') return undefined
  state.idle.prepared = undefined
  state.idle.coldTimer?.cancel()
  state.idle.coldTimer = undefined
  state.idle.coldShown = false
  state.returning = true
  state.held = []
  return prepared
}
