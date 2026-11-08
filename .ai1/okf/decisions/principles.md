---
type: Decision
title: Design principles
description: Rules every ai1 component must follow.
tags: [decision, principles, security]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:15:28Z'
---

- **Mechanisms over prompts.** A rule that matters is enforced by a hook.
- **Friction proportional to risk.**
- **Evidence before claims.** Done means a command showed it.
- **No surprises on the user's machine.** Hooks are readable Node or POSIX shell with zero
  dependencies; no network calls, no auto-update, no git permissions granted by the plugin.
- **Fail open on internal errors, fail closed on matched production writes.**
- **Public repo hygiene.** No secrets, internal hostnames, client names or company-specific
  infrastructure; those go in a private pack.
