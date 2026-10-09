# How the host behaves

What context-relay relies on about Claude Code that its documentation does not say, or says only in the types. Each entry says how sure
it is:

- **measured**: seen in a real session, with the date, the Claude Code version where it was recorded, and how it was seen
- **derived**: follows from something measured, not seen itself; it names what
- **assumed**: not seen; it names where it comes from (the types, the docs) or that nothing backs it
- **open**: not known

Each entry ends with what it means for a mod. The code says why it is built the way it is; this page says what the host does that the
why rests on. Verified against Claude Code 2.1.294 to 2.1.296. When the version the mod is developed against goes up (the first entry
of the CI matrix), the measurements the core rests on are taken again: the order of stop and turn end, `/clear` and the session, and
`command.run`.

## Events and their order

- **The stop comes before `turn.complete`.** `classic.Stop` arrives 4 to 5 ms before the `turn.complete` of the same turn. _Measured
  2026-10-08, version not recorded; live session, trace of every event, 10 of 10 turns._ A mod that judges at the stop does not yet know
  how the turn ended. context-relay pairs the two and judges once both are in (`pairing.ts`), in either order.
- **Esc during a turn ends it as `aborted`, with no stop.** _Measured 2026-10-09, version not recorded; live session, Esc during the
  handoff's own turn and during an ordinary turn._ A mod that waits for a stop after Esc waits forever; only `turn.complete` says the turn
  is over.
- **A turn without `turn.complete`.** _Assumed not to happen._ If the host ever sends a stop and no end, context-relay does nothing for
  that turn.

## `/clear` and the session

- **`/clear` starts the host's turn count over; the mod's state stays.** _Measured 2026-10-08, version not recorded; the fresh session
  reported turn 2 where the last attempt had been at turn 19._ A gap counted in turns alone would hold the next handoff back for many
  turns after a `/clear`, so context-relay's minimum gap ends after minutes or turns, whichever comes first.
- **The session id changes at once.** `$.session.id()` returns the fresh session right after `$.command.run('clear')` has returned.
  _Measured 2026-10-08, version not recorded; trace of the id before and after._ A mod can tell whether `/clear` did anything by
  comparing the id; the same id means it did not.
- **`/clear` and a submit at the pause run in that order, 29 ms apart.** _Measured 2026-10-08, version not recorded; timestamps in the
  debug log, two handoffs, 29 ms each._ A mod can clear and then submit without waiting in between.
- **A submit without `asUser` arrives as a plugin message** ("The context-relay plugin sent a message") and works as the first message
  of the fresh session. _Measured 2026-10-08, version not recorded; live handoffs._ The handoff does not pretend to be the user's words.
- **A background task survives `/clear`.** The process keeps running, and the fresh session reports it as running. _Measured
  2026-10-10, version not recorded; `sleep 1500` as a background task, then `/clear` by hand._ The work is not lost, but its result comes
  into a session that does not know what it was for; this is why context-relay postpones while work is running.
- **Text typed but not sent survives `/clear`.** It stays in the prompt field of the fresh session, neither sent nor mixed into the
  handoff. _Measured 2026-10-10, version not recorded; text typed during a handoff._ A mod need not hold back for a draft.

## Loading

- **Only one plugin of a name gets its hooks.** When a checkout is loaded with `--plugin-dir` while another copy of the same name
  loads first (installed, or from another source), the host says "hooks module not loaded: another plugin of that name loads first" and
  the checkout's hooks do not run. _Measured 2026-10-10, Claude Code 2.1.296; headless `claude -p` with a second copy loaded._ Disable
  the other copy while working on a checkout.
- **A headless run lays down the types only while it watches plugin folders.** `claude --plugin-dir . -p …` writes
  `.claude-plugin/types/` when `CLAUDE_CODE_PLUGIN_DIR_WATCH=1` is set, and not without it; signing in plays no part. _Measured
  2026-10-10, Claude Code 2.1.294 and 2.1.296; fresh clone, empty config folder, no key: with the variable the types were there and
  `tsc` passed although the call ended with "Not logged in", without it there were none._ A mod's CI can type-check against each
  Claude Code version it runs without a secret.

## Reload

- **A change in `/config` reloads the mod.** The debug log says the options changed and the mod was reloaded, and the mod's state is
  gone. _Measured 2026-10-08, version not recorded; a setting changed during a live session, the debug log read after._ Anything a mod keeps in memory (here: the minimum gap and what `redeliver` can find)
  ends with a setting change.
- **A reload during a handoff ends it without a word.** _Seen 2026-10-08 in the logs of a live session, version not recorded; what
  caused that reload is open._ A handoff cut off this way leaves the session as it was; the next pause past the threshold tries again,
  since the reload also cleared the minimum gap.
- **`/reload-plugins` does not call `register` again while the mod has not changed.** _Measured 2026-10-10, Claude Code 2.1.296; same
  timestamp before and after._ A value a mod reads once per load stays until Claude Code restarts; context-relay reads its log level at
  the start of every handler for this reason.

## Commands

- **`$.command.run` settles at once.** It returned `{}` after 18 ms; the turn the command starts ended about 9 seconds later. _Measured
  2026-10-08, Claude Code 2.1.294; throwaway mod, headless `claude -p`._ A mod cannot await a command's result; it has to wait for the
  end of the turn the command starts.
- **Two commands can share a short name.** The list held `handoff` (source `user`) beside `claude-mem:handoff` (source `plugin`).
  _Measured 2026-10-08, Claude Code 2.1.294; `$.command.list()` from a throwaway mod._ Compare the whole name, never a suffix.
- **A command cannot be run from a `command.run` hook.** The host refuses it: "it would wait on the turn this hook is holding … run it
  from a later event". _Measured 2026-10-08, Claude Code 2.1.294; throwaway mod, the error the host returned._ Start the command from a later event.
- **A stop is a hook the turn waits on.** _Derived from the refusal above, not measured for the stop._ context-relay starts a handoff
  only after the stop has returned.
- **A permission prompt in the command's turn holds it.** Without allow rules for what the command runs, the turn stops at a prompt
  until someone answers. _Measured 2026-10-09, version not recorded; live session started with project settings only, the handoff command of the project._
  context-relay gives up on the command's turn after 5 minutes and
  falls back to a fork; the README names the allow rules.
- **Esc at that prompt ends the turn as an ordinary answer,** not as `aborted`. _Measured 2026-10-09, version not recorded; Esc at the prompt in the same session._ The
  answer names no handoff file, so context-relay falls back to a fork rather than cancelling.

## Fork

- **`$.model.fork` without an answer returns `{ isAnswered: false, reason }`,** not `null`. The reasons the mod knows are `FORK_REASONS`
  in `handoff.ts`; any other is shown as the host gave it. _Measured 2026-10-09, version not recorded; handoffs through the
  fork with the command missing._ A mod has to read `isAnswered`, not test for `null`.
- **A fork cannot be cancelled.** _Assumed: its types offer no way._ context-relay limits the wait and ignores an answer that comes late.

## Output

- **The host puts the mod's name in front of log lines and command replies.** _Measured 2026-10-08, version not recorded, from the
  lines in a live session; the menu entry 2026-10-10, Claude Code 2.1.296, from `/context-relay redeliver`._ A mod's own text must not start with its name, or the name shows twice.
- **Lines from `ui.log` written before `/clear` leave the screen;** the debug log keeps them. _Measured 2026-10-10, Claude Code
  2.1.296; throwaway mod: two lines, `/clear`, a third line,
  with `--debug-file`._ What a person should still see after a handoff has to be said in the fresh session.

## Environment

- **`$.env.get` reads the mod's own variable.** A changed `env` block in the settings takes effect from the next turn; a `.env` file
  is not read. _Measured 2026-10-10, Claude Code 2.1.296; throwaway mod reading the variable at session start and at
  each turn, set at launch and in `.claude/settings.local.json`._ A mod that wants a value changed mid-session must read it again, not once at
  load. CONTRIBUTING, Debugging, names the variable context-relay reads.
- **The name of the variable must be a literal at the call.** _Assumed: the types require it._ Read each variable by its own call, not
  through a helper that takes the name.

## Running more than one

- **Two Claude Code processes with the mod run side by side without trouble.** _Measured 2026-10-08 and 2026-10-09, version not
  recorded; test sessions ran beside a working session._ A mod that keeps its state in memory is per process; nothing is shared. Two
  handoffs at the same moment were not run.

## Inside the mod

- **The host follows `$` only into functions of the file that declares `register`.** _Assumed._ This is why the calls on `$` live in
  `register.tsx` and the flow gets them as functions (`Io`); if it is wrong, that indirection can go.
- **The host checks type and `min` of each setting in `plugin.json` before it loads the mod.** _Assumed._ `config.ts` checks again.
- **A hook that throws is skipped.** _Assumed: the types say so._ A mod whose read fails should catch it itself, or the work of that hook is lost.
- **A hook has 10 seconds.** _Assumed: the types say so (build 2.1.293)._ Long work, like a handoff, starts after the hook has
  returned.
- **`/clear` and a submit run only once the session is idle.** _Assumed: the types say so (build 2.1.293)._ The order at the pause is
  measured above.

## Testing inside the host

- **Tests under `hooks/` can import only relative paths and `claude-code`.** _Measured 2026-10-10, Claude Code 2.1.296; `claude plugin test` refused a module importing
  `node:fs` and one importing `plugin.json`._ Checks that read files run outside the host (`docs/src/check.py`).
- **A delayed call from the first turn does not fire headless.** `$.clock.after(0, …)` did not run, because the process ends with the
  turn. _Measured 2026-10-08, Claude Code 2.1.294; throwaway
  mod, headless `claude -p`._ In a headless test, await the call inside the hook.

## Open

- An API error, `error` or `refusal` in the handoff's own turn.
- A fork on a cold cache. At a pause the cache has always been warm.
- Two handoffs at the same moment.
- Whether the host puts the name in front of the lines that answer typing during a handoff, which carry it themselves.
- Whether `/reload-plugins` loads a changed mod and calls `register` again.
- What can reload the mod in a session nobody is watching.
