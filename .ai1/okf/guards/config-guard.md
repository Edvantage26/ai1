---
type: Component
title: config-guard
description: PreToolUse guard that asks the person before the agent changes the harness configuration (.ai1/config.json, .claude/settings*.json, .claude/hooks/).
tags: [guard, hooks, config]
resource: src/guards/config-guard.mjs
sources:
  - id: tool-call-paths
    resource: src/core/tool-call-paths.mjs
    title: Files a tool call may change (file tools and shell)
  - id: proposal-0002
    resource: .ai1/proposals/0002-config-guard.md
    title: Proposal 0002
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T09:20:51Z'
---

Feature `danger` (on by default); switch it off alone with `modules.config-guard: false`. Built
2026-11-09 from proposal 0002; decision in [harness guards](../decisions/harness-guards.md).

# Why

Every guard trusts its configuration, and the agent could edit it: `danger` reads `ignore_rules`
from `.ai1/config.json`, the [repo rules](repo-rules.md) live there, and `verify-gate` ignores
`.claude/**` and `.ai1/**` on purpose. Claude Code protects `.claude/` writes itself, but allows them
in bypassPermissions mode and never protects `.ai1/` (permission docs, 2026-11-09). A hook `ask`
still prompts in bypass mode.

# What it does

- Protected: any path that, as written or after `realpath`, ends in `/.ai1/config.json`,
  `/.claude/settings.json`, `/.claude/settings.local.json`, or lies under `/.claude/hooks/`. Matched by
  ending, so the copies in other worktrees and `~/.claude/settings.json` count too.
- File tools (Edit, Write, MultiEdit, NotebookEdit): their path.
- Shell: the targets from `src/core/tool-call-paths.mjs` - redirects, `tee`, `sed -i`, `cp`, `rm`
  (any, not only `-r`), `mv`/`git mv` sources and target, `git rm`, `git checkout`/`git restore` paths -
  and an inline script (`python3 - <<EOF`, `node -e`) whose text names one of those paths.
- Decision: `ask`, never `deny` - setup and the person change these files on purpose; the prompt is
  the consent. `ai1 init` writes them as a CLI, not a write target, so the setup flow is not asked.

`tool-call-paths` sorts each change as `edit`, `shell-write`, `remove`, `move` (with `movedTo`) or
`move-target`, so the [test guard](test-guard.md) can treat a rename differently from a removal.

# Limits

- A script that opens the file without naming it (a program in the repo) is not seen.
- In default mode a `.claude/settings.json` edit may prompt twice (Claude Code's protected path and this hook).
- Headless sessions cannot confirm an `ask`: it acts as a refusal.

Tests: `test/config-guard.test.mjs`.
