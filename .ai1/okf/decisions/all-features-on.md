---
type: Decision
title: Every feature on by default, basic modes refined by overlays
description: Why ai1 switched from opt-in features to opt-out (config version 2), how repos set up before were migrated, and why features that need setup start in a basic mode the project refines (2026-11-13, v0.36.0).
tags: [decision, features, config, worktrees]
sources:
  - id: features-source
    resource: src/core/features.mjs
    title: Feature registry
  - id: migration
    resource: src/core/migrations.mjs
    title: Migration 4, all-features-on
  - id: basic-recipe
    resource: src/worktrees/worktree-basic-recipe.mjs
    title: Basic worktree recipe
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-13T14:28:06Z'
---

# Decision

Asked by the person on 2026-11-13: "que por defecto todo estuviese activo", switching off only what a
repo does not want, and features that need setup (worktrees) starting with a basic version that is
improved as the project evolves, detecting by itself when it has to, as an overlay.

- **Opt-out.** Every selectable [feature](../architecture/features.md) is on unless
  `.ai1/config.json` says `false`. `ai1 init` writes only the features switched off
  (`--disable a,b`, exact list; `--disable none` all on; no flag keeps the opt-outs). `--features`
  stays as the older form (unlisted = off). The setup skill shows everything on and asks only what to
  switch off.
- **Config version 2** marks the opt-out contract. Version 1 configs were written by an init that
  listed every feature, so their `false` values cannot be told from choices: migration 4
  (`all-features-on`, [migrations](../architecture/migrations.md)) drops them all once, shows the
  skills they hid and tells the person how to switch a feature off again. The person chose this over
  keeping the old values or asking per repo. Because the repo ledger is not committed, the version is
  what keeps a clone or a worktree from re-running it over a later opt-out.
- **Basic modes.** worktrees works without a recipe: the [basic recipe](../features/worktrees.md) is
  worked out from the repo on every use (not frozen in a file at init, so it follows the repo), and
  `.claude/skills/worktree/recipe.json` is an overlay with only the fields that differ. When the
  basic recipe falls short, `ai1 worktree` says what is not covered and the agent completes the
  overlay itself and says so in one line (the person chose "ajusta solo y avisa"), proposing first
  only when it would share a folder holding state or delete data. design stays quiet without a
  frontend; storyboard and design checks already fire only on UI files.
- `worktree-recipe-offer` (Stop, offering to plan a recipe) is retired: there is always a recipe.

# Not done (yet)

The same basic-mode pattern for verify without commands, okf without a bundle and the storyboard
folder: today they do nothing harmful or offer their setup once. Raised with the person: relaxing
"every change in a worktree" for quick tasks, and sizing in small repos; both declined for now
("Ni la 1 ni 2 de momento").

# Risk accepted

An older ai1 reading a version 2 config reports it invalid and stays inactive in that repo until it
updates (the plugin auto-updates); it fails safe and visible.
