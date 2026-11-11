---
type: Architecture
title: Features
description: What a repo chooses in .ai1/config.json; each hook module belongs to one feature.
tags: [features, config]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T07:38:33Z'
sources:
  - id: features-source
    resource: src/core/features.mjs
    title: Feature registry
---

Features replaced profiles on 2026-10-31 (see [profiles](profiles.md), deprecated). A repo turns
them on or off in `.ai1/config.json` (`features.<id>: true | false`); an omitted feature uses
its default. Each module declares `feature`, and runs only when that feature is on, unless the
repo switches the single module off with `modules.<id>: false`.

| Feature | Default | Modules | Ships |
|---|---|---|---|
| `okf` | on | `okf-index` (SessionStart), `okf-claude-md` (SessionStart), `okf-recall` (UserPromptSubmit), `okf-file-context` (PostToolUse Read/Edit/Write/MultiEdit), `okf-upkeep` (Stop) | OKF pack skills and agents, see [okf feature](/features/okf.md) |
| `danger` | on | `danger` (PreToolUse Bash), `config-guard` and `repo-rules` (PreToolUse Edit/Write/MultiEdit/NotebookEdit/Bash) | `/ai1:danger-write-rule`, see [danger guard](/guards/danger.md), [config-guard](/guards/config-guard.md), [repo-rules](/guards/repo-rules.md) |
| `craft` | on | `craft-brief` (SessionStart) | see [craft feature](/features/craft.md) |
| `verify` | on | `verify-gate` (Stop), `test-guard` (PreToolUse Edit/Write/MultiEdit/Bash, see [test-guard](/guards/test-guard.md)), `fix-loop` (PostToolUse Edit/Write/MultiEdit), `tool-loop` (PreToolUse Bash/Edit/Write/MultiEdit/NotebookEdit) | `ai1 verify`, `ai1 step-done`, `/ai1:verify-debug-systematically`, see [verify feature](/features/verify.md) |
| `sizing` | off | `sizing-brief` (SessionStart), `sizing-approval` (UserPromptSubmit), `sizing-gate` and `sizing-escalate` (PreToolUse Edit/Write/Bash) | `/ai1:sizing-design-before-code`, see [sizing feature](/features/sizing.md) |
| `worktrees` | off | `worktree-brief` (SessionStart), `worktree-reminder` (UserPromptSubmit), `worktree-recipe-offer` (Stop) | `/ai1:worktrees-plan-recipe`, `ai1 worktree`, see [worktrees feature](/features/worktrees.md) |
| `later` | off | `later-brief` (SessionStart), `later-recall` (UserPromptSubmit), `later-upkeep` (Stop) | `/ai1:later-write`, `ai1 later`, see [later feature](/features/later.md) (called `rfc` until v0.17 and `proposals` until v0.24) |
| `design` | off | `design-brief` (SessionStart), `design-detect` (PostToolUse Edit/Write/MultiEdit) | see [design feature](/features/design.md) |
| `walkthrough` | off | `walkthrough-reminder` (Stop) | `/ai1:walkthrough-record-flow`, `ai1 walkthrough`, see [walkthrough feature](/features/walkthrough.md) |
| `core` | always on | `brief` (SessionStart), `issue-offer` (UserPromptSubmit) | `/ai1:core-report-issue`, see [issue report](/features/issue-report.md) |

Feature choice is per repo because plugin options (`userConfig`) are stored per user only in
Claude Code; the repo file travels with the code. [/ai1:core-setup-repo](/features/init.md) writes it.

Limitation: plugin skills cannot be switched off by a feature. With `okf` off, its hooks stay
silent but `/ai1:okf-maintain-knowledge` and `/ai1:okf-validate-bundle` are still listed.
