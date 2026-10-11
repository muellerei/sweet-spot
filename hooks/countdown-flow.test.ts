import { test, expect } from 'claude-code/testing'

import type { Start } from './countdown'
import { begin, press, surveyed, type CountdownIo, type Expiry } from './countdown-flow'
import { freshState } from './state'

// The countdown's flows with a session of the test's own, for what the host cannot be made to do through the engine.

const ioWith = (toasts: string[]): CountdownIo => ({
  now: async () => 0,
  after: () => ({ cancel: () => {} }),
  every: () => ({ cancel: () => {} }),
  surfaces: async () => ['terminal'],
  prompt: async () => '',
  redraw: () => {},
  toast: text => void toasts.push(text),
  log: () => {},
})

// The digit reaches the mod as an edit first and as the press about 0.4 s later. A countdown that runs out in between has started the
// handover and taken its button down; the engine then delivers no press, but a host that still did is answered as `later` is.
test('press: with no countdown, a press during a handover is answered as later is, and otherwise it does nothing', async () => {
  const toasts: string[] = []
  const state = freshState()
  const asked: string[] = []
  const moveBack = async () => (asked.push('later'), { text: 'a handover is in progress, try again when it is done' })
  expect(await press(ioWith(toasts), state, moveBack)).toEqual([])
  expect(asked).toEqual([])
  state.handingOver = true
  // No line says a countdown moved back: none ran.
  expect(await press(ioWith(toasts), state, moveBack)).toEqual([])
  expect(toasts).toEqual(['a handover is in progress, try again when it is done'])
})

// A session whose clock the test sets, whose timers it fires, and whose diagnostic lines it reads; `next` resolves at the next line.
const clocked = () => {
  const s = {
    now: 0,
    clockReads: 0,
    clockFails: false,
    timers: [] as (() => void)[],
    lines: [] as string[],
    carried: [] as number[],
    next: Promise.resolve(),
  }
  let line = () => {}
  const io: CountdownIo = {
    ...ioWith([]),
    now: async () => {
      s.clockReads++
      if (s.clockFails) throw new Error('clock gone')
      return s.now
    },
    after: (_, fn) => (s.timers.push(fn), { cancel: () => {} }),
    log: (level, text) => {
      s.lines.push(`${level}: ${text}`)
      line()
    },
  }
  const nextLine = () => (s.next = new Promise<void>(r => (line = r)))
  const expiry: Expiry = {
    look: async () => ({
      tokens: 210_000,
      window: 1_000_000,
      backgroundTasks: 0,
      oneShotTimers: 0,
      subagents: 0,
      turns: 10,
      lastAttempt: undefined,
      later: undefined,
      asap: undefined,
    }),
    judge: () => ({ kind: 'act', tokens: 210_000 }),
    carry: (_, now) => void s.carried.push(now),
    postpone: () => {},
  }
  return { s, io, expiry, nextLine }
}

const CAP: Start = { kind: 'cap', method: 'external-command', decision: { kind: 'act', tokens: 210_000 }, threshold: 200_000 }

test('surveyed: a clock that cannot be read when a survey comes ends the countdown rather than leave it counting beneath the survey', async () => {
  const { s, io, expiry, nextLine } = clocked()
  const state = freshState()
  await begin(io, state, 10, CAP, expiry)
  s.clockFails = true
  nextLine()
  surveyed(io, state, true)
  await s.next
  expect(state.countdown).toBeUndefined()
  expect(s.lines.at(-1)).toBe('warn: countdown: could not read the clock at a survey')
})

// The clock read as the survey comes may be late: the deadline may have passed already. The countdown then goes on with no time left, not
// with less than none, which would read as a clock long past its deadline when it runs out and end it without a handover.
test('surveyed: a survey read past the deadline keeps no time left, and the countdown hands over when the survey goes', async () => {
  const { s, io, expiry, nextLine } = clocked()
  const state = freshState()
  await begin(io, state, 10, CAP, expiry)
  s.now = 15_000
  nextLine()
  surveyed(io, state, true)
  await s.next
  s.now = 16_000
  nextLine()
  surveyed(io, state, false)
  await s.next
  nextLine()
  s.timers.at(-1)?.()
  await s.next
  expect(s.carried).toEqual([16_000])
})

// Each draw reports whether a survey shows; only a change is taken up. The band draws at every tick, and a clock read at each draw would
// be a wait for nothing.
test('surveyed: a report that changes nothing reads no clock and says nothing', async () => {
  const { s, io, expiry, nextLine } = clocked()
  const state = freshState()
  await begin(io, state, 10, CAP, expiry)
  nextLine()
  surveyed(io, state, true)
  await s.next
  const reads = s.clockReads
  surveyed(io, state, true)
  await Promise.resolve()
  expect(s.clockReads).toBe(reads)
  expect(s.lines.filter(l => l.includes('survey'))).toEqual(['debug: countdown: held, survey, 10 s left'])
})
