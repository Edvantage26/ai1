---
name: core-setup-config
description: Core — Set up the person's config repo, so their Claude Code config (global CLAUDE.md, settings, user skills, ai1 customizations and stack) is kept in a private git repo that ai1 syncs on every machine and commits by itself. Use when a session start offers it, or when the person says "guarda mi configuración de Claude", "sincroniza mi config entre máquinas", "monta el repo de config", "usa mi repo de dotfiles de Claude", "estoy en una máquina nueva", "set up my config repo", "sync my Claude config", "new machine".
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *) Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" config *)
---

# Set up the person's config repo

`ai1` below is `"${CLAUDE_PLUGIN_DATA}/bin/ai1"`. Once set up, nothing else is needed: at the end of each
session ai1 commits what changed in the config, at the start it copies into place what arrived, and every
day or so it asks for `ai1 config sync` (pull and push). No rule in CLAUDE.md is needed for that.

What the repo holds (`ai1 config status` shows it): `claude/` -> `~/.claude` (CLAUDE.md, user skills,
scripts; `settings.json` only the person's keys), `home/` -> `~` (e.g. a home CLAUDE.md, `.mcp.json`),
`ai1/` -> `~/.config/ai1` (customizations of ai1's skills, the stack), `machines/<host>/` for what belongs
to one machine only. Never credentials, `*.local.json` or Claude Code's own state.

## 1. Find out which case it is

Look before asking: `ai1 config status` (is there a repo already?), whether `~/.claude/CLAUDE.md`,
`~/.claude/settings.json` or `~/.claude/skills/` are symlinks into some folder (an existing config repo
wired by an install script), and `gh auth status` (can a private repo be created?). Then offer, with your
recommendation:

- **Adopt** an existing config repo wired with symlinks: `ai1 config adopt <folder> [--auto-push]`. It is
  reordered to the layout in its own commit, moved to `~/.config/ai1/config-repo/` (the old path becomes a
  link to it), and the symlinks become copies. Files it does not map stay in the repo, listed.
- **Clone** on a new machine: `ai1 config clone <owner/repo or git url>`. Anything different already in
  place is kept as `.bak`.
- **New**: create the private repo with the person's yes (`gh repo create <owner>/<name> --private`), then
  `ai1 config init --remote <url>` (it takes in what is already in `~/.claude`) and `ai1 config push`.

## 2. Push: by hand or automatic

Ask once: push on every `ai1 config sync` (`autoPush: true` in `ai1-config.json` of the repo; `adopt` takes
`--auto-push`) or only with `ai1 config push`. Recommend automatic when they already push their config every
time.

## 3. Leave it clean

- If their CLAUDE.md has a rule like "commit and push the config after every change", or an install script
  links the files, offer to remove them: ai1 does it now.
- Show `ai1 config status` and say in two lines what is synced and what to do on another machine
  (`ai1 config clone <repo>`).

## Fixed rules

- Creating a remote repo and pushing are done only after the person's yes (or their autoPush choice).
- Never move credentials, `*.local.json` or Claude Code's state into the repo.
- Nothing is overwritten without a `.bak`, and nothing is deleted outside git.

## Customization

This person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context core-setup-config` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context core-setup-config`
