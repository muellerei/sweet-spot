import { test, expect } from 'claude-code/testing'

import {
  baselineOf,
  baselineOfUsage,
  compactedSince,
  completionsOf,
  fireVerdict,
  firstBaselineOf,
  firstReadOf,
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

// Claude Code writes each pass of a request with the advisor inside it under `usage.iterations` (read in a transcript of 2.1.309); the
// usage beside it is their sum. The context the host reports is the last pass of type `message` or `fallback_message`.
const pass = (type: string, input: number, read: number, written: number) => ({
  type,
  input_tokens: input,
  output_tokens: 300,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: written,
  cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: written },
})
const withPasses = (...iterations: object[]) => assistant({ input_tokens: 4, cache_read_input_tokens: 84_716, cache_creation_input_tokens: 49_643, iterations })

test('the baseline from a transcript is the last pass of a first request in several passes, as the host counts the context', () => {
  const advisor = withPasses(pass('message', 2, 17_662, 49_392), pass('advisor_message', 3, 68_000, 634), pass('message', 2, 67_054, 251))
  expect(firstBaselineOf([user, advisor].join('\n'))).toBe(67_307)
  const fallback = withPasses(pass('message', 2, 17_662, 49_392), pass('fallback_message', 2, 67_000, 300))
  expect(firstBaselineOf([user, fallback].join('\n'))).toBe(67_302)
  // Without a pass the host counts, or without any, the usage itself.
  expect(firstBaselineOf([user, withPasses(pass('advisor_message', 3, 68_000, 634))].join('\n'))).toBe(134_363)
  expect(firstBaselineOf([user, withPasses()].join('\n'))).toBe(134_363)
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

// A request that runs in several passes (the advisor inside it, or the request that writes the handoff trying a tool and asking again)
// reports the sum of their usage; the context the host reports after it is its last pass alone. Measured on Claude Code 2.1.308 and 2.1.309.
const sums = (input: number, read: number, written: number) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: written })
// The first request of a fresh session with one advisor call: 67307 tokens of context, its first pass read 17662.
const ADVISOR_FIRST = sums(4, 84_716, 49_643)
// One advisor call after a warm return whose first pass read only 56473 of 87361; context after it 87569, compared against 87257.
const ADVISOR_PARTIAL_MISS = sums(4, 143_832, 31_094)
// One advisor call that read the cache: context after it 87627, compared against 87139.
const ADVISOR_HIT = sums(4, 174_353, 513)
// Two advisor calls that read the cache: context after it 88621, compared against 87611.
const TWO_ADVISORS_HIT = sums(6, 264_001, 1_006)
// The request that writes the handoff, a tool tried and refused, the cache read: context when writing 87090.
const TRIED_TOOL_HIT = sums(99, 174_154, 136)
// The same, its first completion missing the cache and the second reading what the first wrote.
const TRIED_TOOL_MISS = sums(99, 88_090, 86_200)
// The request that writes the handoff without a tool: its own prompt on top of the context (87611), no sum.
const NO_TOOL = sums(444, 87_262, 351)

test('a usage sums as many completions as it holds contexts, never fewer than one', () => {
  expect(completionsOf(ADVISOR_FIRST, 67_307)).toBe(2)
  expect(completionsOf(TWO_ADVISORS_HIT, 88_621)).toBe(3)
  expect(completionsOf(sums(3, 60_000, 0), 60_003)).toBe(1)
  expect(completionsOf(sums(3, 20_000, 0), 60_000)).toBe(1)
  expect(completionsOf(NO_TOOL, 87_611)).toBe(1)
})

test('what the first completion read is at least the context less the summed fresh input and writes, and the read itself without a sum', () => {
  expect(firstReadOf(ADVISOR_PARTIAL_MISS, 87_569)).toBe(56_471)
  expect(firstReadOf(ADVISOR_FIRST, 67_307)).toBe(17_660)
  expect(firstReadOf(NO_TOOL, 87_611)).toBe(87_262)
  expect(firstReadOf(ADVISOR_PARTIAL_MISS, 0)).toBe(143_832)
  expect(firstReadOf(ADVISOR_PARTIAL_MISS, undefined)).toBe(143_832)
  expect(firstReadOf(sums(4, 100_000, 90_000), 60_000)).toBe(0)
})

test('a request in several passes is a hit by what its first pass read, not by the sum', () => {
  expect(isHit(ADVISOR_PARTIAL_MISS, 87_257, 87_569)).toBe(false)
  expect(isHit(ADVISOR_HIT, 87_139, 87_627)).toBe(true)
  expect(isHit(TWO_ADVISORS_HIT, 87_611, 88_621)).toBe(true)
  expect(isHit(TRIED_TOOL_MISS, 87_090, 87_090)).toBe(false)
  expect(isHit(TRIED_TOOL_HIT, 87_090, 87_090)).toBe(true)
  // A large prompt of its own, no sum: what it read counts, not the context less its prompt (67607, a miss).
  expect(isHit(sums(4, 87_611, 20_000), 87_611, 87_611)).toBe(true)
  expect(isHit(ADVISOR_PARTIAL_MISS, 87_257)).toBe(true)
})

test('the baseline of a request in several passes is the context after it, and the usage itself without a sum or a context', () => {
  expect(baselineOf(ADVISOR_FIRST, 67_307)).toBe(67_307)
  expect(baselineOf({ input_tokens: 3, cache_read_input_tokens: 31_000, cache_creation_input_tokens: 20_000 }, 120_000)).toBe(51_003)
  expect(baselineOf(ADVISOR_FIRST, undefined)).toBe(134_363)
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
