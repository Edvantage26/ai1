---
type: Decision
title: Skill customization - one mechanism, two scopes, customizable by default with justified exclusions
description: Why ai1 skills are customized through overlays injected at load time, per project and per person, and which choices were taken (later 0001, 2026-11-09).
tags: [decision, skills, customization]
sources:
  - id: proposal-0001
    resource: .ai1/later/0001-skill-customization.md
    title: Customizable ai1 skills - project and user overlays
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T13:24:58Z'
---

Decided by the person on 2026-11-09; built the same day. How it works:
[skill customization](../architecture/skill-customization.md).

# Decision

- **One generic mechanism** for every skill, instead of one solution per feature (the worktree recipe
  showed the need; forks had none).
- **Two scopes**: project (committed in `.ai1/skills/<feature>/`) and person (`~/.config/ai1/...` and
  plugin `userConfig`). Where a fork opens is the person's, never the repo's.
- **Customizable by default**; a skill is excluded only with a written reason, and a test forces the
  choice for every new skill. Excluded where the rule an overlay could weaken protects others or is
  deterministic (report-issue, validate-bundle, danger-write-rule, customize-skill) or the injection
  cannot reach (backfill's subagents).
- **Fixed rules** in every customizable skill; the overlay comes after them and the model is told they win.
- **Injected at load** by `` !`…` `` through the plugin's own `bin/ai1`: no tokens until a skill runs.
- Folder per **feature** (the skill prefix), so a skill rename does not move overlays.

# Discarded

- A SessionStart hook with every overlay: paid every session for skills never used.
- `` !`cat …` `` in each skill: no worktree fallback, no person scope, wording repeated in every skill.
- Opt-in per skill: new skills would be closed unless someone remembered; the test forces a decision anyway.
- A per-feature `settings.json` now: nothing reads it yet.
- Engine lifecycle hooks for all features (`pre-create`, `post-drop`...): only worktrees needs one
  (`pre-create`), noted in [worktrees](../features/worktrees.md) limits.

# Consequences

- Every new skill gets an index entry; customizable ones carry the frontmatter permission, fixed rules
  and the injection line.
- `.ai1/skills/` is guarded by config-guard like `.ai1/config.json`.
- Left for later (later 0001 phases 3-4): the worktree recipe into `.ai1/skills/worktrees/`, and
  report-issue once its privacy check lives in code.
