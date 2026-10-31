#!/bin/sh
# The checks, in order, against the `claude` on the PATH. The CI runs them once for each Claude Code version of its matrix
# (.github/workflows/check.yml), and ci-local.sh does the same on this machine. Run from the root of a clean clone: `claude plugin test .`
# also picks up tests in untracked folders.
set -e
cd "$(dirname "$0")/../.."

# In the CI each check is a group that folds away; a failed one is named in an annotation, since its group stays folded.
current=''
check() {
  if [ -n "$GITHUB_ACTIONS" ]; then
    [ -z "$current" ] || echo '::endgroup::'
    echo "::group::$1"
  else
    echo "== $1"
  fi
  current=$1
}
finish() {
  status=$?
  [ -z "$GITHUB_ACTIONS" ] || [ -z "$current" ] || echo '::endgroup::'
  if [ "$status" -ne 0 ]; then
    if [ -n "$GITHUB_ACTIONS" ]; then echo "::error::$current failed"; else echo "== $current failed" >&2; fi
  fi
}
trap finish EXIT

check 'Claude Code version'
claude --version

check 'Validate'
claude plugin validate . --strict

check 'Tests'
claude plugin test .

check 'Types'
# Claude Code lays down .claude-plugin/types/ only while it watches plugin folders, which a headless run does not do unless told to.
# No sign-in is needed: the call fails with "Not logged in" after the types are written.
CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude --plugin-dir . -p ok || true
npx -p typescript@5 tsc -p .

check 'Format'
npx prettier@3 --check hooks docs

check 'Numbers and versions'
python3 docs/src/check.py

check 'Pictures match their scripts'
sh docs/src/build.sh
git diff --exit-code -- docs
