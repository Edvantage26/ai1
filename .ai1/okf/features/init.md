---
type: Component
title: /ai1:core-setup-repo and the ai1 CLI
description: Sets up ai1 in a repo - asks the features, writes .ai1/config.json and settings.json deterministically.
tags: [init, cli, setup]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T04:45:09Z'
sources:
  - id: setup-repo
    resource: src/cli/setup-repo.mjs
    title: Setup logic
  - id: cli
    resource: bin/ai1
    title: CLI entry point
  - id: skill
    resource: skills/core-setup-repo/SKILL.md
    title: /ai1:core-setup-repo skill
---

- **CLI `ai1`** (`bin/`, on the Bash PATH while the plugin is enabled):
  - `ai1 status [--json]`: repo root, harness present, trunk, whether `.ai1/okf/` has a bundle, features.
  - `ai1 init --features okf,danger [--verify "<cmd>" ...] [--json]` (`--knowledge` is refused since
    v0.16.0: the bundle path is fixed, see the [contract](../architecture/harness-contract.md)).
- **What init writes**, merging with existing files:
  - `.ai1/config.json`: `features` (every selectable feature, true/false), `trunk` (kept, else
    detected: origin/HEAD, then main/master, then current branch), `verify`; other fields and
    `modules` are kept, the retired `knowledge` is removed (its bundle moved to `.ai1/okf/` first).
    The result is validated before writing.
  - `.claude/settings.json`: `extraKnownMarketplaces.ai1` (github `Edvantage26/ai1`) and
    `enabledPlugins["ai1@ai1"] = true`. Shared and committed.
  - `.claude/settings.local.json` (personal, not committed): with `okf` on, every enabled
    user-level `okf@...` plugin is set to `false` for this repo, so its skills are not listed twice.
    `.claude/settings.local.json` is added to `.gitignore` if git does not ignore it yet. Local
    settings win over project and user settings.
- **Skill `/ai1:core-setup-repo`**: runs `ai1 status`, asks the features with a multi-select, runs
  `ai1 init`, offers `/ai1:okf-maintain-knowledge` when there is no bundle, and tells the person to commit and restart.
  It never commits.
