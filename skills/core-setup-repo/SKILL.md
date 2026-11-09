---
name: core-setup-repo
description: Core — Set up ai1 in the current repository — ask which features to enable (OKF project knowledge, the destructive-command guard and the code craft rules are on by default), then write .ai1/config.json and .claude/settings.json so ai1 runs for everyone who opens the repo. Use when the person says "set up ai1 here", "configure the harness", "enable/disable an ai1 feature", "activa ai1 en este repo", or when a session reports that ai1 is installed but inactive.
---

# Set up ai1 in this repository

The files are written by the `ai1` CLI (on the Bash PATH while the plugin is enabled), never by
hand: it merges with existing files and validates the result.

## 1. See the current state

```bash
ai1 status --json
```

It returns the repo root, whether `.ai1/config.json` exists, the detected protected branch,
the knowledge bundle path (always `.ai1/okf`) and whether a bundle exists, and every feature with `enabled` and
`enabledByDefault`.

If `legacyMigration.moves` or `legacyMigration.settingsFiles` is not empty, the repo has the old
layout (ai1 was called jig, and OKF bundles live in `.okf/` by convention). `ai1 init` moves it to
`.ai1/` before writing the configuration: `.claude/jig.json` -> `.ai1/config.json`, `.okf/` ->
`.ai1/okf/`, `docs/rfc/` -> `.ai1/proposals/` (only when the rfc feature was on), `.jig/work/` ->
`.ai1/work/`, a bundle at a custom path from the retired `knowledge` setting -> `.ai1/okf/`, and
`jig@jig` -> `ai1@ai1` in the settings. Tracked paths move with `git mv`; links
inside the moved bundle and proposals are rewritten. A repo that used the `rfc` feature of ai1
before v0.18.0 (`.ai1/rfc/`, `features.rfc`) gets it renamed to `proposals` the same way. Show the person the list and ask before step 3.
If `legacyMigration.conflicts` is not empty, the targets already exist: stop and tell the person.

## 2. Ask which features to enable

Use AskUserQuestion with **multiSelect**, one option per feature from step 1 (label = `title`,
description = `description`). Pre-select the ones currently enabled (or `enabledByDefault` when
there is no harness yet) by marking them "(on)" in the label. Do not invent features.

If the person enables `okf`, also ask, only if the repo has a test or check command you can see
(package.json scripts, Makefile, pytest config), whether to record it as a verify command.

## 3. Write the configuration

```bash
ai1 init --features <comma-separated ids> [--verify "<command>" ...]
```

Pass `--features ""` to turn every optional feature off. Report what the command printed,
including any plugin it disabled in this repo to avoid duplicate OKF skills. When it migrated an
old layout, keep the features that were on (from step 1) and offer to update the files it lists as
still mentioning old paths (CLAUDE.md, README...).

## 4. Close the loop

- If `okf` is on and there is no bundle yet, offer to create one with the `okf` skill of this
  plugin (`/ai1:okf-maintain-knowledge`, produce mode). Do not create it without a yes.
- If `design` is on and the bundle has no concept of type `Product` or `DesignSystem`, offer to
  capture them: who the product is for and its tone; palette, typefaces, type scale, spacing and
  radii (read from the code first, ask only what it does not say). Do not write them without a yes.
- Tell the person to commit `.ai1/` (and the moves, if any) and `.claude/settings.json`, and to restart
  the Claude Code session so the hooks and skills load with the new configuration.
- Do not commit on your own.
