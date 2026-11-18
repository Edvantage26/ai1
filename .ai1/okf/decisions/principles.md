---
type: Decision
title: Design principles
description: Rules every ai1 component must follow.
tags: [decision, principles, security]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T08:19:29Z'
---

- **Mechanisms over prompts.** A rule that matters is enforced by a hook.
- **Friction proportional to risk.** A hook reminds or blocks only for what the current session did,
  never for changes made by someone else (another session, the person, a pull).
- **Evidence before claims.** Done means a command showed it.
- **No surprises on the user's machine.** Hooks are readable Node or POSIX shell with no installed
  dependencies (no npm packages); no network calls in hooks, no auto-update, no git permissions
  granted by the plugin. A system tool (`git`, another CLI) may be called when it is
  optional: with a timeout, and failing open when it is missing. When a missing tool turns a check off, the
  person is told once per session (a `notice`), not only stderr. The CLI may use the network when the
  person asks for it (`ai1 issue`).
- **Runtimes.** Hooks, the CLI and skill scripts are Node, the scripts as `ai1` subcommands, with
  their dependencies vendored in the plugin (js-yaml in `vendor/`), no `npm install` and no network.
  Until 2026-11-15 the OKF toolkit inherited from upstream was Python 3.9+; it was ported so ai1
  needs Node alone ([OKF toolkit](../packs/okf-pack.md)).
- **Cross-platform.** ai1 runs on Linux, macOS and Windows (decided with the person on 2026-11-18):
  `node:path` joins and `os.homedir()`, never hard-coded `/` or `~`; no shell commands where a Node
  built-in does it; permission bits (`chmod`) only as a best effort that is skipped, never failing, on
  Windows; file names compared case-insensitively where Windows would; files ai1 must read back
  byte for byte stored as text (e.g. base64) or marked `binary` in `.gitattributes`, so `autocrlf` cannot
  change them. Nobody has a Windows machine at hand, so new code that touches paths, files or
  processes gets its tests run on a `windows-latest` CI job. The suite as a whole does not run on
  Windows yet (see [worktrees](../features/worktrees.md)).
- **A time budget per event.** PreToolUse and PostToolUse hooks run on every tool call: milliseconds,
  no subprocess unless cached. SessionStart and Stop run once per session or turn: a few seconds at
  most. Anything heavier is on demand, in the CLI.
- **Fail open on internal errors, fail closed on matched production writes.**
- **Public repo hygiene.** No secrets, internal hostnames, client names or company-specific
  infrastructure; those go in a private pack.
