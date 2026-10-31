# Working on sweet-spot

How to run the mod from a clone, change it, and check it the way the CI does. For the path a handoff takes, see
[architecture.md](architecture.md); for writing tests, [testing.md](testing.md); for what the host does, [host-behaviour.md](host-behaviour.md).

## What you need

- Claude Code in the version the mod is developed against: the first entry of the matrix in `.github/workflows/check.yml`, which is
  also the one under Install in the README (`docs/src/check.py` keeps the two equal). The CI also runs against `latest`.
- Node 22, for Prettier and TypeScript (`npx` fetches both).
- Python 3 and `git`, for `docs/src/check.py` and the pictures. Nothing to install.

## Running it from a clone

```bash
claude --plugin-dir .
```

This loads the checkout as the mod. If sweet-spot is also installed, disable that copy first: only one plugin of a name gets its
hooks, and the host says so with "another plugin of that name loads first".

To see a handoff without working up to the default threshold, lower `threshold` in `/config` (the README, under Settings, names the lowest it takes) or turn `dry_run` on
to see only what it would do. The settings and their defaults are in the README, under Settings. To see what the mod is doing, turn
on its log as described in CONTRIBUTING, under Debugging.

## Changing it

After a change to the code, restart Claude Code. A change in `/config` reloads the mod and empties its state (the minimum gap and what
`redeliver` can find); `/reload-plugins` does not call `register` again while the mod is unchanged, and whether it does for a changed
mod has not been measured.

## Checks

The CI runs `docs/src/checks.sh` on every push and pull request and once a week, once for each Claude Code version in the matrix of
`.github/workflows/check.yml`. The script lists the checks in their order. To run all of them here, against every version in the matrix,
before you push:

```bash
sh docs/src/ci-local.sh            # every version in the matrix
sh docs/src/ci-local.sh 2.1.296    # only this one
```

It checks the working tree as it is, files not yet committed included, and needs `npm`, `rsync` and `git`. Each version gets its own
install and its own copy of the tree, with an empty config folder as in the CI: no sign-in, none of your plugins, and no model is called.
A check can pass against the Claude Code you use and fail against another version, whose types lack a field the code reads.

`sh docs/src/checks.sh` runs the checks once, against the `claude` on your PATH. Run it from the root of a clean clone: `claude plugin
test .` also picks up tests in untracked folders.

`check.py` compares the numbers and versions written in more than one place, compares the choices and defaults of `handoff_method` and
`handoff_fallback` in `plugin.json` with `METHODS` and `DEFAULTS` in `config.ts`, and the default and span of `countdown_seconds` with `DEFAULTS` and
`COUNTDOWN_SECONDS` (the default also in the README's settings table), keeps the README and `plugin.json` free of the word the host
uses for the call that writes the handoff, keeps the diagnostic variable, `ui.log` and `env.get`
inside `register.tsx`, and keeps these pages free of anything a reader of the repository cannot follow. `build.sh` rebuilds the pictures; the diff after it
must be empty.

### Types

`tsc` checks against the types Claude Code lays down under `.claude-plugin/types/` when it loads the mod. A headless run lays them
down only with `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` (see [host-behaviour.md](host-behaviour.md), under Loading); an interactive session
does it on its own. No sign-in is needed: without one the call ends with "Not logged in", after the types are written. The types
follow the Claude Code that wrote them, so lay them down again after a change of version. Never commit them; their folder ignores
itself.
