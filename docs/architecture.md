# How sweet-spot is built

A map for reading the code: the path a handoff takes, why it is split the way it is, and the rules a change must keep. The details stay
in the comments at the places named here; this page does not repeat them. What the host does that the design rests on is in
[host-behaviour.md](host-behaviour.md).

## The path of a handoff

**A pause.** A handoff happens only when an answer is finished. Two events say that between them: `classic.Stop` brings what is still
running (background tasks, one-shot timers), and `turn.complete` says how the turn ended. The host sends the stop first, but the mod takes either order:
`pairing.ts` keeps what each has said, and the judge runs once both are in (`judge` in `register.tsx`).

**The judgment.** `decide` in `decide.ts` answers from a snapshot whether to hand over now, postpone (and why), or do nothing. It is
pure: the caller takes the snapshot, acts on the answer and keeps the record of the last attempt (`atPause` in `register.tsx`).
What counts as running work has one rule each: `standing.ts` says which background shell command never ends by itself (a dev server, a
watcher), `waiting` in `decide.ts` counts the running tasks that are not standing, and `busyReason` turns the counts into a reason to wait.
The stop's task list is kept as it came (`lastStop` in `state.ts`), and every count is derived from it where it is read. The standing tasks
are named in the first message of the fresh session (`firstMessage` in `handoff.ts`) from the list fixed when the handover was decided
(`state.still`), and in the countdown by the words their rule hit (`standingPart`).
`/sweet-spot later` moves the next handover back: `later.ts` makes the answer and the value from the context the command reads, and
`decide` then judges at `thresholdInForce` instead of the threshold, until that handover is spent or the context shrinks (`laterAt`).
`/sweet-spot asap` sets a mark (`Asap` in `decide.ts`, `asapFor` in `asap.ts`): with it `decide` skips the threshold and the minimum gap, and
the pause starts no countdown. Running work still postpones it below the emergency brake. The handover that begins spends it (`spendMarks` in `register.tsx`).
Typed with no answer running there is no pause, so the command judges itself (`asapAtRest`): from what the last stop reported (`lastStop` in
`state.ts`, dropped when a turn starts, so after an Esc what runs is not known and the mark waits for the next pause) and the subagents it lists
now. The handover begins in a step of its own, `ASAP_STEP_MS` after the answer, because the host refuses a compact, a `/clear` and a user
command inside the command itself; the step judges again, and a turn, a subagent or a second `asap` in between stops it or is turned down.

**The countdown.** Where `decide` says to hand over, `atPause` asks `countdownBegun` first. With `countdown_seconds` at 0 or no first
way it hands over at once, as before there was a countdown. Otherwise `kindAt` in `countdown.ts` picks the kind from the context, a
later handover and the deferred pauses: `immediate` at the emergency brake with no later handover, `brake` there with one (an
announcement with no button, which spends the later handover as it begins), `cap` after two deferred pauses, and `button` (with "Not
now") below that. `begin` in `countdown-flow.ts` reads where the session draws (no band on a surface without one: at once) and, for
`button`, the prompt: a draft holds the countdown back to the next pause. Each pause that holds back or begins a countdown counts as
deferred (`deferred` in `state.ts`) until a handover begins, a later handover is asked for or the context shrinks. The countdown lives
in the state (`countdown`), with a deadline that is a time, not a count of ticks; the band only draws it. A person ends it with no
handover: typing (`typed` tells the echo of the digit before its press from typing), a submit, a turn, `later` or `asap`, the end of the session or
a compact the mod did not start, each synchronously before its handler waits (`end`). "Not now" goes through `press`, which moves the handover
back the way the command does. When it runs out, `runOut` reads the prompt, the session and then the clock, checks after the last wait that
the countdown still runs, judges afresh with `decide`, and only then carries out the handover at the pause's own `carry`; text in the
prompt, a clock more than `LATE_MS` late or a judgment that no longer hands over end it instead. A survey in the band holds it: only the
drawing sees one (`hasSurvey`), reports a change to `surveyed`, and the time left is kept until the survey goes. The pure parts (deadline,
seconds left, kind, what Not now moves back by, the band's text, the digit's echo) are in `countdown.ts`; the timing is in
`countdown-flow.ts`, which reaches the host through `CountdownIo` and judges and hands over through `Expiry`.

**The handover.** `handOver` in `register.tsx` starts it once the stop has returned. From then on typing is held (`hold.ts`), and
`carryOut` in `relay.ts` runs `throughMethods`: the main method first (`handoff_method`), then, where it failed before it changed the
session, the fallback (`handoff_fallback`). There are three ways. `throughCommand`: the user's command as a turn of its own, the file its
answer names, `/clear`, and the handoff submitted as the first message of the fresh session (`deliver`). `throughInternalHandoff`: a
`$.model.fork` call writes the handoff, which `deliver` then submits the same way. `throughBuiltinCompact`: Claude Code's own `/compact`,
after which the session stays and nothing is cleared or submitted. How far a failed run got, and so what is left to put right, is the
`stage` of the type `Failure`; `FALLBACK_STAGES` in `relay.ts` is the one list of the stages after which the session is as it was and a
fallback may follow. `cancelled` (the user's own stop), `submit` and `error` never fall back. After a failure at `clear` a fallback that
needs `/clear` too is not tried. A compact that left the context above the threshold is marked (`compact-check.ts`) and not repeated
until a pause is below the threshold again. The first tool call of the main loop after the compact reads the size it left
(`checkAtToolCall`), before that turn has read anything; without one, the pause does, before `decide` judges (`atPause`).

**Afterwards.** What was typed during the handoff goes in after it (`release`). A message that did not reach the fresh session stays in
the store, and `/sweet-spot redeliver` submits it, into the session the `/clear` made and no other (`redeliver`).

**After a long pause.** The idle handoff ([idle-handoff.md](idle-handoff.md)) has its pure part in `idle-handoff.ts`: how much of the
transcript to read (`readPlan`), the cache lifetime and the baseline found in it, the lower bound (`floorOf`), whether to plan
(`planVerdict`), when the step is due (`prepareDueAt`), whether to write when it comes (`fireVerdict`), and how a return is judged
(`returnVerdict`). `register.tsx` reads the transcript at the end of the first turn of each session (`readIdle`), takes the touch and the
baseline from `turn.step`, plans at the pause after `atPause` (`planIdle`) and writes when the step comes (`prepareIdle`), through
`prepare` in `relay.ts`: the user's command or the internal way, never a compact, and nothing delivered. While it writes, `preparing` in
`state.ts` holds what `handingOver` holds (`underWay`). The first message after it takes the handoff at once (`claim` in `hold.ts`), and
`comeBack` judges by the clock; a switch delivers through `deliverReturn`, the same `deliver` as every handoff. Every turn, the end of
the session, a compact that goes through and a change of model end the pause (`endPause`); a compact holds the planned step back while it
runs and sets it again where another hook answered `{ skip }` or the compact failed (`holdIdle`); while the handoff is written, a compact or a change of model
marks it (`endedWhilePreparing`) and what is written is dropped, as does any turn but the command's own (a slash command, or the held
message, whose turn starts while it is put in). `statusTail` in `status.ts` says where it stands.

## Why it is split this way

- **A pure judge.** `decide` knows nothing of the host, so every rule of when to hand over is tested with plain values.
- **The host is reached through `Io`.** `relay.ts` gets the session as functions (`sessionIo` in `register.tsx`) instead of `$`,
  and `countdown-flow.ts` likewise (`countdownIo`),
  because the host is assumed to follow `$` only into functions of the file that declares `register`. This rests on an assumption (see
  host-behaviour, Inside the mod); if it is wrong, the indirection can go.
- **State lives in the module.** It survives `/clear`, so the minimum gap and `redeliver` work across a handoff, and it ends with a
  reload, on purpose (the comment on `State` in `state.ts` says why). A handover moved back by `later` lives there too: it holds until
  the next handover or until the context shrinks below where it was asked. So does the mark of `asap` (`asap` in `state.ts`): it ends
  with the handover that begins, the end of the session, a compact, a context that has shrunk below where it was asked, and `later`
  (`endAsap` and `shrunk`).
- **One place logs.** `log.ts` decides what a level shows; only `register.tsx` touches `$.ui.log` and the environment. CONTRIBUTING,
  Debugging, covers how to turn the log on.

## Rules a change must keep

Each is explained in a comment at the place named.

- Only an end of `answer` from the main loop is a pause; a subagent's end, Esc, an error or a refusal never is (`judge` in `register.tsx`,
  and the `classic.Stop` handler, which says why a subagent's end is left out).
- A handoff starts only after the stop has returned; the command's turn would otherwise wait on the stop (`handOver`).
- Typing is held first, before anything is awaited (the `prompt.submit` handler in `register`).
- The wait for the command's turn is set up before the command runs, and only the first turn that starts after it is the command's
  (`waitForTurnEnd`, `startOfTurn`, `endOfTurn` in `relay.ts`).
- `builtin-compact` needs the stop before `turn.complete`: the host refuses a compact from inside the stop, and the mod judges only once
  both are in. The "either order" of `pairing.ts` does not hold for it (`throughBuiltinCompact`; host-behaviour, `$.session.compact`).
- The compact mark is set or cleared before `decide` judges and the first way is named, or the first pause after a compact that was not
  enough would compact once more to no effect (`atPause`, `firstMethod` in `compact-check.ts`). The first tool call of the main loop
  after the compact may set it earlier (`checkAtToolCall`): the pause already holds the whole turn.
- The `tool.call` hook only watches: it calls `next(e)`, returns its result unchanged, and catches its own errors. It looks for a decline
  only while the command's turn is awaited (`noteToolResult` in `relay.ts`), and reads the size only at the first call of the main loop
  after a compact (`checkAtToolCall`).
- Anything that ends a countdown ends it before its handler's first wait, and the end of a countdown checks after its own last wait
  that the countdown it belongs to still runs before it hands over (`end`, `runOut` in `countdown-flow.ts`).
- The countdown spends a later handover and counts as an attempt only when it hands over, at the pause's `carry`; one that ends
  without a handover leaves both as they were. The announcement at the brake is the exception: it spends the later handover as it
  begins, so it comes once (`begin`).
- Drawing the band changes no state but whether a survey holds it, and only on a change (`surveyed`).
- The last look at the held typing and the end of holding are one step (`release`).
- The handoff is in the store before `/clear`, until the fresh session has it (`deliver`).
- The same session id after `/clear` means the handoff failed (`deliver`).
- The minimum gap ends after minutes or turns, and holds after a failed attempt too (`withinGap` in `decide.ts`).
- A handler changes the state first, then reads the log level, then logs (`register`). `endPause` therefore only changes the state and
  gives its line back to the caller. The one exception is `turn.step`: it runs at every request, so it logs by the level the turn's start
  read instead of reading it again.
- The idle handoff is taken at once: the first message after it was written takes it before any wait (`claim` in `hold.ts`), so a
  second message never sees it. Whether the cache is cold is read off the clock (`returnVerdict`), never from a mark a timer set, which
  sleep delays.
- The step that writes the idle handoff does all its reads first, then every check and `preparing` in one go with no wait between
  (`prepareIdle`), so that a turn of the person's that starts meanwhile is seen and its events are not taken for the mod's own.
- `preparing` and `returning` hold what `handingOver` holds (`underWay` in `state.ts`): no pause is judged, nothing is planned, and
  typing is held.
- The value a pause judges at, the answers of `later` and `status` and the pause line all come from `thresholdInForce` in `decide.ts`: capped at the
  brake of the window as it is at that pause, never below the threshold in force.
- The command is `immediate`, so `later` typed during an answer comes before the pause that ends it is judged (host-behaviour,
  Commands); a handover that starts while it reads the context turns it down (`contextFor` in `register.tsx`, which `later` and `asap` both go through).
- A handover that is already under way is not started a second time: `beginHandover` stops before it spends a mark. A countdown still
  being set up and `asap` at rest can both reach it.
- The last command counts: `later` takes the mark of `asap` back, and `asap` drops a later handover (`laterText`, `asapText` in `register.tsx`).

## The threshold

The default threshold comes from real sessions: calls above 200k tokens made up about three quarters of the cost, and a simulation of
what a fresh session reads again kept 200k the steadiest start across the assumptions tried. The lowest accepted value keeps a fresh
session from handing over again at once. The values and their reasons are in the CHANGELOG, under "Chosen, with the reason"; the raw
sessions are not in the repository.
