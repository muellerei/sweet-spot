# Changelog

All notable changes to sweet-spot are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.0] - 2026-10-31

### Added

- The fresh session's first message now carries your last request and Claude's final answer to it word for word, after the handoff. Before, only the handoff retold the end of the conversation, and you often had to ask again or paste the answer back in. The new setting `last_exchanges` says how many go along: 0 to 5, 1 by default, 0 for none. Only requests you typed count, a text over 4,000 characters keeps its first and last 1,750, and nothing in them is redacted, although the prompt asks the handoff to leave secrets out. With `builtin-compact` nothing is added. The exchanges live in memory only, so after a reload or `/resume` the earlier ones are not known ([#34](https://github.com/muellerei/sweet-spot/issues/34)).
- An icon for the plugin directory, `.claude-plugin/icon.png`: the scale from the README's sweet-spot picture, without its words. Without one, `claude plugin validate --profile directory --strict` fails.

### Changed

- The description in `plugin.json` and `marketplace.json` now says what sets the mod apart, the same as on GitHub: "Waits for a safe pause, then hands your session over or compacts it." The two had drifted apart, and `docs/src/check.py` now fails when they differ.

## [0.3.2] - 2026-10-23

### Fixed

- With the advisor on, a fresh session whose first request called it stored a baseline about twice the real size, and the idle handoff was no longer planned in that project where it would have paid off. Claude Code reports a request with the advisor inside it as the sum of its passes. sweet-spot now tells a sum from the usage against the context Claude Code reports after the request, and keeps that context as the baseline; read back from the transcript of a resumed session, the baseline is that request's last pass ([#29](https://github.com/muellerei/sweet-spot/issues/29)).

- After a warm return, a request with the advisor inside it was taken for a cache hit even when it missed the cache: its second pass reads what the first one just wrote, and together they read enough. sweet-spot then kept counting each handoff it wrote as a cache read, and a later return could count as warm while the cache was cold, so the handoff was dropped and the message stayed in the cold session. The check now looks at a lower bound of what the first pass read. If Claude Code reports no context after that request, the check now counts it as a miss and says so in a `warn` diagnostic line; before, it judged by the cache reads alone ([#29](https://github.com/muellerei/sweet-spot/issues/29)).

- The request that writes the idle handoff was taken for a cache hit when it tried a tool and missed the cache. Claude Code refuses the tool and the request asks again, so its usage sums both and the second reads what the first wrote. The handoff then counted as a cache read, with the same result: a later return could count as warm while the cache was cold. The check now looks at a lower bound of what the first request read ([#29](https://github.com/muellerei/sweet-spot/issues/29)).

## [0.3.1] - 2026-10-20

### Fixed

- A compact that another hook answered with messages of its own did not end the pause, and the idle handoff was written at minute 55 from a context that was already compacted. A mod that replaces Claude Code's summary this way passes the compact to no hook beneath it, so sweet-spot never saw it. Claude Code marks every compact in the transcript; when the idle handoff comes due, the mod now reads that mark, and a compact since the pause began ends the pause with nothing written. In a transcript too large to read whole it reads from where the pause began, since a compact that keeps messages word for word writes them again after its mark ([#22](https://github.com/muellerei/sweet-spot/issues/22)).

- A fresh session never planned the handoff after a long pause. The cache lifetime was read from the transcript once, at the end of the first turn, and Claude Code had not always written that turn's answer there yet; the lifetime stayed unknown for the whole session, and nothing was planned. Where the transcript holds no answer yet, the mod now reads it once more five seconds later and plans the pause from that read, and the next turn reads again as well ([#20](https://github.com/muellerei/sweet-spot/issues/20)).

- A compact that another hook held back still ended the pause: the handoff planned for minute 55 was never written, and one already written was dropped. Another mod, or a `PreCompact` hook in your settings, can answer a compact with `{ skip }`, and Claude Code does not try its own compact at minute 54 of a pause again, so the session was left with neither and the cache went cold. The pause now waits for the outcome: a compact held back or failed leaves it as it was, one that goes through ends it as before, and a handoff that comes due while a compact runs waits for it. A countdown still ends when a compact starts, so that no handover starts while it runs; it counts down again at the next pause ([#17](https://github.com/muellerei/sweet-spot/issues/17)).

- A handoff through your own command was refused when its file had no `.md` ending, and the session was compacted instead. The mod takes only a `.md` path, but the request it gives the command did not say so, and a command that names its file by `mktemp` gets no ending on macOS; it happened twice in one session with the path named correctly. The request now says that only a path whose file name ends in `.md` is taken. The mod still takes no other path, and still asks the command for nothing but the path ([#24](https://github.com/muellerei/sweet-spot/issues/24)).

### Security

- A handoff through your own command whose answer named no file took the newest `handoff-*.md` in the temp directory. Nothing tied that file to the run: your other sessions share the temp directory, and where it is a shared `/tmp`, so do other users of the machine. The mod now takes only the file the answer names; an answer without a path fails at the `path` stage, and the fallback method, if one is set, takes over as it does for any other failure there. See [GHSA-pf8f-rw68-qgf3](https://github.com/muellerei/sweet-spot/security/advisories/GHSA-pf8f-rw68-qgf3).

## [0.3.0] - 2026-10-16

### Added

- The first message of the fresh session names what still runs: each standing task with its full command and task id, under "Still running from the previous session, not waited for because they are not expected to end by themselves". When the emergency brake hands over despite work that ends, a second list names that work (a shell command by its command, a subagent by its type and description) and says its results arrive in the fresh session. Both lists come from the stop the handover was decided on, on every way that starts a fresh session, including coming back after a long pause. With nothing running the message is as before; `builtin-compact` keeps the session and has no such message.
- The countdown says what keeps running: `· npm run dev keeps running`, or `· 2 tasks keep running`. It shows only the words the rule hit, never a path, a prefix or a value such as a port or a token, cut to 30 characters. A task taken for a standing one by mistake shows here before the handover, while "Not now" can still hold it. In a narrow band this goes first.

### Fixed

- The band above the prompt took the place of whatever other mods draw there: while a countdown ran, or once a handoff written in a long pause had gone cold, another mod's band (a warning, its buttons) disappeared. The band now stands on top of what the rest draws, which stays as it is. When a survey holds the band, it shows as before ([#14](https://github.com/muellerei/sweet-spot/issues/14)).
- A dev server, a watcher or `tail -f` in the background held the handover back until the emergency brake, and after a long pause it kept your message in the old session with the cache cold. Such a task never ends by itself, so nothing waits for it any more: a background shell command that surely never ends (`npm run dev`, `vite`, `vitest --watch`, `docker compose up`, `ngrok http`, and the others in the table in `hooks/standing.ts`) no longer counts as running work. This holds at the pause, at the end of a countdown, for `asap` and on coming back after a long pause. Work that ends is waited for as before, and so is any command the mod does not know or cannot read safely (a subshell, `$(…)`, a script of your own). Writing the handoff at minute 55 is unchanged.

### Changed

- The pause line counts every running background task and the standing ones in it: `2 background tasks (1 standing)`. It names no command.

## [0.2.0] - 2026-10-15

### Added

- `/sweet-spot asap` hands over at the next pause, wherever the context stands: it lifts the threshold and the minimum gap, has no countdown, and is spent by the handover it starts. Work that is running still holds it back, until the emergency brake. Typed while no answer runs, it judges at once from what the last stop reported and what runs now, and starts the handover a moment after its answer. It ends a running countdown, a compact or `/clear` of your own, the end of the session and a context that has shrunk below where it was asked, and `later` after it takes it back. The help and the menu name it.
- `/sweet-spot status` says where the context stands in one line: the tokens against the window, where the next handover comes (the value a `later` set, with the threshold of the settings beside it) and the emergency brake. In a dry run it says that the mod only reports, with rejected settings it gives the reasons, and just after a compact, with no size read yet, it says so and still gives the threshold and the brake. It only reads, a running countdown goes on, and it runs at once while an answer is running. The help and the menu name it.

- Groundwork for a handoff after a long pause: at the first turn of every session (a start, `/clear`, a resume, a reload) the mod reads the transcript for how long the prompt cache lives, and keeps the size of the first request of a fresh session per project folder (its baseline) in the store. The first request of the session a handoff of the mod began is not taken: it is the handoff. A transcript above 4 MiB is read at its end with `tail -c`, the one process the mod starts; without `tail` the lifetime stays unknown and a `warn` line says so once a session. A change of model sets the lifetime it names.
- The handoff after a long pause is written ahead: with `idle_handoff` on (default; set it off to keep every session as it is) and an hour of cache, the end of each answer plans a step 55 minutes after its last request, and that step writes the handoff the internal way while the cache is still warm, quietly, leaving the session as it is. Only above the lower bound: `idle_handoff_min_tokens`, or with 0 (default) the baseline plus 30000. Not planned with a five-minute or unknown cache, below the bound, during a handover or with a timer of the session set (a `/loop`, a wakeup); a new turn, the end of the session, a compact and a change of model end the pause, and a turn other than the command's own, a compact or a change of model while the handoff is being written drops what it writes. When it is due it reads the transcript again and holds back for a turn, a handover, a countdown, a running subagent, or a cache that expires within the minute. What is typed meanwhile is held for that moment and goes in after. A handoff that cannot be written is said once; in a dry run the mod only logs that it would prepare. What happens when you come back has an entry of its own below.
- With `handoff_method` `external-command` the handoff after a long pause is written by your command, in a turn added to the session; the context stays whole. Its turn ends no pause and plans nothing, and its requests count as reading the cache. A command that gives no handoff leaves the writing to the mod, whatever the fallback names, unless it is `none`; a compact is never used for it. A permission the command's turn asks for while the handoff is written is turned down at once, since nobody is there to answer, and the mod writes the handoff instead; every other permission prompt shows as before.
- Once the handoff written in a long pause has gone cold, the band above the prompt says that your next message starts a fresh session, and that `/sweet-spot later` keeps you here. The band has no key and no countdown, a survey has the band while it shows, and it goes with the handoff; in a dry run there is none. After system sleep the first key you type brings it up. `/sweet-spot later` with the handoff written drops it, says so in front of its usual answer, and otherwise works as ever; the help and the menu name it.
- The mod checks that writing the idle handoff really keeps the cache, as measured: after a warm return, the first request of the next turn should read the context from the cache. If it misses, a `warn` line says so once, and for the rest of the session writing the handoff no longer counts as a read. Coming back is then judged from your own last request, and the band follows the same clock.
- `/sweet-spot asap` at rest with the idle handoff written: with the cache cold it hands that handoff over instead of writing a new one on a cold cache; with the cache warm it drops it and writes a new one, which carries everything up to now. Running work holds both back, as before.
- `/sweet-spot status` names a standing `asap` (`asap: hands over at the next pause`), and after it the idle handoff: planned with the minutes until it is written, written with the time its cache runs out, or written and cold. It says nothing of it while none is planned or written.
- Coming back after a long pause with the handoff written: the first message you send takes the handoff at once, so a second one sent right after never sees it too, and is judged by the clock. With the cache expired the message is held, `/clear` starts a fresh session and the handoff goes in with your message after it; a line then says how long the session sat idle and that the old one is in `/resume`, and the message is cleared from the prompt unless you changed it meanwhile. The switch spends `later` and `asap` like any handover, and fails like one: before `/clear` the message goes into the session as it was, after it `/sweet-spot redeliver` submits it. With the cache still warm the message goes into this session and the handoff written is dropped. Running work (a subagent, a background task) and an attachment keep the message in this session too, and a line says why. Slash commands and what other parts of the system send go through and leave the handoff for later. In a dry run a line says it would have switched, and the message goes into this session.
- The idle handoff has its own page, [docs/idle-handoff.md](docs/idle-handoff.md): when a fresh session is worth it, what happens, the costs and the limits. The README names it, the transcript read and the one process it starts, and that `/resume` leads back to the old session after any handoff.

### Limits found

- From 2.1.299 Claude Code can compact an idle session of 200,000 tokens or more itself at minute 54, a minute before the idle handoff would write; that session gets no handoff. The mod lets it run on purpose: `threshold` hands a session over at its first pause past that size, and `"idleCompaction": false` in `settings.json` leaves the pause to the mod. The reasoning is in [#9](https://github.com/muellerei/sweet-spot/issues/9), the comparison in [docs/idle-handoff.md](docs/idle-handoff.md#claude-codes-own-idle-compaction).
- Where an organisation manages Claude Code, the mod does next to nothing: some of the events it relies on reach only plugins listed in the managed settings. This comes from `claude plugin validate`, not from a managed installation.

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
