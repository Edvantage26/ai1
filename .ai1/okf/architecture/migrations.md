---
type: Architecture
title: Migrations
description: Numbered, idempotent migrations that bring a repo and the person's ai1 config folder up to date by themselves when ai1 renames or moves something it wrote; run at session start and by ai1 init.
tags: [migrations, runtime, config, renames]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T09:16:28Z'
sources:
  - id: migrations
    resource: src/core/migrations.mjs
    title: Runner, ledgers and the migrations
  - id: entrypoint
    resource: bin/ai1-hook.mjs
    title: SessionStart runs them before the dispatch
  - id: tests
    resource: test/migrations.test.mjs
    title: Migration tests
---

# Why

Until v0.31 a rename (jig -> ai1, rfc -> proposals -> later) left the old names ignored with a notice
until someone ran `ai1 init` in each repo, and the person's own overlays in `~/.config/ai1/` were never
moved. Decided with the person on 2026-11-11, when renaming lanes to [sizing](/features/sizing.md):
updates are applied like database migrations, by themselves, the first time the new ai1 starts a session.

# How it works

- `MIGRATIONS` in `src/core/migrations.mjs`: a list of `{ number, id, summary, migrateRepo, migrateUser }`.
  Each one is idempotent (running it on an up-to-date folder changes nothing).
- Ledgers hold the last applied number, `{ "applied": <n> }`:
  - repo: `.ai1/work/migrations.json`, local to each checkout and never committed (`.ai1/work/` ignores
    itself). A fresh clone runs the migrations once more and finds nothing to do.
  - person: `migrations.json` in the ai1 config folder (`$XDG_CONFIG_HOME/ai1` or `~/.config/ai1`), written
    only when that folder exists.
- `runSessionStartMigrations` runs from `bin/ai1-hook.mjs` at SessionStart, before the dispatch, so the
  same session already reads the new names. It migrates the checkout whose `.ai1/config.json` the
  [dispatcher](hook-runtime.md) will read and, from a worktree, the main checkout too (since v0.33.0: shared
  state lives there - work plans, storyboards), each only where ai1 is set up and with its own ledger; the
  person's folder once. Not inside `dispatchHookEvent`, so in-process tests never touch the real home.
- Folders are found with `lstat`: a symlink (e.g. to a synced drive) moves as the same symlink, even when
  its target is not mounted.
- `ai1 init` ([setup](/features/init.md)) runs the repo part too (`includeUser: false`) and prints the report.
- Nothing is committed. The agent gets one line per migration that did something: what changed (to
  review and commit), what was left alone (target already existed) and what the person should update by
  hand (their own root docs, e.g. `CLAUDE.md`, are listed, never edited). The bundle's `log.md` is history
  and is never rewritten.
- Fail open: a migration that throws stops its scope, leaves the ledger at the last one that worked and
  is reported; it is retried at the next session start.

# Migrations

| # | id | Since | Repo | Person |
|---|---|---|---|---|
| 1 | `lanes-to-sizing` | v0.32.0 | `features.lanes` -> `features.sizing`, `modules.lanes-*` -> `sizing-*` (the new name wins when both are set); `.ai1/skills/lanes/` -> `.ai1/skills/sizing/`; the deep skill name (`lanes-design-before-code` -> `sizing-design-before-code`, with its `/ai1:` prefix) in the bundle (except `log.md`), later entries, overlays, `.claude/skills/` and work plans; `lane: plan` -> `size: plan` in work plans | `skills/lanes/` -> `skills/sizing/`, skill name in overlays |

| 2 | `walkthrough-to-storyboard` | v0.33.0 | `features.walkthrough` -> `features.storyboard`, `modules.walkthrough-reminder` -> `storyboard-reminder`; the folder `walkthroughs` -> `storyboards` under `.ai1/` (also a symlink) and its `.git/info/exclude` line (only where `.git` is a folder); `.ai1/skills/walkthrough/` -> `storyboard/`; in ai1's texts the skill (`walkthrough-record-flow` -> `storyboard-record-flow`), `ai1 walkthrough <subcommand>` and the folder path | `skills/walkthrough/` -> `skills/storyboard/`, the same names in overlays |

Shared helpers keep each migration short: `renameFeatureInConfig`, `moveFolderUnlessTaken`,
`rewriteAi1Texts`, `listRootDocsNaming`, `migrateUserOverlays`. A concept that documents a rename writes
the old names without the `/ai1:` prefix or folder form the migration matches, so a fresh clone does not
rewrite it.

Older renames (jig, rfc, proposals) stay in `ai1 init`'s legacy layout migration
(`src/cli/legacy-migration.mjs`): they move whole tracked folders with conflict checks and were not ported.
The renamed ids are still listed in `RENAMED_FEATURE_IDS` / `RENAMED_MODULE_IDS` (`src/core/config.mjs`), so a
config the migration could not touch gets a "renamed" notice instead of "unknown".

# Adding a migration

Append an object with the next `number` to `MIGRATIONS`, idempotent, with both parts (an empty one is
fine), add its row above, and test it through the entry point with a temporary `HOME`
(`test/migrations.test.mjs`).

# Validate

`node --test test/migrations.test.mjs`: session start through `bin/ai1-hook.mjs` with a temporary HOME
migrates config, overlays, texts and plans, a second start runs nothing, `ai1 init` gives the same result,
a clash is left alone, a throwing migration keeps its ledger.
