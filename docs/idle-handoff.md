# Idle handoff

When you leave a session alone for more than an hour, the prompt cache expires. Your next message then sends the whole conversation
again at the price of writing the cache, about twice the price of a normal input. The idle handoff avoids that: shortly before the cache
expires, sweet-spot writes a handoff while the cache is still warm, and if you come back after it has expired, your message starts a
fresh session with that handoff instead.

It is on by default (`idle_handoff`) and only works with a prompt cache that lives an hour.

## When a fresh session is worth it

Every session starts with a baseline: what Claude Code sends with your first message, such as the system prompt, tools, MCP servers and
`CLAUDE.md`, plus that message itself. sweet-spot measures it on the first turn of a fresh session and keeps it per project folder.

After the cache has expired, carrying on sends the whole conversation again at the write price. A fresh session sends only the baseline
and the handoff, plus whatever Claude has to read again to find its way back into the work.

So a fresh session pays off once the conversation has grown well past the baseline. By default the line is 30,000 tokens past it: with a
baseline of 50,000, a session at 70,000 tokens carries on as it is, and one at 150,000 gets a handoff written. Most sessions are past
that line after a few turns. If you would rather choose the size yourself, set `idle_handoff_min_tokens`.

Nothing is lost by the switch. The old session stays as it was, and `/resume` takes you back to it whenever you want the whole
conversation again.

## What happens

1. **At the end of each answer** the mod plans the next step for 55 minutes after the start of the answer's last request, which is when
   the cache was last read. It plans only with an hour of cache, a context above the line, and no timer of the session set (a `/loop`, a
   scheduled wakeup), since such a timer would start a turn on its own.
2. **At minute 55** it reads the transcript again and checks that the session is at rest: no turn, handover, countdown or subagent
   running. Then it writes the handoff, quietly. The session stays as it is. Writing the handoff reads the cache, which keeps it for
   another hour (measured, Claude Code 2.1.296: a return 57 minutes after the handoff was written still read the whole context from the
   cache). So the cache stays warm until about minute 115.
3. **Once the cache has expired**, the band above the prompt says so:
   `the cache has expired, your next message starts a fresh session with a handoff (/sweet-spot later to stay here)`.
4. **When you send a message**, the mod looks at the clock:
   - Cache still warm: the message goes into this session as usual, and the handoff written is dropped. Reading on is cheap.
   - Work still running (a subagent, a background task): the message stays in this session, because the result of that work would come
     into a fresh session that cannot place it. A line says so.
   - A message with an attachment: it stays in this session with its attachment, since the mod cannot carry attachments over. A line
     says so.
   - Cache cold: the message is held for a moment, the mod runs `/clear`, and submits the handoff with your message under it as the first
     message of the fresh session. A line then says, for example, `fresh session after 2 h 10 min idle, the old one is in /resume`.

Any turn that starts in the meantime, the end of the session, a compact and a change of model end the pause; the next answer plans
again. Typing and slash commands do not.

## Staying in the session

`/sweet-spot later` with a handoff written drops it: its answer starts with `idle handoff dropped, your next message stays in this
session.` and otherwise works as `later` always does. The band has no key on purpose: it stays up indefinitely, and a digit typed into an
empty prompt would be read as a key press, so an answer of "1" to a numbered question would drop the handoff and never arrive.

`/sweet-spot asap` with a handoff written takes it: with the cache cold it hands that handoff over instead of writing a new one, with the
cache warm it drops it and writes a fresh one, which carries everything up to now.

## How the handoff is written

- With `handoff_method` set to `external-command`, your own command writes it, in a turn that is added to the session; the context stays
  whole. If the command gives no handoff, the mod writes it itself, whatever `handoff_fallback` names, unless it is `none`.
- Otherwise the mod writes it itself, with the same prompt as at the threshold, including your own prompt file if you made one.
- Never a compact: a warm return must find the whole context.
- If your command asks for a permission while the handoff is written, nobody is there to answer. The mod turns it down at once, which
  ends the command's turn (measured, Claude Code 2.1.296), and writes the handoff itself. It never grants a permission, and any other
  permission prompt shows as usual.
- Your command must not start subagents. Claude Code runs them in the background, so the command's turn ends without their result, and
  when a subagent finishes, Claude Code starts a turn of its own, which ends the pause and drops the handoff (measured, Claude Code
  2.1.296).

## What you see

- Preparing is silent. If it fails, a line says so once: `could not prepare the idle handoff (<reason>), the session goes on as is`.
- `/sweet-spot status` adds where the handoff stands: `, idle handoff ready in 41 min` while it is planned,
  `, idle handoff ready, goes with your next message after 14:05` once written, and without the time once the cache has expired. A
  standing `asap` comes first: `, asap: hands over at the next pause`.
- With `dry_run` on, nothing is written and nothing switches: the mod logs that it would prepare, `status` names the handoff it would
  have, there is no band, and a cold return says `dry run, would start a fresh session with the idle handoff now`.

## Costs

C is the context size, S₀ the baseline and H the length of the handoff. In units of the normal input price, writing the handoff costs
about 0.1·C for reading the cache plus 5·H for the output. Against that:

| You come back                   | With the idle handoff                                               | Without                       |
| ------------------------------- | ------------------------------------------------------------------- | ----------------------------- |
| never                           | 0.1·C + 5·H, for nothing                                            | 0                             |
| between minute 60 and about 115 | 0.1·C + 5·H for the writing, then 0.1·C for the read, still warm    | 2·C, everything written again |
| after about minute 115          | 0.1·C + 5·H for the writing, then 2·S₀ plus what Claude reads again | 2·C                           |

## Claude Code's own idle compaction

Since 2.1.299 Claude Code can compact a long idle session itself, a minute before the idle handoff would write
([how it behaves](host-behaviour.md#idle-compaction)). Both deal with the cache that goes cold after an hour, in different ways:

|                                 | Claude Code's idle compaction                                   | Idle handoff                                                       |
| ------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| When                            | Minute 54 of a pause, from 200,000 tokens                       | Minute 55, from the baseline plus 30,000 tokens                    |
| Back within about an hour after | The session is already compacted, the full history is gone      | Nothing has changed: the full context, and the cache is still warm |
| Back later                      | The same session, compacted                                     | A fresh session with the handoff; the old one stays in `/resume`   |
| What it keeps                   | Claude Code's summary                                           | What the handoff prompt asks for, or the file of your own command  |
| Switched on by                  | Claude Code's server, so it may or may not run in your sessions | `idle_handoff`, on by default                                      |

Today Claude Code's compaction comes first: in a session it compacts, the idle handoff writes nothing. To have the idle handoff for
large sessions too, set `"idleCompaction": false` in your `settings.json`. If you would rather stay in the same session, change nothing;
below 200,000 tokens the idle handoff works as before.

## Limits

- **Only with an hour of cache.** With five minutes the handoff would have to be written after four minutes of every pause. Claude Code
  does not tell a mod how long its cache lives, so the mod reads it from the transcript: the last answer of the main conversation that
  wrote the cache says it. A change of model says it outright.
- **Reading the transcript.** Up to 4 MiB the mod reads the file; above that it reads only its last 256 KiB with `tail -c`, the one
  process it starts. Without `tail` (Windows without the Git tools on the path) the lifetime stays unknown, nothing is planned, and a
  `warn` line says so once a session.
- **The baseline.** A long first message raises it until the next fresh session; that errs on the safe side. The first message of a
  fresh session that a handoff of the mod began is the handoff, and is not taken. A resumed session uses the baseline kept for its
  project; with none kept yet, the first answer in its transcript, if the transcript is small enough to read whole.
- **System sleep.** Timers fire late after sleep. If the computer slept before minute 55, the cache is cold by then and nothing is
  written. If it slept after, the band comes with the first key you type; if you paste and send at once, you do not see it, and the line
  after the switch points to `/resume`.
- **Claude Code's own idle compaction** comes first from 200,000 tokens, and no handoff is written then. See
  [Claude Code's own idle compaction](#claude-codes-own-idle-compaction).
- **What the mod cannot see.** A `!` command runs before the mod sees anything, and its turn ends the pause. Another mod that keeps the
  cache warm with its own requests is invisible to sweet-spot: it then takes the cache for cold and switches when it need not.
- **Your status line.** Claude Code's own status line does not count the request that writes the handoff and shows the cache as expired
  an hour early.
- **A self-check.** That writing the handoff keeps the cache another hour is measured, not promised. After a warm return the mod checks
  the first request of the next turn; if it missed the cache, a `warn` line says so once, and for the rest of the session writing the
  handoff no longer counts as a read: coming back is judged from your own last request again.
- **A reload or a resume forgets it.** A change in `/config` reloads the mod, and quitting and `claude --resume` start without the
  handoff; the next answer plans again. A file your command wrote stays where it wrote it.
