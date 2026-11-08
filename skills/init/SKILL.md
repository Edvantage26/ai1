---
name: init
description: Set up jig in the current repository — ask which features to enable (OKF project knowledge, the destructive-command guard and the code craft rules are on by default), then write .claude/jig.json and .claude/settings.json so jig runs for everyone who opens the repo. Use when the person says "set up jig here", "configure the harness", "enable/disable a jig feature", "activa jig en este repo", or when a session reports that jig is installed but inactive.
---

# Set up jig in this repository

The files are written by the `jig` CLI (on the Bash PATH while the plugin is enabled), never by
hand: it merges with existing files and validates the result.

## 1. See the current state

```bash
jig status --json
```

It returns the repo root, whether `.claude/jig.json` exists, the detected protected branch,
the knowledge bundle path and whether a bundle exists, and every feature with `enabled` and
`enabledByDefault`.

## 2. Ask which features to enable

Use AskUserQuestion with **multiSelect**, one option per feature from step 1 (label = `title`,
description = `description`). Pre-select the ones currently enabled (or `enabledByDefault` when
there is no harness yet) by marking them "(on)" in the label. Do not invent features.

If the person enables `okf`, also ask, only if the repo has a test or check command you can see
(package.json scripts, Makefile, pytest config), whether to record it as a verify command.

## 3. Write the configuration

```bash
jig init --features <comma-separated ids> [--verify "<command>" ...] [--knowledge <path>]
```

Pass `--features ""` to turn every optional feature off. Report what the command printed,
including any plugin it disabled in this repo to avoid duplicate OKF skills.

## 4. Close the loop

- If `okf` is on and there is no bundle yet, offer to create one with the `okf` skill of this
  plugin (`/jig:okf`, produce mode). Do not create it without a yes.
- If `design` is on and the bundle has no concept of type `Product` or `DesignSystem`, offer to
  capture them: who the product is for and its tone; palette, typefaces, type scale, spacing and
  radii (read from the code first, ask only what it does not say). Do not write them without a yes.
- Tell the person to commit `.claude/jig.json` and `.claude/settings.json`, and to restart
  the Claude Code session so the hooks and skills load with the new configuration.
- Do not commit on your own.
