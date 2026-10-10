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

**The handover.** `handOver` in `register.tsx` starts it once the stop has returned. From then on typing is held (`hold.ts`), and
`carryOut` in `relay.ts` runs `throughMethods`: the main method first (`handoff_method`), then, where it failed before it changed the
session, the fallback (`handoff_fallback`). There are three ways. `throughCommand`: the user's command as a turn of its own, the file its
answer names, `/clear`, and the handoff submitted as the first message of the fresh session (`deliver`). `throughInternalHandoff`: a
`$.model.fork` call writes the handoff, which `deliver` then submits the same way. `throughBuiltinCompact`: Claude Code's own `/compact`,
after which the session stays and nothing is cleared or submitted. How far a failed run got, and so what is left to put right, is the
`stage` of the type `Failure`; `FALLBACK_STAGES` in `relay.ts` is the one list of the stages after which the session is as it was and a
fallback may follow. `cancelled` (the user's own stop), `submit` and `error` never fall back. After a failure at `clear` a fallback that
needs `/clear` too is not tried. A compact that left the context above the threshold is marked (`compact-check.ts`) and not repeated
until a pause is below the threshold again; the mark is set and cleared at the pause, before `decide` judges (`atPause`).

**Afterwards.** What was typed during the handoff goes in after it (`release`). A message that did not reach the fresh session stays in
the store, and `/sweet-spot redeliver` submits it, into the session the `/clear` made and no other (`redeliver`).

## Why it is split this way

- **A pure judge.** `decide` knows nothing of the host, so every rule of when to hand over is tested with plain values.
- **The host is reached through `Io`.** `relay.ts` gets the session as functions (`sessionIo` in `register.tsx`) instead of `$`,
  because the host is assumed to follow `$` only into functions of the file that declares `register`. This rests on an assumption (see
  host-behaviour, Inside the mod); if it is wrong, the indirection can go.
- **State lives in the module.** It survives `/clear`, so the minimum gap and `redeliver` work across a handoff, and it ends with a
  reload, on purpose (the comment on `State` in `state.ts` says why).
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
  enough would compact once more to no effect (`atPause`, `firstMethod` in `compact-check.ts`).
- The `tool.call` hook only watches: it calls `next(e)`, returns its result unchanged, looks only while the command's turn is awaited,
  and catches its own errors (`noteToolResult` in `relay.ts`).
- The last look at the held typing and the end of holding are one step (`release`).
- The handoff is in the store before `/clear`, until the fresh session has it (`deliver`).
- The same session id after `/clear` means the handoff failed (`deliver`).
- The minimum gap ends after minutes or turns, and holds after a failed attempt too (`withinGap` in `decide.ts`).
- A handler changes the state first, then reads the log level, then logs (`register`).

## The threshold

The default threshold comes from real sessions: calls above 200k tokens made up about three quarters of the cost, and a simulation of
what a fresh session reads again kept 200k the steadiest start across the assumptions tried. The lowest accepted value keeps a fresh
session from handing over again at once. The values and their reasons are in the CHANGELOG, under "Chosen, with the reason"; the raw
sessions are not in the repository.
