// The handoff after a long pause, the parts that need no host. The prompt cache lives for an hour (a subscription within its quota) or five
// minutes; after a longer pause the next message writes the whole conversation again at the write price. A handoff written while the cache
// is still warm lets the return start a fresh session instead. This module knows how to read the cache lifetime and the baseline (what a
// fresh session sends with its first message) from the transcript; the host tells a mod neither.

// A transcript up to this size is read whole; above it only its end, which holds the latest writes. Most long sessions pass 4 MiB.
export const READ_LIMIT_BYTES = 4_194_304
export const TAIL_BYTES = 262_144

export type Lifetime = '1h' | '5m'

export const readPlan = (size: number): 'read' | 'tail' => (size <= READ_LIMIT_BYTES ? 'read' : 'tail')

export type InputUsage = { input_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

export const baselineOfUsage = (u: InputUsage): number => u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

// The main line's entries, in order: a subagent's (side chain) are left out. A line that is not an entry (the cut first line of an end read,
// a broken write) is skipped.
const mainEntries = function* (text: string): Generator<Record<string, unknown>> {
  for (const line of text.split('\n')) {
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (e.isSidechain !== true) yield e
  }
}

// The main line's answers, in order.
const mainAnswers = function* (text: string): Generator<Record<string, unknown>> {
  for (const e of mainEntries(text)) {
    if (e.type !== 'assistant') continue
    const usage = (e.message as { usage?: unknown } | undefined)?.usage
    if (typeof usage === 'object' && usage !== null) yield usage as Record<string, unknown>
  }
}

// Whether the main line has answered at all: a transcript with answers and no write is a session that writes none (caching off), and
// reading it again tells nothing new; one with no answer yet is one the host has not caught up with.
export const hasAnswer = (text: string): boolean => !mainAnswers(text).next().done

// Whether the main line was compacted at or after `since` (ms). The host marks every compact with a `compact_boundary` entry, also one whose
// messages another hook gave and that no hook beneath it saw (measured on 2.1.302, a manual compact). A line with no readable time counts as none.
export const compactedSince = (text: string, since: number): boolean => {
  for (const e of mainEntries(text)) {
    if (e.type === 'system' && e.subtype === 'compact_boundary' && typeof e.timestamp === 'string' && Date.parse(e.timestamp) >= since) return true
  }
  return false
}

// The lifetime the last write of the main line used. Five minutes wins where a write has both: that part goes cold first. Claude Code writes
// it per entry (measured on 2.1.296, both lifetimes). Unknown where what was read holds no write. Every line is parsed: a read at the limit
// (4 MiB, 1836 lines of a real transcript) takes about 8 ms on a cold call (measured with Bun), and it runs at the first turn and when the handoff is due.
export const lifetimeOf = (text: string): Lifetime | undefined => {
  let found: Lifetime | undefined
  for (const usage of mainAnswers(text)) {
    const created = usage.cache_creation as Record<string, unknown> | undefined
    if (typeof created !== 'object' || created === null) continue
    if (count(created.ephemeral_5m_input_tokens) > 0) found = '5m'
    else if (count(created.ephemeral_1h_input_tokens) > 0) found = '1h'
  }
  return found
}

// The input of the first request of the main line: for a session resumed with no baseline kept for its project. A request with the advisor
// inside it lists its passes under `iterations`, and its usage is their sum; the last pass of the kinds the host counts as the context
// (`message`, `fallback_message`) is the one kept live too, so both give the same size.
export const firstBaselineOf = (text: string): number | undefined => {
  for (const usage of mainAnswers(text)) {
    const passes = Array.isArray(usage.iterations) ? (usage.iterations as (Record<string, unknown> | null)[]) : []
    const counted = passes.findLast(p => p?.type === 'message' || p?.type === 'fallback_message') ?? usage
    return baselineOfUsage({
      input_tokens: count(counted.input_tokens),
      cache_read_input_tokens: count(counted.cache_read_input_tokens),
      cache_creation_input_tokens: count(counted.cache_creation_input_tokens),
    })
  }
  return undefined
}

export const HOUR_MS = 3_600_000
// The handoff is written this long before the hour is up: the timer may come late, and writing takes seconds (a model call about 2 s, a
// command 20 to 34 s, measured). The touch is the start of the last request, so a long last request does not eat into it.
export const PREPARE_MARGIN_MS = 300_000
// The request that writes the handoff must start at least this long before the cache expires, or it writes the context anew. Only a late
// timer (after system sleep) comes this close.
export const PREPARE_MIN_LEFT_MS = 60_000
// Below the baseline plus this distance a fresh session costs more than carrying on with a cold cache: the handoff itself and what the
// fresh session reads again. Rounded from the cost model, with the re-reading estimated at 20000 tokens.
export const BASELINE_DISTANCE = 30_000
// A request that read this share of the context from the cache found it warm.
export const HIT_SHARE = 0.8

export const floorOf = (configured: number, baseline: number | undefined): number | undefined =>
  configured > 0 ? configured : baseline === undefined ? undefined : baseline + BASELINE_DISTANCE

export type PlanSnapshot = {
  on: boolean
  lifetime: Lifetime | undefined
  tokens: number | undefined
  floor: number | undefined
  handingOver: boolean
  // The session's timers the last stop named, one-shot and recurring: each begins a turn without the person, which would end the pause.
  timers: number
}

export const planVerdict = (s: PlanSnapshot): { plan: true } | { plan: false; why: string } => {
  if (!s.on) return { plan: false, why: 'switched off' }
  if (s.handingOver) return { plan: false, why: 'a handover runs' }
  if (s.lifetime !== '1h') return { plan: false, why: `cache lifetime ${s.lifetime ?? 'unknown'}` }
  if (s.timers > 0) return { plan: false, why: 'a timer of the session is set' }
  if (s.floor === undefined) return { plan: false, why: 'baseline unknown' }
  if (s.tokens === undefined) return { plan: false, why: 'context size unknown' }
  if (s.tokens < s.floor) return { plan: false, why: `context ${s.tokens} tokens below ${s.floor}` }
  return { plan: true }
}

export const prepareDueAt = (touch: number): number => touch + HOUR_MS - PREPARE_MARGIN_MS

export type FireSnapshot = { busy: string | undefined; lifetime: Lifetime | undefined; now: number; touch: number }

export const fireVerdict = (s: FireSnapshot): { go: true } | { go: false; why: string } => {
  if (s.busy !== undefined) return { go: false, why: s.busy }
  if (s.lifetime !== '1h') return { go: false, why: `cache lifetime ${s.lifetime ?? 'unknown'}` }
  if (s.now - s.touch >= HOUR_MS - PREPARE_MIN_LEFT_MS) return { go: false, why: 'the cache is about to expire or has' }
  return { go: true }
}

// How many completions a usage sums: one, unless a server tool (the advisor) ran inside the request, or a `$.model.fork` request tried a
// tool, was refused and asked again. The host then reports the sum of all of them, and the context it reports after the request is the last
// alone (measured on Claude Code 2.1.308 and 2.1.309: one advisor call sums two, two sum three). Rounded, not rounded up: a request that
// writes the handoff carries its own prompt on top of the context and comes out a little above one without any sum. So a sum counts from
// half a context more than one; a first completion smaller than half the last one would hide it, and the measured ones were over 99 percent.
export const completionsOf = (u: InputUsage, context: number): number => Math.max(1, Math.round(baselineOfUsage(u) / context))

const summed = (u: InputUsage, context: number | undefined): context is number => context !== undefined && context > 0 && completionsOf(u, context) > 1

// The size a request had: the usage itself, or where it sums several completions, the context the host reports after it. That is the
// last completion, larger than the first by what the passes between added (251 tokens measured with the advisor), which is on the safe side.
export const baselineOf = (u: InputUsage, context: number | undefined): number => (summed(u, context) ? context : baselineOfUsage(u))

// What the first completion of a request read from the cache, at least. The cache works by prefix and a request only grows the
// conversation, so each later completion reads no more than the context of the one before it. Taking every later read off the summed reads
// leaves at least the context less the summed fresh input and writes; what a pass added before the next one is written by that next one, so
// it sits in both and cancels out. Measured 2 to 4 tokens under the true value, which only ever takes a hit for a miss. Without a sum the
// read itself, which is exact: a request that writes the handoff carries its own prompt, and taking it off would read a hit as a miss.
export const firstReadOf = (u: InputUsage, context: number | undefined): number =>
  summed(u, context) ? Math.max(0, context - u.input_tokens - u.cache_creation_input_tokens) : u.cache_read_input_tokens

// Whether a request found the cache warm: what it read against the share of `against`. `context` is the context the host reported after
// it; without it, a summed usage cannot be told apart and counts as one request.
export const isHit = (usage: InputUsage | undefined, against: number, context?: number): boolean =>
  usage !== undefined && firstReadOf(usage, context) >= HIT_SHARE * against

export type ReturnSnapshot = { now: number; touch: number; busy: boolean; attachments: boolean }

// The first message after the handoff was written. Cold is read off the clock at that moment and never from a mark a timer set: after system
// sleep a timer comes late, and a mark would take a cold cache for a warm one. A warm cache is cheap to read on, so only a cold one is left.
// Work that runs would report into a session that cannot place it, and an attachment cannot be carried over.
export const returnVerdict = (s: ReturnSnapshot): 'warm' | 'busy' | 'attachments' | 'cold' =>
  s.now - s.touch < HOUR_MS ? 'warm' : s.busy ? 'busy' : s.attachments ? 'attachments' : 'cold'

// How long the session sat idle, as the line after the switch says it.
export const idleFor = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}
