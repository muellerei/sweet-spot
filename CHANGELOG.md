# Changelog

All notable changes to context-relay are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- `dry_run` is off by default: after install the mod hands over, and turning `dry_run` on makes it only report. A mod that does nothing until a setting is found looks like one that does not work.
- `handoff_command` is empty by default, and empty now means no command: the fork writes the handoff at once, with no fallback line. A command that only shares the name `handoff` is not the user's to run. Set it to use your own.
- The handoff request now says the session is handed over at a size limit, often in the middle of a task, and asks for what that task needs to carry on: the state, the next step, the files it touches by path, the open decisions. The same sentence leads the fork's default prompt. Aim: less for the fresh session to read again.
- The fork's default prompt also asks for the skills the new session should call and for secrets to be redacted, as the user's own `/handoff` does.
- With `trace` on, the first three pauses after a successful handoff are traced with the fresh session's context and the context before the handoff (`after handoff: context 90000 tokens (210000 before the handoff), pause 1`), so what the handoff costs to read again can be taken from the log.
- With `trace` on, the pause line also shows the account's rate-limit windows (`limits five_hour 34.5%, seven_day 61%`), so a handoff can be read against the week's limit. Off a subscription there are none and the line is as before.

## [0.1.0] - 2026-10-08

First version. The mod only reports what it would do until `dry_run` is turned off.

### Added

- Hands the session over at the end of an answer once the context passes `threshold` (default 200000, lowered to 80 percent of a small window): runs the user's `/handoff` command and waits for that command's own turn (the first to start after it, so that a `/loop` trigger or a queued prompt ending first is not mistaken for it), reads the file it wrote, clears the session and submits the handoff as the first message of the new one.
- Falls back to a fork of the history when the command is missing, fails or names no file and none is found in the temp directory, and says why. A file the answer names must have been written since the command started and be under 200000 bytes, or it counts as no handoff (a file in a directory that cannot be listed is let through).
- Postpones while a subagent, a background task or a one-shot timer runs, and says so once per reason. Past an emergency brake (150k above the threshold, at most 90 percent of the window) it goes ahead and says so.
- Cancels the handoff when its turn is interrupted: no fork and no `/clear`, the session stays as it was. A failed or refused turn still falls back to the fork.
- Holds what is typed while a handoff runs and submits it with the handoff; `/context-relay redeliver` submits the handoff again when the fresh session did not get it.
- Settings `threshold`, `dry_run` (on by default), `min_gap_minutes`, `min_gap_turns`, `handoff_command` and `trace` (off by default; one line per event in the transcript, for finding out why a handoff did or did not happen). A value that does not fit is refused with its reason and the mod stays off, instead of being replaced by a default.

### Measured in real handovers

- Threshold 200000 reached at 202k to 224k tokens (the highest after one turn of large file reads that added 77k). From the end of the turn to the first message of the fresh session: 20 to 34 seconds, nearly all of it the handoff turn itself (20 to 33 s); no gap over 1.2 s elsewhere. The fresh session started at 62k to 98k tokens.
- The handoff file was written to the temp directory without a question, in a session running with `bypassPermissions`.
- The handoff arrived as the first message of the fresh session, framed by the host as a plugin message, readable and complete.
- `/clear` and the submit run at the pause as intended, in that order, under 50 ms apart.
- With subagents running past the threshold it postponed with one line ("handoff postponed, a subagent is running") and stayed quiet at the pauses after it; it handed over at the first pause after the last subagent had finished. The emergency brake was not reached.
- With `trace` on, one handover wrote every expected line once and in order: threshold and brake in the pause line, the handoff command listed, started and its turn recognised, the path named in the answer, the file read, `/clear`, the submit and its end. The lines for a foreign turn ending first and for held typing did not occur, because neither happened.
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

- The stop that raised the handoff can come before the `turn.complete` of the turn it ends. The wait for the command's turn took that end for its own and read the file too early; it now ignores the turn that was current when the wait began.
- Input typed during a handoff that was equal to earlier input was dropped from the held list; every input is held now, repeats included.
- Input typed in the moment between the last look at the held list and the end of holding could be held and then forgotten; the last look and the end of holding are now one step.
- A handoff left pending by an earlier attempt took the typing of the next one; each handoff starts with no message pending.

- A stop that came before the end of its turn was judged at once, without knowing how the turn ended, so an interrupted, failed or refused turn could report "would hand over". Such a stop now waits for the end of its turn and only an answer counts. In the host the stop comes first, 4 to 5 ms before the end of its turn (measured on every turn observed); if the host sends no end for a turn, the mod does nothing for that turn.
- The replies of `/context-relay` began with the name twice ("context-relay: context-relay: nothing to redeliver"): the host puts the name in front of what a command returns, and the texts carried it too. They no longer do. A guess like `/context-relay wait 10000` is now named in the reply (`unknown argument "wait 10000", use …`) instead of getting a hint about `redeliver` alone.
- The first real handover logged "context-relay: context-relay: handing over now": the host puts the name in front of a log line itself and the mod's lines began with it too. The lines no longer carry the name.

### Not in this version

Countdown and button before it acts, early warning, keeping the prompt cache warm while you are away, a log file, compacting in place as a last resort, a setting for the order of the fallback.
