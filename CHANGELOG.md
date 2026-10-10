# Changelog

All notable changes to sweet-spot are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- New `/sweet-spot later [tokens]`: moves the next handover back until the context has grown that many tokens past where it is now (`later 50k`), and says the value it hands over at and the context. With no number it takes the new setting `later_tokens` (default 25000). It holds for this one handover only, never goes past the emergency brake and never brings a handover forward; anything that shrinks the context (a compact, yours too, or `/clear`) and a reload end it. Where it cannot move the handover back it says why and changes nothing.
- `/sweet-spot` now runs at once when you type it while an answer is still running, instead of after the end of that answer, when the mod has already decided about the pause. `redeliver` typed during an answer says "an answer is running, try again when it is done" and does nothing; before, it waited and ran after the answer.
- Esc or "No" at a permission prompt in the turn of your own handoff command now cancels when the command writes no file because of it: no fallback hands over after it, and the line says "cancelled". Before, Esc at the prompt fell back to the mod's own handoff. A rule that denies the call still falls back, and so does a "No" followed by a hint if the command then writes the file the usual way.
- A compact that leaves the context above the threshold is not repeated at every minimum gap. The first tool call after it finds it out, or the next pause in a turn without one (the pause already holds the whole turn, and a turn that read a lot would look like a compact that did too little): from then on `builtin-compact` counts as failed until a pause is below the threshold again, the fallback takes over with the reason, and with no fallback the mod says so once and leaves the session alone.
- New way `builtin-compact` for `handoff_method` and `handoff_fallback`: Claude Code's own `/compact`, run after the turn that crossed the threshold. The session stays, nothing is cleared or submitted afterwards, and the line says "compacted" instead of "handed over". It is the default fallback. A compact the host refuses or a hook vetoes hands over to the fallback with the reason; Esc during the compact cancels and nothing else hands over. Lines that appear for every way no longer say "handoff" ("a handover is in progress", "cancelled, the session is as it was", "handover failed, …"), and with `builtin-compact` the lines for postponing, the dry run and starting say "compact".
- Developed against Claude Code 2.1.296 (the CI matrix and the README), the version `$.session.compact` is typed and measured in.
- When `/clear` fails, a fallback that needs `/clear` too is not tried, and the line says so ("the fallback needs /clear too"); before, a failed `/clear` ended the handoff without a word about it.
- Messages and log lines no longer say "fork": the mod writes the handoff itself ("the mod could not write the handoff: …", "writing the handoff was aborted", "internal handoff asked / answered / gave nothing", "fallback to internal handoff"), and the stage in the diagnostic is `model-fork`.
- `dry_run` is off by default: after install the mod hands over, and turning `dry_run` on makes it only report. A mod that does nothing until a setting is found looks like one that does not work.
- New settings `handoff_method` (default `internal-handoff`: the mod writes the handoff itself) and `handoff_fallback` (default `builtin-compact`, or `none` for no second try), both choices in `/config`. `external-command` runs your own command and needs `handoff_command`; a method that can never run, such as `external-command` with no command, or an unknown value, switches the mod off with the reason. When the main method fails before it changed the session, the fallback takes over and the line says why and which way took over; when both fail, both reasons are said. The same value in both settings is no fallback. `handoff_command` is only used with `external-command`; a command set before now needs `handoff_method` set to it. A command that only shares the name `handoff` is not the user's to run.
- The handoff request now says the session is handed over at a size limit, often in the middle of a task, and asks for what that task needs to carry on: the state, the next step, the files it touches by path, the open decisions. The same sentence leads the default prompt of the mod's own handoff. Aim: less for the fresh session to read again.
- The default prompt of the mod's own handoff also asks for the skills the new session should call and for secrets to be redacted, as the user's own `/handoff` does.
- With `SWEET_SPOT_LOG_LEVEL` at `debug`, the first three pauses after a successful handoff are logged with the fresh session's context and the context before the handoff (`after handoff: context 90000 tokens (210000 before the handoff), pause 1`), so what the handoff costs to read again can be taken from the log.
- With `SWEET_SPOT_LOG_LEVEL` at `info`, the pause line also shows the account's rate-limit windows (`limits five_hour 34.5%, seven_day 61%`), so a handoff can be read against the week's limit. Off a subscription there are none and the line is as before.

## [0.1.0] - 2026-10-08

First version. The mod only reports what it would do until `dry_run` is turned off.

### Added

- Hands the session over at the end of an answer once the context passes `threshold` (default 200000, lowered to 80 percent of a small window): runs the user's `/handoff` command and waits for that command's own turn (the first to start after it, so that a `/loop` trigger or a queued prompt ending first is not mistaken for it), reads the file it wrote, clears the session and submits the handoff as the first message of the new one.
- Falls back to a fork of the history when the command is missing, fails or names no file and none is found in the temp directory, and says why. A file the answer names must have been written since the command started and be under 200000 bytes, or it counts as no handoff (a file in a directory that cannot be listed is let through).
- Postpones while a subagent, a background task or a one-shot timer runs, and says so once per reason. Past an emergency brake (150k above the threshold, at most 90 percent of the window) it goes ahead and says so.
- Cancels the handoff when its turn is interrupted: no fork and no `/clear`, the session stays as it was. A failed or refused turn still falls back to the fork.
- Holds what is typed while a handoff runs and submits it with the handoff; `/sweet-spot redeliver` submits the handoff again when the fresh session did not get it.
- Settings `threshold`, `dry_run` (on by default), `min_gap_minutes`, `min_gap_turns` and `handoff_command`. A value that does not fit is refused with its reason and the mod stays off, instead of being replaced by a default.
- Diagnostic lines in the transcript, for finding out why a handoff did or did not happen. They are off unless the environment variable `SWEET_SPOT_LOG_LEVEL` is set to `warn`, `info`, `debug` or `trace`; it is not a setting, so it is never shipped, shown in `/config` or on by default. A new value in the `env` block of a settings file counts from the next turn.

### Measured in real handovers

- Threshold 200000 reached at 202k to 224k tokens (the highest after one turn of large file reads that added 77k). From the end of the turn to the first message of the fresh session: 20 to 34 seconds, nearly all of it the handoff turn itself (20 to 33 s); no gap over 1.2 s elsewhere. The fresh session started at 62k to 98k tokens.
- The handoff file was written to the temp directory without a question, in a session running with `bypassPermissions`.
- The handoff arrived as the first message of the fresh session, framed by the host as a plugin message, readable and complete.
- `/clear` and the submit run at the pause as intended, in that order, under 50 ms apart.
- With subagents running past the threshold it postponed with one line ("handoff postponed, a subagent is running") and stayed quiet at the pauses after it; it handed over at the first pause after the last subagent had finished. The emergency brake was not reached.
- With `SWEET_SPOT_LOG_LEVEL` at `debug`, one handover wrote every expected line once and in order: threshold and brake in the pause line, the handoff command listed, started and its turn recognised, the path named in the answer, the file read, `/clear`, the submit and its end. The lines for a foreign turn ending first and for held typing did not occur, because neither happened.
- A change in `/config` reloads the mod and resets its state.
- Esc during the handoff turn aborts it 30 ms in, before the command wrote anything: no `Stop` is sent, the mod cancels the handoff, and the next end of an answer starts it again.
- The emergency brake went ahead past a running background task (at 299832 tokens, threshold 130000).
- A command that names no file, or does not exist, falls back to the fork: 15 to 21 seconds, with the built-in prompt and with a prompt file; the fresh session resumed at 31k tokens.
- Without allow rules for the shell and file writes, Claude Code asks before the handoff command runs, and the question holds the handoff. The mod stays quiet while it waits, and the command's turn times out after 5 minutes, which falls back to the fork. Esc at the question falls back to the fork at once.

### Chosen, with the reason

- **`threshold` 200000.** Measured in real sessions: calls above 200k tokens were about three quarters of the cost, and a simulation of the share the fresh session re-reads kept 200k the robust start across the assumptions tried. The lowest accepted value is 130000, because a fresh session starts near 90k to 110k and would hand over again at once.
- **Minimum gap of 10 minutes or 5 turns.** Chosen, not measured. It ends after the minutes or the turns, because the turn count starts over after `/clear` (measured: the new session counts its turns from the start while the last attempt still points at the old count).
- **A dry run starts the gap.** Otherwise every turn past the threshold would report "would hand over" again, because the context does not shrink.
- **The gap is kept after a failed handoff,** so a handoff that fails every time does not retry at every stop.
- **A message that did not reach the fresh session is kept in the store,** and `redeliver` finds it only while the mod has not been reloaded. It submits only into the session `/clear` made (the host reports the fresh session as soon as `/clear` has returned; measured) and refuses in any other. A `/clear` that returns with the same session fails the handoff instead of submitting into the session it was meant to leave.
- **A name is compared whole.** `claude-mem:handoff` stands beside `handoff` in the command list and is not the user's command.

### Defects found and fixed while building

- The stop that raised the handoff can come before the `turn.complete` of the turn it ends. The wait for the command's turn took that end for its own and read the file too early. A stop now waits for the end of its turn before it is judged, so the wait begins after that end, and it takes only the end of the turn that starts after it.
- Input typed during a handoff that was equal to earlier input was dropped from the held list; every input is held now, repeats included.
- Input typed in the moment between the last look at the held list and the end of holding could be held and then forgotten; the last look and the end of holding are now one step.
- A handoff left pending by an earlier attempt took the typing of the next one; each handoff starts with no message pending.

- A stop that came before the end of its turn was judged at once, without knowing how the turn ended, so an interrupted, failed or refused turn could report "would hand over". Such a stop now waits for the end of its turn and only an answer counts. In the host the stop comes first, 4 to 5 ms before the end of its turn (measured on every turn observed); if the host sends no end for a turn, the mod does nothing for that turn.
- The replies of `/sweet-spot` began with the name twice ("sweet-spot: sweet-spot: nothing to redeliver"): the host puts the name in front of what a command returns, and the texts carried it too. They no longer do. A guess like `/sweet-spot wait 10000` is now named in the reply (`unknown argument "wait 10000", use …`) instead of getting a hint about `redeliver` alone.
- The first real handover logged "sweet-spot: sweet-spot: handing over now": the host puts the name in front of a log line itself and the mod's lines began with it too. The lines no longer carry the name.

### Not in this version

Countdown and button before it acts, early warning, keeping the prompt cache warm while you are away, a log file, compacting in place as a last resort, a setting for the order of the fallback.
