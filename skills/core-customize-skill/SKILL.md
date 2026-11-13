---
name: core-customize-skill
description: Core — Customize how an ai1 skill works for this project or only for the person. Use when the person corrects or adjusts how an ai1 skill works and wants it kept ("aquí siempre…", "en este repo los briefs…", "para mí, abre los forks en Paseo", "personaliza la skill de later", "customize this skill", "from now on in this repo…"), or when a skill's customization footer offers it and they say yes.
---

# Customize an ai1 skill

Every customizable ai1 skill ends by printing its customization (`ai1 skill-context <skill>`): the
project overlay, then the person's, then the precedence. This skill writes those overlays.
`ai1 skill-context --list` shows which skills can be customized, at which scopes, and what exists.

## 1. Which skill, and which kind of change

- Find the skill the correction is about and check `ai1 skill-context --list`. A skill marked "not
  customizable" stays as it is: tell the person why (the list says it).
- The overlay folder is the skill's **feature**, its name prefix: `session-fork-conversation` ->
  `session`, `okf-maintain-knowledge` -> `okf` (shared by every okf skill).
- Data is not an overlay. Point the person to where it lives instead:
  - where forks open: the plugin option **Fork opener** in `/config` (theirs, per person);
  - hook options: `modules.<module>` in `.ai1/config.json` (/ai1:core-setup-repo);
  - how worktrees are made: the worktree recipe (/ai1:worktrees-plan-recipe `revisar`).
- "Never let the agent do X" (a command or an edit) is a guard, not a customization: use
  /ai1:danger-write-rule.

## 2. Project or personal

- **Project** (`.ai1/skills/<feature>/overlay.md`, committed): rules of this repo, for everyone
  who works on it.
- **Personal** (`~/.config/ai1/skills/<feature>/overlay.md`, or `$XDG_CONFIG_HOME/ai1/...`): the
  person's habits and tools, in every repo.

Ask only when the skill accepts both and the correction does not make it obvious ("en este repo"
is project; "yo prefiero" is personal).

## 3. Write it

An overlay is plain markdown, short (it is injected every time the skill loads; over 8 KB is cut):
one bullet per rule, saying what to do and, when not obvious, why. Add to the existing file, do not
rewrite what others wrote. It cannot override the skill's Fixed rules: if the correction contradicts
one, say so and do not write it.

Show the person the exact text and the file; write it after their yes. For a project overlay the
`config-guard` hook asks them once more before the file changes: that prompt is the final approval,
never avoid it. Then run `ai1 skill-context <skill>` and show that the text appears.

## 4. Close

- Project overlay: tell them to commit it (do not commit on your own). It applies from the next
  time the skill loads, in this session too.
- Personal overlay: it applies in every repo from the next time the skill loads.
