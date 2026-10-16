// Which background tasks never end by themselves: a dev server, a watcher, `tail -f`. Such a task is not work whose result anyone waits for, so
// it does not hold a handover back. Pure, no `$`.
//
// The test is the meaning of the command, read word by word, never a substring: `npm run build:dev` and `cd packages/vite && npm test` are
// not dev servers. Only what surely never ends is standing. A command that is not known, or that cannot be read (a subshell, `$(…)`, a
// heredoc), is waited for as before: a wrong "standing" lets a result arrive in the fresh session, a wrong "not standing" only waits.

import type { TaskSummary } from './pairing'

export type Flag = { name: string; group?: true }

// One row per rule. `command`: the command word, or two words (`docker compose`). `sub`: one of these must follow the command at once, with
// no flag between. `optionalSub`: the rule holds without a word after the command; one of these right after it joins the words shown.
// `notSub`: such a word anywhere in the command, not a flag, makes it end. `needs`: one of these flags must be there. `endsWith`: one of these
// makes it end. `noWordAfterSub`: a word right after the subcommand makes it end (`jupyter server list`). `part`: the words shown, from the
// rule's own words; a hit flag is shown without its value.
export type Rule = {
  key: string
  command: string[]
  sub?: string[]
  optionalSub?: string[]
  notSub?: string[]
  needs?: Flag[]
  endsWith?: Flag[]
  noWordAfterSub?: true
  part: 'command' | 'command sub' | 'command flag' | 'command sub flag'
}

const f = (name: string): Flag => ({ name })
const g = (name: string): Flag => ({ name, group: true })

export const RULES: readonly Rule[] = [
  { key: 'vite', command: ['vite'], optionalSub: ['dev', 'serve', 'preview'], notSub: ['build', 'optimize'], part: 'command sub' },
  { key: 'parcel', command: ['parcel'], optionalSub: ['serve', 'watch'], notSub: ['build'], part: 'command sub' },
  { key: 'next', command: ['next'], sub: ['dev', 'start'], part: 'command sub' },
  { key: 'nuxt', command: ['nuxt', 'nuxi', 'astro'], sub: ['dev', 'preview'], part: 'command sub' },
  { key: 'remix', command: ['remix', 'wrangler', 'netlify', 'vercel'], sub: ['dev'], part: 'command sub' },
  { key: 'gatsby', command: ['gatsby'], sub: ['develop', 'serve'], part: 'command sub' },
  { key: 'docusaurus', command: ['docusaurus'], sub: ['start', 'serve'], part: 'command sub' },
  { key: 'ng', command: ['ng', 'vue-cli-service', 'jekyll', 'mkdocs'], sub: ['serve'], part: 'command sub' },
  // `--smoke-test` starts it and ends.
  { key: 'storybook', command: ['storybook'], sub: ['dev'], endsWith: [f('--smoke-test')], part: 'command sub' },
  { key: 'start-storybook', command: ['start-storybook'], endsWith: [f('--smoke-test')], part: 'command' },
  { key: 'hugo', command: ['hugo'], sub: ['server'], part: 'command sub' },
  { key: 'expo', command: ['expo', 'react-native', 'react-scripts'], sub: ['start'], part: 'command sub' },
  { key: 'webpack serve', command: ['webpack'], sub: ['serve'], part: 'command sub' },
  { key: 'webpack watch', command: ['webpack'], needs: [f('-w'), f('--watch')], part: 'command flag' },
  {
    key: 'servers',
    command: [
      'webpack-dev-server',
      'http-server',
      'live-server',
      'serve',
      'uvicorn',
      'hypercorn',
      'puma',
      'daphne',
      'nodemon',
      'ts-node-dev',
      'watchexec',
      'memcached',
    ],
    part: 'command',
  },
  { key: 'gunicorn', command: ['gunicorn'], endsWith: [f('--check-config')], part: 'command' },
  { key: 'redis-server', command: ['redis-server'], endsWith: [f('--test-memory')], part: 'command' },
  { key: 'mongod', command: ['mongod'], endsWith: [f('--repair'), f('--shutdown')], part: 'command' },
  { key: 'python http.server', command: ['python', 'python3', 'python3.N'], sub: ['-m http.server'], part: 'command sub' },
  { key: 'python runserver', command: ['python', 'python3', 'python3.N'], sub: ['manage.py runserver'], part: 'command sub' },
  { key: 'flask', command: ['flask', 'streamlit'], sub: ['run'], part: 'command sub' },
  { key: 'rails', command: ['rails'], sub: ['s', 'server'], part: 'command sub' },
  { key: 'php -S', command: ['php'], sub: ['-S'], part: 'command sub' },
  { key: 'php artisan', command: ['php'], sub: ['artisan serve'], part: 'command sub' },
  { key: 'mix', command: ['mix'], sub: ['phx.server'], part: 'command sub' },
  { key: 'browser-sync', command: ['browser-sync'], sub: ['start'], part: 'command sub' },
  { key: 'mlflow', command: ['mlflow'], sub: ['ui', 'server'], part: 'command sub' },
  { key: 'tensorboard', command: ['tensorboard'], needs: [f('--logdir')], part: 'command flag' },
  {
    key: 'jupyter',
    command: ['jupyter'],
    sub: ['lab', 'notebook', 'server'],
    noWordAfterSub: true,
    endsWith: [f('--generate-config')],
    part: 'command sub',
  },
  { key: 'tsc', command: ['tsc'], needs: [f('-w'), f('--watch')], part: 'command flag' },
  { key: 'vitest sub', command: ['vitest'], sub: ['watch', 'dev'], part: 'command sub' },
  { key: 'vitest --watch', command: ['vitest'], needs: [f('--watch')], part: 'command flag' },
  { key: 'jest', command: ['jest'], needs: [f('--watch'), f('--watchAll')], part: 'command flag' },
  { key: 'node --watch', command: ['node', 'bun', 'deno'], needs: [f('--watch')], part: 'command flag' },
  { key: 'tsx watch', command: ['tsx', 'cargo', 'dotnet'], sub: ['watch'], part: 'command sub' },
  { key: 'compose watch', command: ['docker compose', 'docker-compose'], sub: ['watch'], part: 'command sub' },
  {
    key: 'compose up',
    command: ['docker compose', 'docker-compose'],
    sub: ['up'],
    endsWith: [g('-d'), f('--detach'), f('--wait'), f('--abort-on-container-exit'), f('--exit-code-from'), f('--no-start')],
    part: 'command sub',
  },
  { key: 'ngrok', command: ['ngrok'], sub: ['http', 'tcp', 'tls', 'start'], part: 'command sub' },
  { key: 'cloudflared run', command: ['cloudflared'], sub: ['tunnel run'], part: 'command sub' },
  { key: 'cloudflared --url', command: ['cloudflared'], sub: ['tunnel'], needs: [f('--url')], part: 'command sub flag' },
  { key: 'kubectl', command: ['kubectl'], sub: ['port-forward', 'proxy'], part: 'command sub' },
  { key: 'minikube', command: ['minikube'], sub: ['tunnel'], part: 'command sub' },
  // `-f` sends ssh to the background by itself, and the task ends at once.
  { key: 'ssh', command: ['ssh'], needs: [g('-N')], endsWith: [g('-f')], part: 'command flag' },
  // With `--pid` it ends with that process.
  { key: 'tail', command: ['tail'], needs: [g('-f'), g('-F'), f('--follow')], endsWith: [f('--pid')], part: 'command flag' },
  { key: 'journalctl', command: ['journalctl'], needs: [g('-f'), f('--follow')], part: 'command flag' },
  { key: 'minio', command: ['minio'], sub: ['server'], part: 'command sub' },
  { key: 'ollama', command: ['ollama'], sub: ['serve'], part: 'command sub' },
  { key: 'sleep', command: ['sleep'], sub: ['infinity'], part: 'command sub' },
]

// The script names and monorepo task names that start a server. Not `watch` nor `:watch`: such a script often runs a test runner without a
// watch flag (`"test:watch": "vitest"`), and with no terminal that runs once and ends. No prefix either: `dev:seed` ends.
const SCRIPTS = new Set(['dev', 'serve', 'preview', 'start', 'storybook'])

// Package manager flags passed over before the script name. Any other flag there leaves the command unknown, and it is waited for.
// `-w` takes a value for npm only (`--workspace`); for pnpm it is `--workspace-root`, with none.
export const VALUE_FLAGS = ['--prefix', '-C', '--dir', '--cwd', '--filter', '-F', '--workspace', '-w', '--loglevel'] as const
export const PLAIN_FLAGS = ['-r', '--recursive', '--parallel', '--stream', '-s', '--silent', '--workspaces', '-ws', '--if-present'] as const

export const RUNNERS = ['turbo', 'nx', 'nx run', 'nx run-many', 'lerna'] as const

export type Hit = { key: string; part: string }

// A quoted text stands in its word between two of these marks: `PORT="3000"` stays an assignment, a word with a quote in it is never a
// command word, and `plain` still finds a word that ends a command when it comes quoted (`vite "build"`).
const QUOTED = '\u0000'

type Token = { word: string } | { op: '&&' | '||' | '|' | '|&' | ';' | '&' | '\n' }

// The words and operators of a command line, or `undefined` for one that cannot be read safely: `$(…)`, a backtick, a heredoc, a quote that
// is escaped or never closed, a subshell or a group. Redirections and their targets are dropped, so `2>&1` and `&>` are no `&`, and so is a
// comment.
const tokens = (line: string): Token[] | undefined => {
  const out: Token[] = []
  let word = ''
  let inWord = false
  let target = false
  const push = () => {
    if (!inWord) return
    if (target) target = false
    else out.push({ word })
    word = ''
    inWord = false
  }
  const op = (o: Exclude<Token, { word: string }>['op']) => {
    push()
    const last = out[out.length - 1]
    // A line break right after an operator goes on with the same line: after `|` or `&&` the command is not over, after `;` it already is.
    if (o === '\n' && (last === undefined || 'op' in last)) return
    out.push({ op: o })
  }
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    const next = line[i + 1]
    if (c === ' ' || c === '\t') push()
    else if (c === '\\') {
      if (next === '\n') {
        push()
        i++
      } else if (next === '"' || next === "'") return undefined
      else {
        word += c + (next ?? '')
        inWord = true
        i++
      }
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1)
      if (end < 0) return undefined
      word += QUOTED + line.slice(i + 1, end) + QUOTED
      inWord = true
      i = end
    } else if (c === '"') {
      let j = i + 1
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === '\\') {
          if (line[j + 1] === '"') return undefined
          j++
        } else if (line[j] === '`' || (line[j] === '$' && line[j + 1] === '(')) return undefined
      }
      if (j >= line.length) return undefined
      word += QUOTED + line.slice(i + 1, j) + QUOTED
      inWord = true
      i = j
    } else if (c === '`') return undefined
    // A comment runs to the end of the line, and the shell does not read it.
    else if (c === '#' && !inWord) {
      const end = line.indexOf('\n', i)
      i = (end < 0 ? line.length : end) - 1
    } else if (c === '\n') op('\n')
    // A subshell, and with it `$(…)`.
    else if (c === '(' || c === ')') return undefined
    else if ((c === '{' || c === '}') && !inWord) return undefined
    else if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      if (c === '<' && next === '<') return undefined
      // A file descriptor written against the operator (`2>`) belongs to it.
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else push()
      let j = i + 1
      if (c === '&') j++
      if (line[j] === '>' || line[j] === '|') j++
      if (line[j] === '&') {
        j++
        // `>&1`, `>&-`: a descriptor, no file follows. `>& file` sends both to a file.
        if (/[\d-]/.test(line[j] ?? '')) {
          while (/[\d-]/.test(line[j] ?? '')) j++
          i = j - 1
          continue
        }
      }
      i = j - 1
      target = true
    } else if (c === '|') {
      if (next === '|') {
        op('||')
        i++
      } else if (next === '&') {
        op('|&')
        i++
      } else op('|')
    } else if (c === '&') {
      if (next === '&') {
        op('&&')
        i++
      } else op('&')
    } else if (c === ';') op(';')
    else {
      word += c
      inWord = true
    }
  }
  push()
  if (target) return undefined
  return out
}

// A word as the shell gives it to the command, with its quotes taken off.
const plain = (word: string): string => word.replaceAll(QUOTED, '')

// A word that is a variable the shell splits (`$FLAGS`, `${OPTS}`) can be any words, a flag that ends the command too.
const expanded = (word: string): boolean => word.startsWith('$')

// Shell words that open a construct whose body the mod does not read.
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'select', 'function'])

// The words of a command after the prefixes that only change how it runs, with a path taken off the command word; `undefined` when what is
// left cannot be a command.
const unprefixed = (words: readonly string[]): string[] | undefined => {
  let w = [...words]
  const assignment = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(s)
  for (;;) {
    const head = w[0]
    if (head === undefined) return undefined
    if (assignment(head)) w = w.slice(1)
    else if (head === 'env' || head === 'cross-env') {
      w = w.slice(1)
      while (w[0] !== undefined && (assignment(w[0]) || (head === 'env' && w[0].startsWith('-')))) w = w.slice(w[0] === '-u' ? 2 : 1)
    } else if (['nohup', 'exec', 'setsid', 'command', 'time', 'pnpx', 'bunx'].includes(head)) w = w.slice(1)
    else if (head === 'sudo') {
      w = w.slice(1)
      while (w[0]?.startsWith('-')) w = w.slice(w[0] === '-u' || w[0] === '-g' ? 2 : 1)
    } else if (head === 'nice') {
      w = w.slice(1)
      if (w[0] === '-n') w = w.slice(2)
      else if (/^-\d+$/.test(w[0] ?? '')) w = w.slice(1)
    } else if (head === 'caffeinate') {
      w = w.slice(1)
      while (w[0]?.startsWith('-')) w = w.slice(w[0] === '-t' || w[0] === '-w' ? 2 : 1)
    } else if (head === 'npx') {
      w = w.slice(1)
      while (w[0] === '-y' || w[0] === '--yes') w = w.slice(1)
    } else if ((head === 'pnpm' && (w[1] === 'exec' || w[1] === 'dlx')) || (head === 'yarn' && w[1] === 'dlx')) w = w.slice(2)
    else break
  }
  const head = w[0]
  if (head === undefined || head.includes(QUOTED)) return undefined
  const command = head.slice(head.lastIndexOf('/') + 1)
  return command === '' ? undefined : [command, ...w.slice(1)]
}

// A flag in a word: the word itself, the word with a value after `=`, or a letter in a group of short flags (`-fn`, `-NL`).
const flagIn = (word: string, flag: Flag): string | undefined => {
  if (word === flag.name || word.startsWith(`${flag.name}=`)) return flag.name
  const letter = flag.name.length === 2 ? flag.name[1] : undefined
  if (flag.group && letter !== undefined && /^-[A-Za-z]+$/.test(word) && word.slice(1).includes(letter)) return flag.name
  return undefined
}

const firstFlag = (words: readonly string[], flags: readonly Flag[]): string | undefined => {
  for (const word of words) {
    for (const flag of flags) {
      const hit = flagIn(word, flag)
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

const named = (word: string, name: string) => word === name || (name === 'python3.N' && /^python3\.\d+$/.test(word))

const ruleHit = (rule: Rule, words: readonly string[]): Hit | undefined => {
  for (const name of rule.command) {
    const parts = name.split(' ')
    if (!parts.every((p, i) => words[i] !== undefined && named(words[i], p))) continue
    const command = [words[0], ...parts.slice(1)].join(' ')
    const rest = words.slice(parts.length)
    let sub: string | undefined
    let afterSub = rest
    if (rule.sub !== undefined) {
      sub = rule.sub.find(s => s.split(' ').every((p, i) => rest[i] === p))
      if (sub === undefined) continue
      afterSub = rest.slice(sub.split(' ').length)
      if (rule.noWordAfterSub && afterSub[0] !== undefined && !afterSub[0].startsWith('-')) continue
    } else if (rule.optionalSub !== undefined && rest[0] !== undefined && rule.optionalSub.includes(rest[0])) sub = rest[0]
    if ((rule.notSub !== undefined || rule.endsWith !== undefined) && rest.some(expanded)) continue
    if (rule.notSub?.some(s => rest.some(w => plain(w) === s))) continue
    if (rule.endsWith !== undefined && firstFlag(rest.map(plain), rule.endsWith) !== undefined) continue
    const flag = rule.needs === undefined ? undefined : firstFlag(afterSub, rule.needs)
    if (rule.needs !== undefined && flag === undefined) continue
    const part = [command, rule.part.includes('sub') ? sub : undefined, rule.part.includes('flag') ? flag : undefined]
    return { key: rule.key, part: part.filter(p => p !== undefined).join(' ') }
  }
  return undefined
}

// The words after the package manager flags of the table, or `undefined` at a flag outside it. The key is the last flag passed over.
const pastFlags = (tool: string, words: readonly string[]): { rest: string[]; flag: string | undefined } | undefined => {
  let w = [...words]
  let flag: string | undefined
  while (w[0]?.startsWith('-')) {
    const word = w[0]
    if (word === '-w' && tool !== 'npm') {
      if (tool !== 'pnpm') return undefined
      flag = word
      w = w.slice(1)
      continue
    }
    const valued = VALUE_FLAGS.find(v => word === v || word.startsWith(`${v}=`))
    if (valued !== undefined) {
      flag = valued
      w = w.slice(word === valued ? 2 : 1)
    } else if ((PLAIN_FLAGS as readonly string[]).includes(word)) {
      flag = word
      w = w.slice(1)
    } else return undefined
  }
  return { rest: w, flag }
}

// `npm run dev`, `pnpm --filter web dev`, `yarn workspace web run dev`: the package manager, `run` if it is there, the script name.
const scriptHit = (words: readonly string[]): Hit | undefined => {
  const manager = words[0]
  let seen = pastFlags(manager ?? '', words.slice(1))
  if (seen === undefined) return undefined
  let key = seen.flag
  let rest = seen.rest
  if (manager === 'yarn' && rest[0] === 'workspace') rest = rest.slice(2)
  let run = false
  if (rest[0] === 'run') {
    run = true
    seen = pastFlags(manager ?? '', rest.slice(1))
    if (seen === undefined) return undefined
    key = seen.flag ?? key
    rest = seen.rest
  } else if (manager === 'npm' && rest[0] !== 'start') return undefined
  else if (manager === 'bun') return undefined
  const script = rest[0]
  if (script === undefined || !SCRIPTS.has(script)) return undefined
  return { key: key ?? 'script', part: [manager, run ? 'run' : undefined, script].filter(p => p !== undefined).join(' ') }
}

// `turbo [run] dev`, `nx serve web`, `nx run web:serve`, `nx run-many -t serve`, `lerna run dev`. Only the first task counts.
const runnerHit = (words: readonly string[]): Hit | undefined => {
  const [runner] = words
  if (runner === 'turbo') {
    const seen = pastFlags(runner, words.slice(1))
    if (seen === undefined) return undefined
    const run = seen.rest[0] === 'run'
    const task = seen.rest[run ? 1 : 0]
    return task !== undefined && SCRIPTS.has(task) ? { key: 'turbo', part: run ? `turbo run ${task}` : `turbo ${task}` } : undefined
  }
  if (runner === 'nx') {
    if (words[1] === 'run') {
      const task = words[2]?.split(':')[1]
      return task !== undefined && SCRIPTS.has(task) ? { key: 'nx run', part: `nx run ${task}` } : undefined
    }
    if (words[1] === 'run-many') {
      for (let i = 2; i < words.length; i++) {
        const word = words[i] ?? ''
        const inline = /^--targets?=(.*)$/.exec(word)
        const list = inline !== null ? inline[1] : word === '-t' || word === '--target' || word === '--targets' ? words[i + 1] : undefined
        if (list === undefined) continue
        const task = list.split(',')[0] ?? ''
        return SCRIPTS.has(task) ? { key: 'nx run-many', part: `nx run-many ${task}` } : undefined
      }
      return undefined
    }
    const task = words[1]
    return task !== undefined && SCRIPTS.has(task) ? { key: 'nx', part: `nx ${task}` } : undefined
  }
  if (runner === 'lerna' && words[1] === 'run') {
    const task = words[2]
    return task !== undefined && SCRIPTS.has(task) ? { key: 'lerna', part: `lerna run ${task}` } : undefined
  }
  return undefined
}

// One command of a pipeline.
const commandHit = (raw: readonly string[]): Hit | undefined => {
  if (raw.some(w => ['--help', '-h', '--version'].includes(plain(w)))) return undefined
  // A flag set to `false` is a flag not set.
  const words = unprefixed(raw.filter(w => !/^--?[^=]+=false$/.test(plain(w))))
  if (words === undefined) return undefined
  const [command] = words
  if (command === 'npm' || command === 'pnpm' || command === 'yarn' || command === 'bun') {
    const hit = scriptHit(words)
    // `bun --watch` is a watcher, not a script.
    if (hit !== undefined || command !== 'bun') return hit
  }
  if (command === 'turbo' || command === 'nx' || command === 'lerna') return runnerHit(words)
  for (const rule of RULES) {
    const hit = ruleHit(rule, words)
    if (hit !== undefined) return hit
  }
  return undefined
}

// A later stage of a pipeline that hands every line on and ends only when its input does. `grep` with a flag that stops early (`-m1`, `-q`)
// ends the pipeline at the first match.
const passesOn = (stage: readonly string[]): boolean => {
  const command = stage[0]?.slice(stage[0].lastIndexOf('/') + 1)
  if (command === 'tee' || command === 'cat' || command === 'ts') return true
  if (command !== 'grep' && command !== 'rg') return false
  return !stage.slice(1).some(word => {
    if (expanded(word)) return true
    const w = plain(word)
    if (/^--(max-count|quiet|silent|files-with-matches|files-without-match)(=|$)/.test(w)) return true
    const letters = /^-([A-Za-z]+)/.exec(w)
    return letters !== null && !w.startsWith('--') && /[mqlL]/.test(letters[1] ?? '')
  })
}

// The host cuts a long command and says so at its end. Only the part shown is read, and of that not the pipeline the cut ran through.
const CUT = /\.\.\. \[\+\d+ chars\]$/

// One shell around the whole command (`bash -c "…"`, `sh -lc '…'`) is read inside. A second one inside, or a shell behind a prefix or
// before a redirection, is not.
const SHELL = /^(?:bash|sh|zsh) +-l?c +(?:'([^']*)'|"((?:[^"\\]|\\.)*)") *$/

export const standingHit = (command: string): Hit | undefined => {
  const cut = CUT.test(command.trim())
  let line = command.trim().replace(CUT, '')
  const shell = SHELL.exec(line)
  if (shell !== null) line = shell[1] ?? shell[2] ?? ''
  const all = tokens(line)
  if (all === undefined) return undefined
  // Lists end at `;`, a line break or `&`; a list that ends in `&` runs in the background and holds nothing open.
  const lists: { pipelines: string[][][]; background: boolean }[] = []
  let stage: string[] = []
  let pipeline: string[][] = [stage]
  let pipelines: string[][][] = [pipeline]
  for (const t of all) {
    if ('word' in t) stage.push(t.word)
    else if (t.op === '|' || t.op === '|&') pipeline.push((stage = []))
    else if (t.op === '&&' || t.op === '||') pipelines.push((pipeline = [(stage = [])]))
    else {
      lists.push({ pipelines, background: t.op === '&' })
      pipelines = [(pipeline = [(stage = [])])]
    }
  }
  lists.push({ pipelines, background: false })
  // What the cut took off belongs to the last pipeline, and can end it (`| grep -m1`, `-d`, `build`, `dev` of `dev:seed`): it is not read.
  if (cut) pipelines.pop()
  for (const pipeline of lists.flatMap(l => l.pipelines)) {
    for (const stage of pipeline) if (stage[0] !== undefined && KEYWORDS.has(stage[0])) return undefined
  }
  for (const list of lists) {
    if (list.background) continue
    for (const pipeline of list.pipelines) {
      for (const [i, stage] of pipeline.entries()) {
        const hit = commandHit(stage)
        if (hit !== undefined && pipeline.slice(i + 1).every(passesOn)) return hit
      }
    }
  }
  return undefined
}

// The words of the command that the rule hit, for the person to see: never a path, a prefix, a value or a redirection.
export const standingPart = (command: string): string | undefined => standingHit(command)?.part

export const standingCommand = (command: string): boolean => standingPart(command) !== undefined

export const standing = (t: TaskSummary): boolean => t.type === 'shell' && t.command !== undefined && standingCommand(t.command)
