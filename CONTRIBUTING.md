# Contributing to sweet-spot

Hey, thanks for stopping by. sweet-spot is a small, simple helper for people who use Claude. I keep it simple on purpose, but that is a guide and not a rule: what makes it better is good ideas, and yours are welcome in any shape. An idea, a question, a bug report, a quick "works on my setup", a typo, a test on a terminal I don't have, some code. None of it has to be polished. Let's make it better together.

## Ways to help, no code needed

- **Tell me it works.** Even a short "works on my setup" helps. Terminal or desktop app, your theme, a narrow window: good or odd, I'd love to know.
- **Share an idea, even a half-baked one.** "It would be nice if…" is a perfectly good start. Tell me what you wanted to do and what got in the way, and we figure out the rest together.
- **Ask a question.** If the README confused you, that is useful to know: it means the README needs a better sentence.
- **Report a bug.** Say what you can: your Claude Code version, terminal or desktop app, what happened and what you expected. A half-filled report is welcome too. Please use made-up names in examples and leave real project names and prompts out.
- **Fix a typo or a clumsy sentence.**

Open an [issue](https://github.com/muellerei/sweet-spot/issues) or start a [discussion](https://github.com/muellerei/sweet-spot/discussions), whichever feels natural. No need to pick the right place, I'll move it if it fits better elsewhere, and no need to ask first. Write in whatever language suits you. The repository is in English, so English is a plus where you can.

## Build and check

[docs/development.md](docs/development.md) says how to run the mod from a clone and how to run the checks the CI runs, and how the code is laid out is in [docs/architecture.md](docs/architecture.md). Stuck on a step? Tell me. I'd rather fix those pages than have you struggle.

## Debugging

The mod writes diagnostic lines to the transcript when the environment variable `SWEET_SPOT_LOG_LEVEL` is set. It is not a setting: nothing in the package sets it, and `claude plugin validate` shows that the mod only reads it. Each line starts with its level, and each level includes the ones before it:

| Value   | What you see                                                                                                                                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `off`   | Nothing. Also what an unset or empty variable means.                                                                                          |
| `warn`  | Everything that fails or falls back, even when you also get a message about it. The line names the stage, the message gives the reason.      |
| `info`  | The milestones: the settings in effect, the decision at every pause, start and end of a handoff or a redelivery, the clear and the submit.    |
| `debug` | What the mod made of an event: judgements, the steps inside a handoff, and errors it caught that have no visible effect.                      |
| `trace` | What reached the mod: the raw events, without a judgement.                                                                                    |

Case and surrounding spaces do not matter. Any other value, `1` and `true` included, logs at `warn` and says so in one `warn` line. No line carries text you or the model wrote, except the invalid value of the variable itself; they hold names, numbers, durations and reasons from a fixed set.

Two ways to turn it on:

- For one run: `SWEET_SPOT_LOG_LEVEL=debug claude`. It cannot be changed while that session runs.
- For this clone: `{ "env": { "SWEET_SPOT_LOG_LEVEL": "debug" } }` in `.claude/settings.local.json`. A new value counts from the next turn, without a restart or `/reload-plugins`, and a `settings:` line marks each change to `info` or above. A `.env` file is not read.

Leave it out of `~/.claude/settings.json`, or every session everywhere logs. Lines from before a handoff's `/clear` vanish from the window; start with `--debug-file <path>` to keep them. Events from before the variable was set cannot be logged after the fact, so a test run that looks for a rare event starts with it set.

## Pictures

The banner and the drawings in `docs/images/` are made by small Python scripts in `docs/src/`, so a picture can be rebuilt instead of edited by hand: `sh docs/src/build.sh` (Python 3, nothing to install). The drawings say "Drawn, not recorded", in the picture or under it in the README, and the numbers in them are the measured ones from the README, kept as constants in `docs/src/common.py` and at the top of each script. `python3 docs/src/check.py` compares those, the README, `plugin.json` and the pinned Claude Code version in the workflow, and CI runs it, so a number changed in one place and not the others fails. If a change alters what a picture shows, change the script, rebuild, and look at the result in a browser, since the pictures move. Only `docs/images/social-preview.png` is not built by `build.sh`: it is the output of `python3 docs/src/banner.py <folder> --social`, rendered to 1280 by 640 pixels, for example with headless Chrome (`--screenshot`, `--window-size=1280,640`).

## What makes a change easy to merge

A few things help a pull request go in smoothly. None of them is a hurdle, and none stands in the way of an idea:

- A test that fails without your change, so we both see it works.
- A line under `[Unreleased]` in `CHANGELOG.md` when behaviour changes.
- One thought per pull request, with a short subject line in English ("Reject a threshold below the minimum").

Not sure about any of it? Open the pull request anyway and we'll sort it out together. It doesn't need an issue first, and a change written with an AI tool is welcome too. Please run the checks and read the diff yourself before you send it.

## Things to talk about first

sweet-spot has one purpose: hand a session over before the context gets too big. Memory, guards, panels and the like belong in other tools. If you have an idea that would stretch that, tell me first. It doesn't mean the idea is unwelcome. A good idea can change my mind, so open an issue or a discussion and let's talk.

If you find something that could be used to attack the mod, please don't post it in public. [SECURITY.md](SECURITY.md) says how to report it privately.

## How we talk

Let's be kind to each other and assume good intent. Questions of any kind are welcome, and so is friendly disagreement. Unkind words, insults and personal attacks have no place here. I'll remove such comments and, if it comes to that, stop the person from writing here.

## What to expect

I read every issue and pull request, and I answer each one, starting with a thank you. I'm one person, so it can take a while. If your change goes in, I'll ask whether you'd like to be named, and then your name goes into its CHANGELOG entry and into the Thank you section below. Contributions are under the MIT license of the repository.

## Thank you

Everyone who helps and would like to be named is listed here. Thank you for helping us make sweet-spot better.
