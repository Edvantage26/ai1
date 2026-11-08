---
type: Architecture
title: Features
description: What a repo chooses in jig.json; each hook module belongs to one feature.
tags: [features, config]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T17:55:50Z'
sources:
  - id: features-source
    resource: src/core/features.mjs
    title: Feature registry
---

Features replaced profiles on 2026-10-31 (see [profiles](profiles.md), deprecated). A repo turns
them on or off in `.claude/jig.json` (`features.<id>: true | false`); an omitted feature uses
its default. Each module declares `feature`, and runs only when that feature is on, unless the
repo switches the single module off with `modules.<id>: false`.

| Feature | Default | Modules | Ships |
|---|---|---|---|
| `okf` | on | `okf-index` (SessionStart), `okf-recall` (UserPromptSubmit), `okf-upkeep` (Stop) | OKF pack skills and agents, see [okf feature](/features/okf.md) |
| `danger` | on | `danger` (PreToolUse Bash) | see [danger guard](/guards/danger.md) |
| `craft` | on | `craft-brief` (SessionStart) | see [craft feature](/features/craft.md) |
| `lanes` | off | `lanes-brief` (SessionStart), `lanes-approval` (UserPromptSubmit), `lanes-gate` and `lanes-escalate` (PreToolUse Edit/Write/Bash) | `/jig:deep`, see [lanes feature](/features/lanes.md) |
| `design` | off | `design-brief` (SessionStart), `design-detect` (PostToolUse Edit/Write/MultiEdit) | see [design feature](/features/design.md) |
| `core` | always on | `brief` (SessionStart) | — |

Feature choice is per repo because plugin options (`userConfig`) are stored per user only in
Claude Code; the repo file travels with the code. [/jig:init](/features/init.md) writes it.

Limitation: plugin skills cannot be switched off by a feature. With `okf` off, its hooks stay
silent but `/jig:okf` and `/jig:validate` are still listed.
