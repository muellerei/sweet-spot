# Security

If you find something that could be used to attack sweet-spot, please
don't post it in public. Use the repository's private report instead: the
Security tab, "Report a vulnerability".

A report helps most when it says which Claude Code version you use, what
the mod did, and what you expected. I read every report and answer it.

## What counts

sweet-spot reads the session's transcript, your handoff file and your prompt
file, and lists the folder of the handoff file the answer names. It writes no files, opens no network
connection and starts one process of its own: `tail`, to read the end of a
long transcript. [What it can reach](README.md#what-it-can-reach)
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
