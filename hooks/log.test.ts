import { test, expect } from 'claude-code/testing'

import { levelOf, logger, refresh, shows, type Level } from './log'

const ORDER: Level[] = ['off', 'warn', 'info', 'debug', 'trace']
const VALID = 'off, warn, info, debug, trace'

test('shows: each level shows its own lines and those of the levels below it, never those above; off shows nothing', async () => {
  for (const configured of ORDER) {
    for (const line of ORDER.slice(1)) {
      expect([configured, line, shows(configured, line)]).toEqual([configured, line, ORDER.indexOf(line) <= ORDER.indexOf(configured)])
    }
  }
  expect(ORDER.slice(1).filter(line => shows('off', line))).toEqual([])
  expect(ORDER.slice(1).filter(line => shows('trace', line))).toEqual(['warn', 'info', 'debug', 'trace'])
  expect(ORDER.slice(1).filter(line => shows('info', line))).toEqual(['warn', 'info'])
})

test('levelOf: unset or empty is off; case and surrounding space do not count', async () => {
  expect(levelOf(undefined)).toEqual({ level: 'off' })
  expect(levelOf('')).toEqual({ level: 'off' })
  expect(levelOf('   ')).toEqual({ level: 'off' })
  expect(levelOf('DEBUG')).toEqual({ level: 'debug' })
  expect(levelOf(' debug ')).toEqual({ level: 'debug' })
  expect(levelOf('Trace\n')).toEqual({ level: 'trace' })
  for (const level of ORDER) expect(levelOf(level)).toEqual({ level })
})

test('levelOf: 1, true, 0, false, error and a typo are no level: warn, and the value that was not one', async () => {
  for (const raw of ['1', 'true', '0', 'false', 'error', 'debg', 'verbose', ' Nope ']) {
    expect(levelOf(raw)).toEqual({ level: 'warn', bad: raw.trim().toLowerCase() })
  }
})

test('logger: a line shows with its level in front when the level in force lets it through, and the level is asked at each line', async () => {
  const out: string[] = []
  let level: Level = 'off'
  const log = logger(
    () => level,
    text => out.push(text),
  )
  log('warn', 'a')
  level = 'info'
  log('warn', 'b')
  log('info', 'c')
  log('debug', 'd')
  level = 'trace'
  log('trace', 'e')
  expect(out).toEqual(['warn: b', 'info: c', 'trace: e'])
})

const memo = () => ({ logLevel: 'off' as Level, badLogLevel: undefined as string | undefined })

test('refresh: the value read becomes the level, and a valid value writes nothing', async () => {
  const out: string[] = []
  const m = memo()
  await refresh(
    async () => ' INFO ',
    text => out.push(text),
    m,
  )
  expect(m).toEqual({ logLevel: 'info', badLogLevel: undefined })
  await refresh(
    async () => undefined,
    text => out.push(text),
    m,
  )
  expect(m.logLevel).toBe('off')
  expect(out).toEqual([])
})

test('refresh: a value that is no level sets warn and writes one warn line naming it and the valid values', async () => {
  const out: string[] = []
  const m = memo()
  await refresh(
    async () => 'Verbose',
    text => out.push(text),
    m,
  )
  expect(m).toEqual({ logLevel: 'warn', badLogLevel: 'verbose' })
  expect(out).toEqual([`warn: log level "verbose" is not one of ${VALID}, logging at warn`])
})

test('refresh: the line comes once per new bad value, again for another one, and again for the same one after a valid one', async () => {
  const out: string[] = []
  const m = memo()
  const read = async (raw: string) =>
    refresh(
      async () => raw,
      text => out.push(text),
      m,
    )
  await read('debg')
  await read('debg')
  await read('DEBG')
  expect(out).toHaveLength(1)
  await read('verbose')
  expect(out).toHaveLength(2)
  await read('debug')
  expect(m).toEqual({ logLevel: 'debug', badLogLevel: undefined })
  await read('verbose')
  expect(out).toHaveLength(3)
})

test('refresh: two reads at once of the same bad value write one line', async () => {
  const out: string[] = []
  const m = memo()
  await Promise.all([
    refresh(
      async () => 'nope',
      text => out.push(text),
      m,
    ),
    refresh(
      async () => 'nope',
      text => out.push(text),
      m,
    ),
  ])
  expect(out).toHaveLength(1)
})

test('refresh: a read that throws leaves the level and what was reported as they were, writes nothing and does not throw', async () => {
  const out: string[] = []
  const m = { logLevel: 'debug' as Level, badLogLevel: 'nope' as string | undefined }
  await refresh(
    async () => {
      throw new Error('refused')
    },
    text => out.push(text),
    m,
  )
  expect(m).toEqual({ logLevel: 'debug', badLogLevel: 'nope' })
  expect(out).toEqual([])
})
