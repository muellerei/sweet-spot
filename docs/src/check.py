# Fails when a number or version that is written by hand in more than one place has drifted.
# The pictures take their numbers from common.py; this compares everything else against it.
# Run: python3 docs/src/check.py   (from anywhere; Python 3, nothing to install)
import json, os, re, subprocess, sys
from common import THRESHOLD, FRESH

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')


def read(*path):
    with open(os.path.join(ROOT, *path), encoding='utf-8') as f:
        return f.read()


problems = []


def expect(found, wanted, where):
    """Every occurrence must equal the wanted value, and there must be one at least."""
    if not found:
        problems.append(f'{where}: nothing found, the pattern no longer matches the text')
    for value in found:
        if value != wanted:
            problems.append(f'{where}: {value!r}, expected {wanted!r}')


readme = read('README.md')
fresh = f'{FRESH[0] // 1000}k to {FRESH[1] // 1000}k'

expect(re.findall(r'A fresh session starts at (\d+k to \d+k)', readme), fresh, 'README Why, fresh session range')
expect(re.findall(r'fresh session: (\d+k to \d+k) tokens', readme), fresh, 'README Handoff or compact, fresh session range')
expect(re.findall(r'(\d+k) tokens, and at the end', readme), f'{THRESHOLD // 1000}k', 'README example threshold')
expect(re.findall(r'default of `(\d+)`', readme), str(THRESHOLD), 'README Why, threshold default')
expect(re.findall(r'\| `threshold`\s*\| `(\d+)`', readme), str(THRESHOLD), 'README settings table, threshold default')
expect([str(json.loads(read('.claude-plugin', 'plugin.json'))
            ['userConfig']['threshold']['default'])], str(THRESHOLD), 'plugin.json threshold default')

workflow = read('.github', 'workflows', 'check.yml')
pinned = re.findall(r"claude-code: \['([\d.]+)'", workflow)
if not pinned:
    problems.append('check.yml: no pinned Claude Code version found in the matrix')
expect(re.findall(r'Developed against Claude Code ([\d.]+);', readme), pinned[0] if pinned else None,
       'README developed-against version vs first entry of the workflow matrix')

# The diagnostic output is for developers only: one module owns it, and an environment variable,
# never a setting, switches it on. Tests under hooks/ cannot read source files (the host allows
# relative imports and "claude-code" only), so this boundary is guarded here.
VARIABLE = 'SWEET_SPOT_LOG_LEVEL'
tracked = subprocess.run(['git', 'ls-files'], cwd=ROOT, capture_output=True, text=True,
                         check=True).stdout.splitlines()

for path in tracked:
    if not path.startswith('hooks/') or path == 'hooks/register.tsx':
        continue
    if re.search(r'\.test\.tsx?$', path) or path == 'hooks/test-support.ts':
        continue
    text = read(path)
    for needle in ('ui.log', VARIABLE):
        if needle in text:
            problems.append(f'{path}: {needle} belongs in hooks/register.tsx only')

for path in tracked:
    if path.startswith('hooks/') or path in ('README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'docs/src/check.py'):
        continue
    try:
        text = read(path)
    except (UnicodeDecodeError, FileNotFoundError):
        continue
    if VARIABLE in text:
        problems.append(f'{path}: names {VARIABLE}; outside hooks/ only README, CONTRIBUTING and CHANGELOG do')

# The developer docs are read by people who have the repository and nothing else: no path into the
# author's untracked notes, none of the labels only those notes explain, and English throughout.
PRIVATE = [(r'(?<![\w/])local/', 'a path into untracked notes'),
           (r'\b[Ss]pec \d{3}\b|\b\d{3}-[A-Z]\d+\b', 'a spec or task number'),
           (r'\b[RM]\d{1,2}[a-z]?\b', 'a requirement or measurement label'),
           (r'[äöüÄÖÜß]', 'German text')]
for path in tracked:
    if not re.fullmatch(r'docs/[^/]+\.md', path):
        continue
    text = read(path)
    for pattern, what in PRIVATE:
        if re.search(pattern, text):
            problems.append(f'{path}: {what}; the docs are for readers of the repository only')

# The settings are exactly those the mod has defaults for, named in snake_case; so no log level can slip in, as it is an environment variable.
settings = set(json.loads(read('.claude-plugin', 'plugin.json')).get('userConfig', {}))
defaults = re.search(r'export const DEFAULTS: Config = \{([^}]*)\}', read('hooks', 'config.ts'))
if not defaults:
    problems.append('hooks/config.ts: no DEFAULTS found, the pattern no longer matches the code')
else:
    known = {re.sub(r'([A-Z])', lambda m: '_' + m.group(1).lower(), key) for key in re.findall(r'(\w+):', defaults.group(1))}
    for key in sorted(settings - known):
        problems.append(f'plugin.json: userConfig has {key!r}, which hooks/config.ts has no default for; the log level is an environment variable')
    for key in sorted(known - settings):
        problems.append(f'plugin.json: userConfig lacks {key!r}, which hooks/config.ts has a default for')

# The ways to hand over are written once, as METHODS in config.ts; the choices plugin.json offers and their defaults must be those.
config_ts = read('hooks', 'config.ts')
methods = re.search(r"export const METHODS = \[([^\]]*)\] as const", config_ts)
if not methods:
    problems.append('hooks/config.ts: no METHODS found, the pattern no longer matches the code')
else:
    ways = re.findall(r"'([^']+)'", methods.group(1))
    user_config = json.loads(read('.claude-plugin', 'plugin.json')).get('userConfig', {})
    for key, wanted in (('handoff_method', ways), ('handoff_fallback', ways + ['none'])):
        offered = user_config.get(key, {}).get('options')
        if sorted(offered or []) != sorted(wanted):
            problems.append(f'plugin.json: {key} offers {offered!r}, METHODS in hooks/config.ts gives {sorted(wanted)!r}')
        camel = ''.join(part.capitalize() if i else part for i, part in enumerate(key.split('_')))
        default = re.search(camel + r": '([^']*)'", defaults.group(1)) if defaults else None
        if not default or user_config.get(key, {}).get('default') != default.group(1):
            problems.append(f'plugin.json: {key} has default {user_config.get(key, {}).get("default")!r}, DEFAULTS in hooks/config.ts has {default.group(1) if default else None!r}')

# The README and plugin.json are for people who use the mod: the host's word for the call that writes the handoff is not theirs.
for path in (('README.md',), ('.claude-plugin', 'plugin.json')):
    if re.search(r'fork', read(*path), re.I):
        problems.append(f"{'/'.join(path)}: names the fork; users read 'handoff', 'handover' and 'compact'")

if problems:
    print('\n'.join(problems))
    sys.exit(1)
print('numbers, versions and the diagnostic boundary agree')
