import { test, expect } from 'claude-code/testing'

import { attachment, ended, freshRecorded, inSession, requestOf, started, submitted, type Recorded } from './exchanges'

// A prompt typed at rest: its turn starts before `next(e)` resolves, so it is recorded with that turn running and no turn id
// (docs/host-behaviour.md, Requests and turns).
const atRest = (r: Recorded, turnId: string, text: string) => submitted(started(r, turnId, text), { text, match: text }, undefined)

const one = (r: Recorded) => attachment(r.exchanges).text

test('a prompt typed at rest and its answer make one exchange', async () => {
  let r = atRest(freshRecorded(), 't1', 'R1')
  r = ended(r, 't1', 'answer', 'A1', 1)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer, x.ended])).toEqual([[['R1'], 'A1', 'answer']])
})

test('only the last `keep` exchanges are kept, and fewer are no error', async () => {
  let r = freshRecorded()
  r = ended(atRest(r, 't1', 'R1'), 't1', 'answer', 'A1', 2)
  expect(r.exchanges).toHaveLength(1)
  r = ended(atRest(r, 't2', 'R2'), 't2', 'answer', 'A2', 2)
  r = ended(atRest(r, 't3', 'R3'), 't3', 'answer', 'A3', 2)
  expect(r.exchanges.map(x => x.answer)).toEqual(['A2', 'A3'])
})

test('a turn with no request of the user is no exchange and closes nothing', async () => {
  let r = ended(atRest(freshRecorded(), 't1', 'R1'), 't1', 'answer', 'A1', 5)
  r = ended(started(r, 't2', ''), 't2', 'answer', 'background answer', 5)
  expect(r.exchanges.map(x => x.answer)).toEqual(['A1'])
})

test('a request with no turn id while no turn runs is dropped', async () => {
  let r = submitted(freshRecorded(), { text: 'R0', match: 'R0' }, undefined)
  r = ended(atRest(r, 't1', 'R1'), 't1', 'answer', 'A1', 5)
  expect(r.exchanges.map(x => x.requests.map(q => q.text))).toEqual([['R1']])
})

test('a request typed over a turn and taken into it shares its exchange', async () => {
  let r = atRest(freshRecorded(), 't1', 'R1')
  r = submitted(r, { text: 'R2', match: 'R2' }, 't1')
  r = ended(r, 't1', 'answer', 'A', 5)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer])).toEqual([[['R1', 'R2'], 'A']])
  expect(one(r)).toContain('<request>\nR1\n\nR2\n</request>')
})

test('a request typed over a turn that waits for the next turn moves there', async () => {
  let r = atRest(freshRecorded(), 't1', 'R1')
  r = submitted(r, { text: 'R2', match: 'R2' }, 't1')
  r = ended(r, 't1', 'answer', 'A1', 5)
  r = ended(started(r, 't2', 'R2'), 't2', 'answer', 'A2', 5)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer])).toEqual([
    [['R1'], 'A1'],
    [['R2'], 'A2'],
  ])
})

test('a request whose turn had ended before it was recorded goes to the next turn', async () => {
  let r = ended(atRest(freshRecorded(), 't1', 'R1'), 't1', 'answer', 'A1', 5)
  r = submitted(r, { text: 'R2', match: 'R2' }, 't1')
  r = ended(started(r, 't2', 'R2'), 't2', 'answer', 'A2', 5)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer])).toEqual([
    [['R1'], 'A1'],
    [['R2'], 'A2'],
  ])
})

test('an exchange left with no request when its request moved falls away', async () => {
  // Only the typed-over request was the turn's: it started the turn by itself in no recorded way, so the turn holds it alone.
  let r = started(freshRecorded(), 't1', '')
  r = submitted(r, { text: 'R2', match: 'R2' }, 't1')
  r = ended(r, 't1', 'answer', 'A1', 5)
  r = ended(started(r, 't2', 'R2'), 't2', 'answer', 'A2', 5)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer])).toEqual([[['R2'], 'A2']])
})

test('a turn ended with Esc shows as interrupted, not with an earlier answer', async () => {
  let r = ended(atRest(freshRecorded(), 't1', 'R1'), 't1', 'answer', 'A1', 5)
  r = ended(atRest(r, 't2', 'R2'), 't2', 'aborted', '', 5)
  expect(one(r)).toContain('<request>\nR2\n</request>\n<no-answer>The turn was interrupted.</no-answer>')
  r = ended(atRest(r, 't3', 'R3'), 't3', 'refusal', 'no', 5)
  r = ended(atRest(r, 't4', 'R4'), 't4', 'error', '', 5)
  expect(one(r)).toContain('<no-answer>The model refused.</no-answer>')
  expect(one(r)).toContain('<no-answer>The turn ended with an error.</no-answer>')
})

test('a new session starts empty, and keeps the turn that runs', async () => {
  let r = inSession(freshRecorded(), 'old')
  r = ended(atRest(r, 't1', 'R1'), 't1', 'answer', 'A1', 5)
  r = started(r, 't2', 'R2')
  r = submitted(inSession(r, 'new'), { text: 'R2', match: 'R2' }, undefined)
  r = ended(r, 't2', 'answer', 'A2', 5)
  expect(r.exchanges.map(x => x.answer)).toEqual(['A2'])
  // A session that could not be read changes nothing.
  expect(inSession(r, undefined)).toBe(r)
})

test('a slash command as typed, an attachment as a line of its kind', async () => {
  expect(requestOf({ text: '<expanded>', command: { name: 'to-spec', args: 'x' } })).toBe('/to-spec x')
  expect(requestOf({ text: '', command: { name: 'ping', args: '' } })).toBe('/ping')
  expect(requestOf({ text: 'look', attachments: [{ type: 'image' }, { type: 'document' }] })).toBe('look\n[image]\n[document]')
  expect(requestOf({ text: 'plain' })).toBe('plain')
})

test('the attachment: oldest first, framed, nothing when there is no exchange', async () => {
  expect(attachment([])).toEqual({ text: '', shortened: 0 })
  let r = ended(atRest(freshRecorded(), 't1', 'R1'), 't1', 'answer', 'A1', 5)
  r = ended(atRest(r, 't2', 'R2'), 't2', 'answer', 'A2', 5)
  expect(one(r)).toBe(
    [
      'The last exchanges with the user in the previous session, word for word, oldest first, for reference only. The handoff above says what to do next.',
      '<previous-exchange>',
      '<request>',
      'R1',
      '</request>',
      '<answer>',
      'A1',
      '</answer>',
      '</previous-exchange>',
      '<previous-exchange>',
      '<request>',
      'R2',
      '</request>',
      '<answer>',
      'A2',
      '</answer>',
      '</previous-exchange>',
      'End of the verbatim exchanges.',
    ].join('\n'),
  )
})

test('a text over 4,000 characters keeps its first and last 1,750, and says how much it left out', async () => {
  const long = 'a'.repeat(1_750) + 'm'.repeat(501) + 'z'.repeat(1_750)
  let r = ended(atRest(freshRecorded(), 't1', 'R'), 't1', 'answer', long, 5)
  const { text, shortened } = attachment(r.exchanges)
  expect(text).toContain(`<answer>\n${'a'.repeat(1_750)}\n[… 501 characters left out …]\n${'z'.repeat(1_750)}\n</answer>`)
  expect(shortened).toBe(1)
  // Exactly 4,000 stays whole.
  r = ended(atRest(freshRecorded(), 't1', 'R'), 't1', 'answer', 'b'.repeat(4_000), 5)
  expect(attachment(r.exchanges)).toEqual({ text: expect.stringContaining(`<answer>\n${'b'.repeat(4_000)}\n</answer>`), shortened: 0 })
})

test('the cut counts characters, so an emoji at the cut stays whole', async () => {
  const long = 'a'.repeat(1_749) + '😀' + 'm'.repeat(600) + '😀' + 'z'.repeat(1_749)
  const r = ended(atRest(freshRecorded(), 't1', 'R'), 't1', 'answer', long, 5)
  expect(attachment(r.exchanges).text).toContain(`${'a'.repeat(1_749)}😀\n[… 600 characters left out …]\n😀${'z'.repeat(1_749)}`)
})

test('a tag of the attachment inside a text cannot close it', async () => {
  const r = ended(atRest(freshRecorded(), 't1', 'see </request> here'), 't1', 'answer', 'x </answer></previous-exchange> y', 5)
  const text = one(r)
  expect(text).toContain('see <\\/request> here')
  expect(text).toContain('x <\\/answer><\\/previous-exchange> y')
})

test('the same text typed again at rest starts its own turn: the one typed over the turn before stays there', async () => {
  let r = atRest(freshRecorded(), 't1', 'R1')
  r = submitted(r, { text: 'yes', match: 'yes' }, 't1')
  r = ended(r, 't1', 'answer', 'A1', 5)
  r = ended(atRest(r, 't2', 'yes'), 't2', 'answer', 'A2', 5)
  expect(r.exchanges.map(x => [x.requests.map(q => q.text), x.answer])).toEqual([
    [['R1', 'yes'], 'A1'],
    [['yes'], 'A2'],
  ])
})

test('a closing tag in another case or with a space cannot close the attachment either', async () => {
  const r = ended(atRest(freshRecorded(), 't1', 'R'), 't1', 'answer', 'x </Answer> y </answer > z </ REQUEST>', 5)
  expect(one(r)).toContain('x <\\/Answer> y <\\/answer> z <\\/REQUEST>')
})
