# Fails when a number or version that is written by hand in more than one place has drifted.
# The pictures take their numbers from common.py; this compares everything else against it.
# Run: python3 docs/src/check.py   (from anywhere; Python 3, nothing to install)
import json, os, re, sys
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

if problems:
    print('\n'.join(problems))
    sys.exit(1)
print('numbers and versions agree')
