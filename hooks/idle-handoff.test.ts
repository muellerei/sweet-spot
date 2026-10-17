import { test, expect } from 'claude-code/testing'

import {
  baselineOfUsage,
  compactedSince,
  fireVerdict,
  firstBaselineOf,
  floorOf,
  idleFor,
  isHit,
  lifetimeOf,
  planVerdict,
  prepareDueAt,
  readPlan,
  returnVerdict,
} from './idle-handoff'
import { compactMark } from './idle-support'

// The handoff after a long pause, the parts that need no host: how much of the transcript to read, and the cache lifetime and the
// baseline found in it. The lines are shaped as Claude Code writes them; only the fields read here are kept.

const assistant = (usage: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage }, ...extra })

const written = (fiveMinutes: number, oneHour: number, more: Record<string, unknown> = {}) =>
  assistant({
    input_tokens: 3,
    cache_read_input_tokens: 40_000,
    cache_creation_input_tokens: fiveMinutes + oneHour,
    cache_creation: { ephemeral_5m_input_tokens: fiveMinutes, ephemeral_1h_input_tokens: oneHour },
    ...more,
  })

const readOnly = assistant({
  input_tokens: 3,
  cache_read_input_tokens: 50_000,
  cache_creation_input_tokens: 0,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 },
})

const user = JSON.stringify({ type: 'user', message: { content: 'hello' } })

test('a transcript up to 4 MiB is read whole, a larger one only at its end', () => {
  expect(readPlan(4_194_304)).toBe('read')
  expect(readPlan(4_194_305)).toBe('tail')
})

test('the lifetime is the one the last write of the main line used: an hour', () => {
  expect(lifetimeOf([user, written(0, 2_000), readOnly].join('\n'))).toBe('1h')
})

test('the lifetime is five minutes where the last write wrote any of it for five minutes, even beside an hour', () => {
  expect(lifetimeOf([written(0, 2_000), written(300, 1_000)].join('\n'))).toBe('5m')
})

test('the last write counts, not the first and not the last line', () => {
  expect(lifetimeOf([written(500, 0), written(0, 900), readOnly, user].join('\n'))).toBe('1h')
})

test('writes of a subagent (side chain) do not count', () => {
  const side = JSON.stringify({ ...JSON.parse(written(500, 0)), isSidechain: true })
  expect(lifetimeOf([written(0, 900), side].join('\n'))).toBe('1h')
})

test('broken lines, the cut first line of an end read and lines that are not entries are skipped', () => {
  const cut = written(0, 900).slice(17)
  expect(lifetimeOf([cut, 'not json', '', '42', written(0, 900)].join('\n'))).toBe('1h')
})

test('with no write in what was read the lifetime is not known', () => {
  expect(lifetimeOf([user, readOnly].join('\n'))).toBeUndefined()
  expect(lifetimeOf('')).toBeUndefined()
})

const AT = Date.parse('2026-05-04T10:00:00.000Z')

test('a compact marked at or after the given time counts, one before it does not', () => {
  expect(compactedSince([user, compactMark('2026-05-04T10:00:00.000Z'), readOnly].join('\n'), AT)).toBe(true)
  expect(compactedSince([compactMark('2026-05-04T09:59:59.999Z'), written(0, 900)].join('\n'), AT)).toBe(false)
})

test('a compact of a subagent (side chain), another system entry and a line with no readable time are no compact', () => {
  const later = '2026-05-04T11:00:00.000Z'
  const lines = [
    compactMark(later, { isSidechain: true }),
    compactMark(later, { subtype: 'informational' }),
    compactMark('not a time'),
    compactMark(undefined),
    compactMark(later).slice(9),
    user,
  ]
  expect(compactedSince(lines.join('\n'), AT)).toBe(false)
  expect(compactedSince('', AT)).toBe(false)
})

test('the baseline is the input of a request: what was read, written and sent fresh, together', () => {
  const usage = { input_tokens: 3, output_tokens: 700, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 20_000 }
  expect(baselineOfUsage(usage)).toBe(51_003)
})

test('the baseline from a transcript is the input of the first request of the main line', () => {
  const side = JSON.stringify({ ...JSON.parse(written(0, 9_000)), isSidechain: true })
  const first = assistant({ input_tokens: 5, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 18_000 })
  expect(firstBaselineOf([user, side, first, written(0, 2_000)].join('\n'))).toBe(48_005)
  expect(firstBaselineOf(user)).toBeUndefined()
})

const HOUR = 3_600_000
const plan = { on: true, lifetime: '1h' as const, tokens: 120_000, floor: 80_000, handingOver: false, timers: 0 }

test('the lower bound is the number set, or with 0 the baseline plus 30000, and unknown without a baseline', () => {
  expect(floorOf(90_000, 50_000)).toBe(90_000)
  expect(floorOf(0, 50_000)).toBe(80_000)
  expect(floorOf(0, undefined)).toBeUndefined()
})

test('a pause is planned for with the setting on, an hour of cache, a context at the lower bound, no handover and no timer of the session', () => {
  expect(planVerdict(plan)).toEqual({ plan: true })
  expect(planVerdict({ ...plan, tokens: 80_000 })).toEqual({ plan: true })
  expect(planVerdict({ ...plan, on: false })).toEqual({ plan: false, why: 'switched off' })
  expect(planVerdict({ ...plan, lifetime: '5m' })).toEqual({ plan: false, why: 'cache lifetime 5m' })
  expect(planVerdict({ ...plan, lifetime: undefined })).toEqual({ plan: false, why: 'cache lifetime unknown' })
  expect(planVerdict({ ...plan, floor: undefined })).toEqual({ plan: false, why: 'baseline unknown' })
  expect(planVerdict({ ...plan, tokens: 79_999 })).toEqual({ plan: false, why: 'context 79999 tokens below 80000' })
  expect(planVerdict({ ...plan, tokens: undefined })).toEqual({ plan: false, why: 'context size unknown' })
  expect(planVerdict({ ...plan, handingOver: true })).toEqual({ plan: false, why: 'a handover runs' })
  expect(planVerdict({ ...plan, timers: 1 })).toEqual({ plan: false, why: 'a timer of the session is set' })
})

test('the handoff is prepared five minutes before the hour after the touch', () => {
  expect(prepareDueAt(1_000)).toBe(1_000 + 55 * 60_000)
})

test('firing goes on at rest with an hour of cache and the request starting a minute before it expires', () => {
  const fire = { busy: undefined, lifetime: '1h' as const, now: 55 * 60_000, touch: 0 }
  expect(fireVerdict(fire)).toEqual({ go: true })
  expect(fireVerdict({ ...fire, busy: 'a turn runs' })).toEqual({ go: false, why: 'a turn runs' })
  expect(fireVerdict({ ...fire, lifetime: '5m' })).toEqual({ go: false, why: 'cache lifetime 5m' })
  expect(fireVerdict({ ...fire, now: HOUR - 60_001 })).toEqual({ go: true })
  expect(fireVerdict({ ...fire, now: HOUR - 60_000 })).toEqual({ go: false, why: 'the cache is about to expire or has' })
})

test('a request that read at least 80 percent of the context from the cache is a hit', () => {
  const usage = (read: number) => ({ input_tokens: 3, output_tokens: 1, cache_read_input_tokens: read, cache_creation_input_tokens: 0 })
  expect(isHit(usage(80_000), 100_000)).toBe(true)
  expect(isHit(usage(79_999), 100_000)).toBe(false)
  expect(isHit(undefined, 100_000)).toBe(false)
})

test('coming back is judged by the clock: cold from an hour after the touch, and then work and attachments keep the session', () => {
  const back = { now: HOUR, touch: 0, busy: false, attachments: false }
  expect(returnVerdict(back)).toBe('cold')
  expect(returnVerdict({ ...back, now: HOUR - 1 })).toBe('warm')
  expect(returnVerdict({ ...back, now: HOUR - 1, busy: true, attachments: true })).toBe('warm')
  expect(returnVerdict({ ...back, busy: true, attachments: true })).toBe('busy')
  expect(returnVerdict({ ...back, attachments: true })).toBe('attachments')
})

test('the time idle is said in whole hours and minutes, rounded down', () => {
  expect(idleFor(130 * 60_000 + 59_999)).toBe('2 h 10 min')
  expect(idleFor(120 * 60_000)).toBe('2 h')
  expect(idleFor(61 * 60_000)).toBe('1 h 1 min')
  expect(idleFor(59 * 60_000)).toBe('59 min')
})
