# Testing a mod against a host that is not there

The tests run inside Claude Code (`claude plugin test .`), on `claude-code/testing`, with no model and no real session. Whatever the mod
asks the host, a test answers. This page explains how context-relay builds that host in `hooks/test-support.ts`, where it differs from
the real one, and what makes a test worth having. It is meant for anyone writing a mod of their own as much as for changes here.

## The pieces

A test body gets two things: `$`, to raise events as the host would (`$.session.start`, `$.turn.start`, `$.classic.Stop`,
`$.turn.complete`, `$.prompt.submit`, `$.command.run`), and `on`, to answer the calls the mod makes. `test-support.ts` builds the host
from three layers, each a function that registers answers with `on`:

- `withMod` records what the mod shows: toasts, log lines, debug lines, the command it registers.
- `sessionWith` is what the mod reads at a stop: context size, window, turn count, running agents, rate limits. It also brings a clock
  (`mock.clock`), so a test moves time on and lets what is due run (`clock.advance`, `clock.settle`).
- `hostWith` is the session as a handoff touches it: the command list, the commands that run, the files, the store, `/clear` and the
  submit. Each step lands in `host.steps`, so a test can say what happened in what order (`['run handoff …', 'run clear', 'submit …']`).

On top sit the moments a test is about: `pause` (an answer ends), `reachThreshold` (a pause past the threshold, with the handoff under
way), `commandTurnEnds` (the command's turn ends with an answer), `typeInto` (a person types).

## Where the fake differs from the host

- **The order of a pause.** `pause` sends `turn.complete` first and the stop after it, because that is the simpler order for most
  tests. The real host sends the stop first (see [host-behaviour.md](host-behaviour.md), Events and their order). The mod handles both;
  the tests about the order send the stop first themselves (`order.test.tsx`, `interleave.test.tsx`, and the one in `handover.test.tsx`
  about a stop before the end of its turn). A change to how a pause is recognised needs a test in that order.
- **What is measured and what is not.** `hostWith` copies what was measured: `command.run` settles before the turn it starts, and two
  commands can share a short name. The rest is how the host is believed to behave; where a belief is not obvious, the code says so at the
  place. host-behaviour.md says how sure each one is.
- **What a test cannot do.** A test under `hooks/` can import only relative paths and `claude-code`; it cannot read the repository's
  files. Checks that compare the code with `plugin.json` or the README run outside the host, in `docs/src/check.py`. A delayed call does
  not fire in a headless run either; a test waits for what it started.

## Wording is spelled out

The texts the mod says are written out in the tests (`DUE`, `HANDED`, `failure(…)` at the end of `test-support.ts`), never imported
from the mod. A test that took its wording from the mod would never notice the mod's wording change.

## A test has to be able to fail

A test for a fix is worth something only if it fails without the fix. Before a fix is done, take it out again and run the test; it has
to turn red.

An example of a test that did not, from this repository. The CHANGELOG lists a defect: the stop that raised the handoff can come before
the `turn.complete` of its turn, and the wait for the command's turn took that end for its own. The test for it, in
`handover.test.tsx`, sent the stop, then the end of the turn, and checked that the handoff went on only after the command's own turn.
It passed with the guard against that end removed, because by then a stop was judged only once its turn had ended: the handoff could
not have started early, and the guard could not be reached. The test now also checks that nothing has started right after the stop.
With that line it fails as soon as the stop is judged on its own, and the guard is gone.

## Running them

- `claude plugin test .` runs every test. Run from the root of a clean clone: the command also picks up tests in untracked folders.
- The CI runs the same tests against the version the mod is developed against and against `latest`, and once a week without a commit,
  so a new Claude Code that changes the interface shows up. See [development.md](development.md) for the other checks.
