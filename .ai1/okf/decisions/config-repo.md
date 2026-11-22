---
type: Decision
title: The person's Claude Code config in a repo ai1 keeps - copies, key-by-key settings, commit by mechanism
description: Why ai1 keeps the person's global config (CLAUDE.md, user skills, settings, ai1 customizations, stack) in a private repo it structures and commits itself, with managed copies instead of symlinks, settings by keys, machine trees, no network in hooks, and hooks that run in any folder.
tags: [decision, config, person, sync]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T15:08:07Z'
---

Decided with the person on 2026-11-22, after trying a private plugin for their stack and their own
config repo wired by an install script and a CLAUDE.md rule ("commitea y pushea") that worked only when the
agent remembered it. How it is built: [ai1 config](../features/config.md).

# Decisions

- **ai1 keeps it, by mechanism.** Hooks commit at the end of every session and apply at the start; no rule
  in CLAUDE.md. The person asked for it ("ai1 fuera el encargado de commitear y estructurarla"); it is
  ai1's principle of mechanisms over prompts.
- **Global, per person and machine; never per project.** The repo's location and state live in
  `~/.config/ai1/`; projects only consume it (stack, customizations). The hooks run in any folder because
  the config changes anywhere.
- **Copies with fingerprints, not symlinks.** Prior art: chezmoi copies by default; symlinks on Windows
  need Developer Mode and break when Claude Code recreates `~/.claude` (asked: "¿creará symlinks
  automáticos multiplataforma?").
- **settings.json by keys**, because Claude Code writes in it too (seen the same day: installing a plugin
  wrote through the old symlink into the config repo). Idea from dotclaude.
- **Machine trees** (`machines/<host>/`) instead of templates: what belongs to one machine is a plain file
  that wins; chezmoi's templates are what make it complex.
- **No network in hooks** (ai1 principle): the start hook asks the agent to run `ai1 config sync` when the
  last one is over 12 hours old. `autoPush` false by default; the person's own repo adopted with it on
  ("Ok lo recomendado si").
- **Secrets**: the added lines of every file are checked; a suspect file is held back and named, the rest
  committed; `--include` after checking. The repo's own pre-commit hook stays as a second net.
- **Not a dotfiles manager**: only Claude Code and ai1 files; shell and editor dotfiles stay with whatever
  the person uses. No dependency on chezmoi (ai1 has none).
- **Teams share through a plugin**, not this repo: ai1 already reads customizations and stacks from an
  enabled plugin ([skill customization](../architecture/skill-customization.md)).
