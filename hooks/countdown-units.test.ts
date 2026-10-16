import { test, expect } from 'claude-code/testing'

import { DEFAULTS } from './config'
import { bandOf, deadlineOf, isLate, kindAt, moveBack, secondsLeft, typed, type Band, type Edit } from './countdown'

test('deadlineOf: the deadline lies the given seconds after now', async () => {
  expect(deadlineOf(5_000, 10)).toBe(15_000)
})

test('secondsLeft: whole seconds up to the deadline, a started second counted, none past it', async () => {
  expect(secondsLeft(15_000, 5_000)).toBe(10)
  expect(secondsLeft(15_000, 5_001)).toBe(10)
  expect(secondsLeft(15_000, 6_000)).toBe(9)
  expect(secondsLeft(15_000, 14_999)).toBe(1)
  expect(secondsLeft(15_000, 15_000)).toBe(0)
  expect(secondsLeft(15_000, 16_000)).toBe(0)
})

test('moveBack: later_tokens, as far as the emergency brake lets it go, and whether the brake cut it short', async () => {
  // A 1000000 window: brake 350000, far off.
  expect(moveBack(DEFAULTS, 1_000_000, 203_000)).toEqual({ tokens: 25_000, toBrake: false })
  // A 200000 window: threshold in force 160000, brake 180000.
  expect(moveBack(DEFAULTS, 200_000, 160_000)).toEqual({ tokens: 20_000, toBrake: true })
  expect(moveBack(DEFAULTS, 200_000, 155_000)).toEqual({ tokens: 25_000, toBrake: false })
  expect(moveBack({ ...DEFAULTS, laterTokens: 40_000 }, 1_000_000, 203_000)).toEqual({ tokens: 40_000, toBrake: false })
})

// The band as drawn: the text, then the button, which the terminal draws with its hotkey in front; the text alone where it has none.
const drawn = (c: Band, width: number) => {
  const band = bandOf(c, width)
  return band.button === undefined ? band.text : `${band.text}1: ${band.button}`
}
const band = (extra: Partial<Extract<Band, { kind: 'button' }>> = {}): Extract<Band, { kind: 'button' }> => ({
  kind: 'button',
  method: 'builtin-compact',
  decision: { kind: 'act', tokens: 203_000 },
  threshold: 200_000,
  moveBack: { tokens: 25_000, toBrake: false },
  shown: 8,
  ...extra,
})
const WIDE = 200

test('bandOf: the way with the seconds, the context of the threshold, and the button with what it moves the handover back by', async () => {
  expect(drawn(band(), WIDE)).toBe('Compacting in 8 s · context 203000 of 200000 · 1: Not now, +25000')
  expect(drawn(band({ method: 'internal-handoff' }), WIDE)).toBe('Handing over to a fresh session in 8 s · context 203000 of 200000 · 1: Not now, +25000')
  expect(drawn(band({ method: 'external-command' }), WIDE)).toBe('Handing over to a fresh session in 8 s · context 203000 of 200000 · 1: Not now, +25000')
  expect(drawn(band({ decision: { kind: 'act', tokens: 160_000 }, threshold: 160_000, moveBack: { tokens: 20_000, toBrake: true } }), WIDE)).toBe(
    'Compacting in 8 s · context 160000 of 160000 · 1: Not now, +20000 to the brake',
  )
})

test('bandOf: a dry run says what it would do', async () => {
  const dry = { decision: { kind: 'dry-run', tokens: 203_000 } } as const
  expect(drawn(band(dry), WIDE)).toBe('Would compact in 8 s · context 203000 of 200000 · 1: Not now, +25000')
  expect(drawn(band({ ...dry, method: 'internal-handoff' }), WIDE)).toBe(
    'Would hand over to a fresh session in 8 s · context 203000 of 200000 · 1: Not now, +25000',
  )
})

test('bandOf: a narrow band drops the threshold first, then the context, and keeps the way, the seconds and the button', async () => {
  const full = 'Compacting in 8 s · context 203000 of 200000 · 1: Not now, +25000'
  expect(drawn(band(), full.length)).toBe(full)
  expect(drawn(band(), full.length - 1)).toBe('Compacting in 8 s · context 203000 · 1: Not now, +25000')
  const shorter = 'Compacting in 8 s · context 203000 · 1: Not now, +25000'
  expect(drawn(band(), shorter.length)).toBe(shorter)
  expect(drawn(band(), shorter.length - 1)).toBe('Compacting in 8 s · 1: Not now, +25000')
  expect(drawn(band(), 10)).toBe('Compacting in 8 s · 1: Not now, +25000')
})

test('bandOf: a standing task is named after the context, several by their number, a long one cut short', async () => {
  expect(drawn(band({ running: ['npm run dev'] }), WIDE)).toBe('Compacting in 8 s · context 203000 of 200000 · npm run dev keeps running · 1: Not now, +25000')
  expect(drawn(band({ running: ['npm run dev', 'tail -f'] }), WIDE)).toBe(
    'Compacting in 8 s · context 203000 of 200000 · 2 tasks keep running · 1: Not now, +25000',
  )
  expect(drawn(band({ running: ['abcdefghijklmnopqrstuvwxyz0123456789'] }), WIDE)).toBe(
    'Compacting in 8 s · context 203000 of 200000 · abcdefghijklmnopqrstuvwxyz012… keeps running · 1: Not now, +25000',
  )
  expect(drawn(band({ running: ['abcdefghijklmnopqrstuvwxyz0123'] }), WIDE)).toBe(
    'Compacting in 8 s · context 203000 of 200000 · abcdefghijklmnopqrstuvwxyz0123 keeps running · 1: Not now, +25000',
  )
  expect(drawn(band({ running: [] }), WIDE)).toBe('Compacting in 8 s · context 203000 of 200000 · 1: Not now, +25000')
})

test('bandOf: a narrow band drops what keeps running first, then the threshold, then the context', async () => {
  const full = 'Compacting in 8 s · context 203000 of 200000 · npm run dev keeps running · 1: Not now, +25000'
  const running = band({ running: ['npm run dev'] })
  expect(drawn(running, full.length)).toBe(full)
  expect(drawn(running, full.length - 1)).toBe('Compacting in 8 s · context 203000 of 200000 · 1: Not now, +25000')
  expect(drawn(running, 'Compacting in 8 s · context 203000 of 200000 · 1: Not now, +25000'.length - 1)).toBe(
    'Compacting in 8 s · context 203000 · 1: Not now, +25000',
  )
  expect(drawn(running, 10)).toBe('Compacting in 8 s · 1: Not now, +25000')
})

test('isLate: more than 3 s past the deadline, not 3 s itself', async () => {
  expect(isLate(10_000, 12_900)).toBe(false)
  expect(isLate(10_000, 13_000)).toBe(false)
  expect(isLate(10_000, 13_001)).toBe(true)
  expect(isLate(10_000, 9_000)).toBe(false)
})

// An edit typed at the end of `before`.
const typing = (before: string, inputText: string, key?: Edit['key']): Edit => ({
  text: before,
  start: before.length,
  end: before.length,
  inputText,
  ...(key ? { key } : {}),
})

test('typed: an edit that leaves text in the prompt, read without white space', async () => {
  expect(typed(typing('', 'h', { key: 'h' }), true)).toBe(true)
  expect(typed(typing('', 'pasted text'), true)).toBe(true)
  expect(typed(typing('', ' ', { key: ' ' }), true)).toBe(false)
  // A cursor move, in an empty prompt and in a draft.
  expect(typed(typing('', '', { key: 'left' }), true)).toBe(false)
  expect(typed({ text: 'draft', start: 2, end: 2, inputText: '', key: { key: 'left' } }, true)).toBe(true)
  // A deletion that empties the prompt, and one that leaves text.
  expect(typed({ text: 'a', start: 0, end: 1, inputText: '', key: { key: 'backspace' } }, true)).toBe(false)
  expect(typed({ text: 'ab', start: 1, end: 2, inputText: '', key: { key: 'backspace' } }, true)).toBe(true)
})

test('typed: the key of Not now in an empty prompt is the echo of the press while the button shows, typing otherwise', async () => {
  expect(typed(typing('', '1', { key: '1' }), true)).toBe(false)
  // No button shown, text before it, another digit, a modifier held, or the digit pasted with no key: typing.
  expect(typed(typing('', '1', { key: '1' }), false)).toBe(true)
  expect(typed(typing('a', '1', { key: '1' }), true)).toBe(true)
  expect(typed(typing('', '2', { key: '2' }), true)).toBe(true)
  expect(typed(typing('', '1', { key: '1', ctrl: true }), true)).toBe(true)
  expect(typed(typing('', '1', { key: '1', shift: true }), true)).toBe(true)
  expect(typed(typing('', '1', { key: '1', meta: true }), true)).toBe(true)
  expect(typed(typing('', '1'), true)).toBe(true)
})

// What kindAt reads of a pause: the context, the window and the later handover that holds.
const at = (tokens: number, window: number, later?: { from: number; until: number }) => ({ tokens, window, later })

test('kindAt: at or past the emergency brake with no later the handover goes at once, with later set the countdown has no button', async () => {
  // A 1000000 window: threshold 200000, brake 350000.
  expect(kindAt(at(349_999, 1_000_000), DEFAULTS, 0)).toBe('button')
  expect(kindAt(at(350_000, 1_000_000), DEFAULTS, 0)).toBe('immediate')
  expect(kindAt(at(360_000, 1_000_000), DEFAULTS, 2)).toBe('immediate')
  // Later not capped, which the context jumped past (1000000 window), and later capped at the brake (200000 window: brake 180000).
  expect(kindAt(at(360_000, 1_000_000, { from: 200_000, until: 225_000 }), DEFAULTS, 0)).toBe('brake')
  expect(kindAt(at(180_000, 200_000, { from: 160_000, until: 185_000 }), DEFAULTS, 0)).toBe('brake')
  expect(kindAt(at(180_000, 200_000, { from: 160_000, until: 185_000 }), DEFAULTS, 2)).toBe('brake')
  expect(kindAt(at(179_999, 200_000), DEFAULTS, 0)).toBe('button')
})

test('kindAt: two deferred pauses and more give the countdown with no button, fewer the one with Not now', async () => {
  expect(kindAt(at(210_000, 1_000_000), DEFAULTS, 0)).toBe('button')
  expect(kindAt(at(210_000, 1_000_000), DEFAULTS, 1)).toBe('button')
  expect(kindAt(at(210_000, 1_000_000), DEFAULTS, 2)).toBe('cap')
  // A cap that ended without a handover leaves three.
  expect(kindAt(at(210_000, 1_000_000), DEFAULTS, 3)).toBe('cap')
})

test('bandOf: with no button, the cap says the draft stays and the brake names itself, and the threshold is the brake', async () => {
  const cap = { ...band(), kind: 'cap' } as const
  expect(drawn(cap, WIDE)).toBe('Compacting in 8 s · context 203000 of 200000 · your draft stays in the prompt')
  expect(bandOf(cap, WIDE).button).toBeUndefined()
  const brake = { ...band({ decision: { kind: 'act', tokens: 181_000 } }), kind: 'brake', threshold: 180_000 } as const
  expect(drawn(brake, WIDE)).toBe('Compacting in 8 s · context 181000 of 180000 · emergency brake')
  const full = 'Compacting in 8 s · context 181000 of 180000 · emergency brake'
  expect(drawn(brake, full.length - 1)).toBe('Compacting in 8 s · context 181000 · emergency brake')
  expect(drawn(brake, 10)).toBe('Compacting in 8 s · emergency brake')
})
