# Changelog

All notable changes to sweet-spot are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-10-11

First version.

### Added

- Hands the session over at the end of an answer once the context passes `threshold` (default 200000, lowered to 80 percent of a small window), and says so in one line. The default way, `internal-handoff`, has the mod write the handoff itself from the session history; the fresh session gets it as its first message after `/clear`.
- Choice of the way in the settings: `handoff_method` (`internal-handoff`, `external-command`, `builtin-compact`) and `handoff_fallback` (default `builtin-compact`; any of the ways, or `none`), both choices in `/config`. `external-command` runs your own `/handoff` command, waits for that command's own turn (the first to start after it, so a `/loop` trigger or a queued prompt ending first is not mistaken for it), reads the file it wrote and needs `handoff_command`. `builtin-compact` runs Claude Code's own `/compact` after the turn that crossed the threshold; the session stays, nothing is cleared or submitted afterwards, and the line says "compacted" instead of "handed over".
- When the main way fails before it changed the session, the fallback takes over and the line says why and which way took over; when both fail, both reasons are said. The same value in both settings is no fallback. A way that can never run (`external-command` with no command, an unknown value) switches the mod off with the reason. When `/clear` fails, a fallback that needs `/clear` too is not tried, and the line says so. A file the command names must have been written since the command started and be under 200000 bytes, or it counts as no handoff.
- A compact that leaves the context above the threshold is not repeated at every minimum gap: the first tool call after it, or the next pause in a turn without one, finds it out; from then on `builtin-compact` counts as failed until a pause is below the threshold again, the fallback takes over with the reason, and with no fallback the mod says so once and leaves the session alone.
- A countdown before an automatic handover: at the pause that would hand over, a line above the prompt says what is coming and counts down `countdown_seconds` (default 10, a whole number from 0 to 60; 0 hands over at once). "Not now", a button on key `1` in an empty prompt, moves the handover back as `/sweet-spot later` with no number does and answers the same way. Typing, a submit, a new turn (a finished background task starts one too), `later`, the end of the session, a reload and a compact the mod did not start end the countdown without moving anything; the next pause counts down again. A draft in the prompt holds the countdown back to the next pause; after two pauses that did not hand over, the countdown comes without "Not now", typing does not stop it, and it says the draft stays in the prompt. When it runs out the mod reads the prompt and the session again and hands over only if the fresh judgment still says so; text that came into the prompt without typing (the history, Tab) stops it, and so does a clock more than 3 s past the deadline. At the emergency brake there is no countdown, except once as an announcement without "Not now" when a handover was moved back to or past the brake. A survey in the band holds the countdown until it goes. With no terminal or desktop window to show the line (VS Code, mobile) the mod hands over at once.
- `/sweet-spot later [tokens]` moves the next handover back until the context has grown that many tokens past where it is now. With no number it takes `later_tokens` (default 25000). It holds for one handover only, never goes past the emergency brake and never brings a handover forward; anything that shrinks the context (a compact, yours too, or `/clear`) and a reload end it. A handover that begins spends it; a pause that ends with no handover (typing during a countdown, a new turn) does not. Where it cannot move the handover back it says why and changes nothing. It runs at once when typed while an answer is running.
- Postpones while a subagent, a background task or a one-shot timer runs, and says so once per reason. Past an emergency brake (150k above the threshold, at most 90 percent of the window) it goes ahead and says so.
- Cancels when the turn of the handover is interrupted: no `/clear`, the session stays as it was. Esc or "No" at a permission prompt in the turn of your own command cancels when the command writes no file because of it; a rule that denies the call still falls back.
- Holds what is typed while a handoff runs and submits it with the handoff; `/sweet-spot redeliver` submits the handoff again when the fresh session did not get it (typed during an answer it says so and does nothing).
- The handoff request says the session is handed over at a size limit, often in the middle of a task, and asks for what that task needs to carry on: the state, the next step, the files it touches by path, the open decisions. The prompt of the mod's own handoff also asks for the skills the new session should call and for secrets to be redacted.
- Settings `threshold`, `dry_run` (off by default; on, the mod only reports), `min_gap_minutes`, `min_gap_turns`, `later_tokens`, `countdown_seconds`, `handoff_method`, `handoff_fallback` and `handoff_command`. A value that does not fit is refused with its reason and the mod stays off, instead of being replaced by a default.
- Diagnostic lines in the transcript, off unless the environment variable `SWEET_SPOT_LOG_LEVEL` is set to `warn`, `info`, `debug` or `trace`; it is not a setting, so it is never shipped, shown in `/config` or on by default. A new value in the `env` block of a settings file counts from the next turn. At `debug` the first three pauses after a handoff show what the fresh session costs to read again; at `info` the pause line shows the account's rate-limit windows. The countdown's start, its end with the reason, "Not now" and the deferred pauses are named.
- Developed against Claude Code 2.1.296 (the CI matrix and the README).

### Chosen, with the reason

- **`threshold` 200000.** Measured in real sessions: calls above 200k tokens were about three quarters of the cost, and a simulation of the share the fresh session re-reads kept 200k the robust start across the assumptions tried. The lowest accepted value is 130000, because a fresh session starts at 62k to 98k tokens (measured) and a threshold close to that would hand over again soon after.
- **Minimum gap of 10 minutes or 5 turns.** Chosen, not measured. It ends after the minutes or the turns, because the turn count starts over after `/clear`.
- **A dry run starts the gap.** Otherwise every turn past the threshold would report "would hand over" again, because the context does not shrink.
- **The gap is kept after a failed handoff,** so a handoff that fails every time does not retry at every stop.
- **A message that did not reach the fresh session is kept in the store,** and `redeliver` finds it only while the mod has not been reloaded. It submits only into the session `/clear` made and refuses in any other; a `/clear` that returns with the same session fails the handoff instead of submitting into the session it was meant to leave.
- **A name is compared whole.** `claude-mem:handoff` stands beside `handoff` in the command list and is not the user's command.
- **`dry_run` is off by default.** A mod that does nothing until a setting is found looks like one that does not work.
- **A countdown of 10 seconds,** taken from auto-handoff as a starting value, not measured; to be checked after some weeks of use.
- **Two deferred pauses, then a countdown that typing does not stop.** Without a cap, a draft at every pause would push the handover up to the emergency brake, which hands over even past running work. Typing does not start the count over, or whoever types at every pause would get there all the same.
- **No "Not now" at the emergency brake.** The brake must not be moved back; a button or typing that stopped it would push the handover past it. Whoever pressed "Not now" before is told once instead of being handed over without warning.
- **3 s late ends the countdown.** A clock read that far past the deadline means the machine slept or the timer stayed out, and the person most likely never saw the line. An assumption, not measured.

### Measured in real handovers

What the host does is in `docs/host-behaviour.md`; these are the mod's own results.

- Threshold 200000 reached at 202k to 224k tokens. From the end of the turn to the first message of the fresh session: 20 to 34 seconds, nearly all of it the handoff turn itself. The fresh session started at 62k to 98k tokens.
- The handoff arrived as the first message of the fresh session, readable and complete.
- With subagents running past the threshold it postponed with one line and handed over at the first pause after the last subagent had finished; the emergency brake went ahead past a running background task.
- Esc during the handoff turn cancels the handoff, and the next end of an answer starts it again.

### Defects found and fixed while building

- The stop that raised the handoff can come before the `turn.complete` of the turn it ends. A stop now waits for the end of its turn before it is judged, and only an answer counts. If the host sends no end for a turn, the mod does nothing for that turn.
- The wait for the command's turn took that end for its own and read the file too early; it now takes only the end of the turn that starts after it.
- Input typed during a handoff that was equal to earlier input was dropped from the held list; every input is held now, repeats included.
- Input typed between the last look at the held list and the end of holding could be held and forgotten; the two are now one step.
- A handoff left pending by an earlier attempt took the typing of the next one; each handoff starts with no message pending.
- The replies of `/sweet-spot` and the first handover line began with the name twice, because the host puts the name in front itself. They no longer carry it. A guess like `/sweet-spot wait 10000` is named in the reply instead of getting a hint about `redeliver` alone.

### Not in this version

Early warning, keeping the prompt cache warm while you are away, a log file, a setting for the order of the fallback.
