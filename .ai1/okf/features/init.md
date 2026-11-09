---
type: Component
title: /ai1:core-setup-repo and the ai1 CLI
description: Sets up ai1 in a repo - asks the features, writes .ai1/config.json and settings.json deterministically.
tags: [init, cli, setup]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T08:28:20Z'
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
  - id: plugin-overlaps
    resource: src/core/plugin-overlaps.mjs
    title: Plugins that overlap with ai1
  - id: feature-recommendations
    resource: src/cli/feature-recommendations.mjs
    title: Feature recommendations read from the repo
---

- **CLI `ai1`** (`bin/`, on the Bash PATH while the plugin is enabled):
  - `ai1 status [--json]`: repo root, harness present, trunk, whether `.ai1/okf/` has a bundle, features.
  - `ai1 init --features okf,danger [--verify "<cmd>" ...] [--disable-plugins a@x,b@y] [--json]`
    (`--knowledge` is refused since v0.16.0: the bundle path is fixed, see the
    [contract](../architecture/harness-contract.md)).
  - `ai1 status` also gives each feature a `recommendation` and lists `detectedVerifyCommands` and
    `overlappingPlugins` (below).
- **What init writes**, merging with existing files:
  - `.ai1/config.json`: `features` (every selectable feature, true/false), `trunk` (kept, else
    detected: origin/HEAD, then main/master, then current branch), `verify`; other fields and
    `modules` are kept, the retired `knowledge` is removed (its bundle moved to `.ai1/okf/` first).
    The result is validated before writing.
  - `.claude/settings.json`: `extraKnownMarketplaces.ai1` (github `Edvantage26/ai1`) and
    `enabledPlugins["ai1@ai1"] = true`. Shared and committed.
  - `.claude/settings.local.json` (personal, not committed) **of the main checkout**, even when init
    runs in a worktree: since Claude Code v2.1.211 that is the local file a worktree session reads (a
    copy left in the worktree is still read, below it); on Windows it stays next to
    `.claude/settings.json` (`localSettingsPathFor`). Only the plugins passed in
    `--disable-plugins` are set to `false` for this repo (never `ai1@ai1`; ids must be
    `name@marketplace`). It is added to `.gitignore` if git does not ignore it yet. Local settings win
    over project and user settings. Until v0.19.1 init switched `okf@...` off by itself; now it asks.
- **Overlapping plugins** (`src/core/plugin-overlaps.mjs`): a table of plugins that do part of ai1's
  job, each with the features it overlaps with and an action. `disable`: `okf@` (same OKF skills
  twice), `jig@` (ai1's old name, hooks twice, any feature), `superpowers@` (its SessionStart forces
  brainstorming, writing-plans, using-git-worktrees, TDD and verification-before-completion on every
  task: lanes, worktrees, verify, craft). `warn`: `feature-dev@` (its `/feature-dev` phases duplicate
  the lanes). Enabled plugins are read from user, project and local settings with Claude Code's
  precedence. The session [brief](../architecture/hook-runtime.md) adds one line while a `disable`
  plugin overlapping an enabled feature stays enabled.
- **Recommendations** (`src/cli/feature-recommendations.mjs`): per feature `{ recommended: true |
  false | null, reason, evidence }` from cheap local signals, no network. okf, danger, craft: always.
  verify: a test command found (`package.json` scripts.test other than npm's placeholder, with pnpm or
  yarn by lockfile; `make test`; pytest config, `tests/conftest.py` or pytest in requirements, run
  through `uv run`, `poetry run` or `.venv/bin`/`venv/bin` when the project has them; Cargo;
  Go), at the root and in each top-level folder with its own manifest (`cd backend && pytest` in a
  monorepo). design: frontend packages (react, vue, svelte, next, astro...) in any of those
  `package.json`, or UI files (.tsx, .vue, .css...). lanes: risky paths (migrations, alembic,
  auth, payments, billing, infra, terraform, `.tf`), else at least 50 tracked files or 100 commits.
  worktrees: an existing practice (`.worktreeinclude`, `.config/wt.toml`, `.gtrconfig`,
  `.claude/worktrees`), other git worktrees or several authors in 90 days; otherwise `null` (ask
  whether several sessions run at once). proposals: `.ai1/proposals`, RFC/ADR/decision folders or a
  `ROADMAP.md`.
- **Skill `/ai1:core-setup-repo`** is a setup assistant: runs `ai1 status`, checks the
  recommendations against the repo, proposes a configuration as a table (feature, on/off, why, with
  the evidence) plus the verify commands, and asks with a multi-select pre-selected with that
  proposal. Each proposed verify command is run once first (10 min timeout) and its result and time
  shown: a command that fails on the current code or takes more than about 3 minutes is not
  proposed as is. Then asks which overlapping plugins to disable in this repo, runs `ai1 init`, shows what
  each enabled feature gives and how to use it, and offers, one at a time, each feature's own setup:
  the worktree recipe (`/ai1:worktrees-plan-recipe`) when missing, the bundle
  (`/ai1:okf-maintain-knowledge`) when there is none, the Product and DesignSystem concepts for
  design. Then tells the person to commit and restart. It never commits.
