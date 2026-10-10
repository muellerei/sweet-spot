// What a person types while a handover runs: the typing is held and goes in when the handover is done, so it is neither lost nor sent into a
// session that is about to be cleared. These lines carry the name themselves: the host puts it only in
// front of log lines and command replies.

import type { State } from './state'

export const HELD = 'sweet-spot: a handover is in progress, your message is held and goes in when it is done'
export const NO_ATTACHMENTS = 'sweet-spot: a handover is in progress and attachments cannot be held, send the message again when it is done'

type Typing = { text: string; attachments?: readonly unknown[]; origin: { kind: string } }

// The reason to drop the input with, when it is held; `undefined` lets it through. Only what a person types at the prompt is held: a slash
// command still runs, and what other parts of the system send is theirs.
export const hold = (state: State, input: Typing): string | undefined => {
  if (!state.handingOver) return undefined
  if (input.origin.kind !== 'composer' && input.origin.kind !== 'bridge') return undefined
  if (input.text.trimStart().startsWith('/')) return undefined
  // The mod cannot get at the content of an attachment, so the whole input is turned away and nothing of it is half kept.
  if ((input.attachments?.length ?? 0) > 0) return NO_ATTACHMENTS
  const text = input.text.trim()
  if (text === '') return undefined
  state.held.push(input.text)
  return HELD
}
