# Security

If you find something that could be used to attack context-relay, please
don't post it in public. Use the repository's private report instead: the
Security tab, "Report a vulnerability".

A report helps most when it says which Claude Code version you use, what
the mod did, and what you expected. I read every report and answer it.

## What counts

context-relay reads your handoff file and your prompt file, and lists the
temp directory (or the folder of the file the answer names) to find a handoff. It writes no files, opens no network
connection and starts no processes of its own. [What it can reach](README.md#what-it-can-reach)
says the same in full, and `claude plugin validate .` shows the same list
from the code. So these are worth a report:

- the mod reads or writes something outside that list
- text you did not write is submitted into your session
- a setting or a file makes it act when it should not

## Supported versions

Only the latest release gets fixes.

## Thanks

Reports made in good faith are welcome, and so is a "this looks odd, am I
wrong?". You do not need a proof of concept.
