#!/bin/sh
# Runs checks.sh on this machine for each Claude Code version in the CI matrix (.github/workflows/check.yml), one after the other, or only
# for the versions given as arguments: `sh docs/src/ci-local.sh 2.1.296`. A check that passes against the Claude Code you use can still
# fail against another version, whose types lack a field.
#
# Each version gets its own install and its own copy of the working tree: the files git tracks or would track, so work not yet committed
# is checked too, and nothing ignored. The config folder is empty, as in the CI: no sign-in, none of your plugins, and the call that lays
# down the types reaches no model. Everything lives in one temporary folder, removed at the end.
set -e
root=$(cd "$(dirname "$0")/../.." && pwd)

if [ $# -gt 0 ]; then
  versions=$*
else
  versions=$(sed -n "s/^ *claude-code: *\[\(.*\)\].*/\1/p" "$root/.github/workflows/check.yml" | tr -d "' " | tr ',' ' ')
fi
[ -n "$versions" ] || { echo 'no Claude Code version found in the matrix of .github/workflows/check.yml' >&2; exit 1; }

base=$(mktemp -d "${TMPDIR:-/tmp}/sweet-spot-ci.XXXXXX")
trap 'rm -rf "$base"' EXIT

failed=''
for v in $versions; do
  echo "=== Claude Code $v"
  run="$base/$v"
  mkdir -p "$run/tree" "$run/config"
  (cd "$root" && git ls-files -co --exclude-standard) | rsync -a --files-from=- "$root" "$run/tree/"
  # check.py reads `git ls-files`, and the pictures check diffs against the copy as it came.
  git -C "$run/tree" init -q
  git -C "$run/tree" add -A
  git -C "$run/tree" -c user.name=ci -c user.email=ci@localhost commit -qm 'working tree'
  if npm install --silent --no-audit --no-fund --prefix "$run/cc" "@anthropic-ai/claude-code@$v" &&
    (cd "$run/tree" && env -u ANTHROPIC_API_KEY PATH="$run/cc/node_modules/.bin:$PATH" CLAUDE_CONFIG_DIR="$run/config" sh docs/src/checks.sh); then
    echo "=== Claude Code $v: passed"
  else
    echo "=== Claude Code $v: failed"
    failed="$failed $v"
  fi
done

[ -z "$failed" ] || { echo "failed:$failed" >&2; exit 1; }
