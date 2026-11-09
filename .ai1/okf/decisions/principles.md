---
type: Decision
title: Design principles
description: Rules every ai1 component must follow.
tags: [decision, principles, security]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T07:41:58Z'
---

- **Mechanisms over prompts.** A rule that matters is enforced by a hook.
- **Friction proportional to risk.** A hook reminds or blocks only for what the current session did,
  never for changes made by someone else (another session, the person, a pull).
- **Evidence before claims.** Done means a command showed it.
- **No surprises on the user's machine.** Hooks are readable Node or POSIX shell with no installed
  dependencies (no npm packages); no network calls in hooks, no auto-update, no git permissions
  granted by the plugin. A system tool (`git`, `python3`, another CLI) may be called when it is
  optional: with a timeout, and failing open when it is missing (as `okf-upkeep` runs the OKF
  validator, trying `python3`, `python` and `py -3`). When a missing tool turns a check off, the
  person is told once per session (a `notice`), not only stderr. The CLI may use the network when the
  person asks for it (`ai1 issue`).
- **Runtimes.** Hooks and the CLI are Node. Skill scripts, which run on request in view of the agent,
  may use another runtime listed in the README requirements, with their dependencies vendored in the
  plugin (PyYAML in `vendor/`), no `pip`/`uv` and no network. No third language: today Node, plus
  Python 3.9+ for the OKF toolkit inherited from upstream ([OKF toolkit](../packs/okf-pack.md)).
- **A time budget per event.** PreToolUse and PostToolUse hooks run on every tool call: milliseconds,
  no subprocess unless cached. SessionStart and Stop run once per session or turn: a few seconds at
  most. Anything heavier is on demand, in the CLI.
- **Fail open on internal errors, fail closed on matched production writes.**
- **Public repo hygiene.** No secrets, internal hostnames, client names or company-specific
  infrastructure; those go in a private pack.
