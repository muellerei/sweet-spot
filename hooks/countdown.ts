// The countdown before an automatic handover: its deadline, the seconds left, what "Not now" moves the handover back by, and what the
// band says. Pure, like `log.ts`: what reads the clock and draws the band hands the values in.

import type { Config, Method } from './config'
import { brakeFor, thresholdInForce, type Decision, type Snapshot } from './decide'

// The deadline is a time, not a count of ticks: a tick that does not come cannot move it.
export const deadlineOf = (now: number, seconds: number): number => now + seconds * 1000

// A second that has begun is still shown, so the band reads 10 at the start and 1 in the last second.
export const secondsLeft = (deadline: number, now: number): number => Math.max(0, Math.ceil((deadline - now) / 1000))

// How far past its deadline the end of a countdown may read the clock and still hand over. Later than that, the machine most likely slept
// or the timer stayed out, and the person, likely away, never saw the band; the countdown ends as it does for typing. An assumption, not
// measured: neither what the host does while the machine sleeps nor how late a timer usually fires.
export const LATE_MS = 3000

export const isLate = (deadline: number, now: number): boolean => now - deadline > LATE_MS

// What "Not now" moves the handover back by: `later_tokens`, or less where the emergency brake comes first, as `later` caps it there. The
// button says the value that holds, not the setting, so it never promises more than the press gives.
export type MoveBack = { tokens: number; toBrake: boolean }

export const moveBack = (config: Config, window: number, tokens: number): MoveBack => {
  const until = tokens + config.laterTokens
  return { tokens: thresholdInForce(config.threshold, window, { from: tokens, until }) - tokens, toBrake: until > brakeFor(config, window) }
}

// Which countdown a pause past the threshold begins, or none (`immediate`). At or past the emergency brake nothing moves the handover back,
// so there is no button: with no later handover set it goes at once, as it did before there was a countdown; with one set (capped at the
// brake, or jumped past by the context) a countdown with no button announces it (`brake`), for whoever pressed Not now expects to be asked
// again. Below the brake, two deferred pauses or more give the countdown that typing does not stop (`cap`): not just two, since a cap that
// ended without a handover counts as well and leaves three. Otherwise the countdown with "Not now" (`button`). The setting of 0 and a
// session with no screen are checked before.
export type CountdownKind = 'button' | 'cap' | 'brake'

export const kindAt = (s: Pick<Snapshot, 'tokens' | 'window' | 'later'>, config: Config, deferredPauses: number): CountdownKind | 'immediate' => {
  if (s.tokens !== undefined && s.tokens >= brakeFor(config, s.window)) return s.later === undefined ? 'immediate' : 'brake'
  return deferredPauses >= 2 ? 'cap' : 'button'
}

// How a countdown begins. `button` is the countdown with "Not now", which a person can answer, and what it moves the handover back by.
// `cap` (at the cap of deferred pauses) and `brake` (at the emergency brake) have no button, and typing does not stop them. `threshold`
// is the threshold in force, the brake for `brake`; `decision` is what the pause decided, which the end of the countdown carries out.
export type Start = ({ kind: 'button'; moveBack: MoveBack } | { kind: 'cap' | 'brake' }) & {
  // The way tried first, which the band names.
  method: Method
  decision: Extract<Decision, { kind: 'act' | 'dry-run' }>
  threshold: number
}

// All the band shows, since drawing waits on nothing (the clock is a wait): the start and the seconds that the start or the last tick
// read off the clock.
export type Band = Start & { shown: number }

// A countdown in the mod's state. The band only draws it; what changes here changes on an event, or on a survey coming up in the band or
// going, which only the drawing sees.
export type Countdown = Band & {
  deadline: number
  // Whether a survey holds the band, as the drawing last reported it.
  survey: boolean
  // The time left, kept while a survey holds the countdown: no timer runs then, and when the survey goes the deadline is set again from it.
  remaining: number | undefined
  // Stops the countdown's timers: the deadline and the tick that redraws the band.
  stop: () => void
  // Starts them again towards the deadline, from `now`.
  run: (now: number) => void
}

const SEP = ' · '

// What the band says. `width` is the cells the band lays its tree out in (`bodyColumns`); a band too narrow for all of it drops ` of
// <threshold>` first, then the context, and always keeps the way with the seconds and the end: the button, or for a countdown with none,
// what it is. `text` comes before the button, which the terminal draws with its hotkey in front (`1: Not now, +25000`).
export const bandOf = (c: Band, width: number): { text: string; button: string | undefined } => {
  const dry = c.decision.kind === 'dry-run'
  const way =
    c.method === 'builtin-compact' ? (dry ? 'Would compact' : 'Compacting') : dry ? 'Would hand over to a fresh session' : 'Handing over to a fresh session'
  const head = `${way} in ${c.shown} s`
  const button = c.kind === 'button' ? `Not now, +${c.moveBack.tokens}${c.moveBack.toBrake ? ' to the brake' : ''}` : undefined
  const end = button !== undefined ? `${NOT_NOW_KEY}: ${button}` : c.kind === 'cap' ? 'your draft stays in the prompt' : 'emergency brake'
  const context = `${SEP}context ${c.decision.tokens}`
  const fits = (text: string) => text.length + end.length <= width
  const text = [`${head}${context} of ${c.threshold}${SEP}`, `${head}${context}${SEP}`].find(fits) ?? `${head}${SEP}`
  return { text: button === undefined ? `${text}${end}` : text, button }
}

// The key that presses "Not now": a single digit, which the host takes from an empty prompt for a band button.
export const NOT_NOW_KEY = '1'

// One edit in the prompt, as `prompt.edit` brings it: the draft before, the span it replaces, what goes in, and the key that made it.
export type Edit = { text: string; start: number; end: number; inputText: string; key?: { key: string; ctrl?: true; shift?: true; meta?: true } }

// Whether an edit is typing, which ends a countdown with the button: it leaves text in the prompt, read without white space. An edit
// that leaves the prompt empty is none, and neither is a bare move of the cursor in an empty prompt.
//
// The one exception is the key of "Not now" in an empty prompt while the band shows the button: the host raises it as an edit first (the
// digit as `inputText`, an empty draft) and as the press about 0.4 s later, and the prompt stays empty (docs/host-behaviour.md, Commands).
// That edit is the press's echo, not typing; the press itself moves the handover back. The event alone cannot tell, since its result reads
// as the digit. Where the digit does land in the prompt (the button out of sight), the prompt is no longer empty and the next edit is
// typing; where it lands without an edit, the end of the countdown reads the prompt.
export const typed = (edit: Edit, buttonShown: boolean): boolean => {
  const after = edit.text.slice(0, edit.start) + edit.inputText + edit.text.slice(edit.end)
  return after.trim() !== '' && !isDigitEcho(edit, buttonShown)
}

const isDigitEcho = ({ key, text }: Edit, buttonShown: boolean): boolean =>
  buttonShown && text === '' && key !== undefined && key.key === NOT_NOW_KEY && !key.ctrl && !key.shift && !key.meta
