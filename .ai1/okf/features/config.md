---
type: Component
title: ai1 config - the person's Claude Code config in a repo ai1 keeps
description: The person's global CLAUDE.md, user skills, scripts, settings keys, ai1 customizations and stack kept in a private git repo that ai1 structures, copies into place on Linux, macOS and Windows, and commits at the end of every session; ai1 config CLI, the config-sync-start/stop and config-skill-hint hooks (person-scoped, run in any folder), /ai1:core-setup-config.
tags: [config, person, sync, hooks, cli, skills]
resource: src/config/config-repo.mjs
sources:
  - id: config-repo
    resource: src/config/config-repo.mjs
    title: layout, fingerprints, sync plan, copies with .bak
  - id: config-settings
    resource: src/config/config-settings.mjs
    title: settings.json key by key
  - id: config-sync
    resource: src/config/config-sync.mjs
    title: apply, capture and commit, pull and push, the lock
  - id: config-command
    resource: src/config/config-command.mjs
    title: ai1 config init|clone|adopt|status|sync|commit|push|new-skill|machine|off|on
  - id: setup-skill
    resource: skills/core-setup-config/SKILL.md
    title: /ai1:core-setup-config
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T15:37:14Z'
---

Built 2026-11-22 from the plan `ai1-config`, asked by the person ("que la configuración global se
gestionara desde ai1 ... y ai1 fuera el encargado de commitear y estructurarla"). Decision and prior art:
[config repo decision](../decisions/config-repo.md),
[prior art](../decisions/prior-art.md#syncing-a-persons-claude-code-config-across-machines-2026-11-22).

# The repo

`~/.config/ai1/config-repo/` (the ai1 config folder, `$XDG_CONFIG_HOME` respected), one tree per target:

| Repo | Target |
|---|---|
| `claude/...` | `~/.claude/...` (CLAUDE.md, `skills/`, `scripts/`, any file put there) |
| `claude/settings.json` | `~/.claude/settings.json`, only the person's keys (below) |
| `home/...` | `~/...` (a home CLAUDE.md, `.mcp.json`, `skills-lock.json`) |
| `ai1/...` | `~/.config/ai1/...` (`skills/<feature>/customization.md`, `stack.md`) |
| `machines/<host>/<same tree>` | the same, for one machine only; it wins over the common tree |

`ai1-config.json` in the repo: `autoPush` (default false), `settingsKeys` (default `env`, `hooks`,
`permissions`, `enabledPlugins`, `extraKnownMarketplaces`, `statusLine`, `model`), `exclude` (tree paths),
`files` (`{ repo, target }` for a target outside the three roots), `links` (`{ repo, target }` kept as a
symlink, e.g. a script in `~/.local/bin`; skipped with a note where the OS refuses). The person's local
state: `~/.config/ai1/config-state.json` (fingerprint, target, repo path and source of every managed file,
settings key fingerprints, `machine`, `off`, `lastSyncAt`, `setupOfferedAt`).

# How a file moves

Copies, never symlinks: the same on every OS without special rights, and nothing breaks when Claude Code
recreates `~/.claude`. Each managed file is compared three ways - repo, copy, fingerprint recorded at the
last sync (`planConfigSync`): `in-sync`; `install` (no copy) and `install-backup` (a different file there,
kept as `.bak`); `apply` (repo changed); `capture` (copy changed: back to the tree it came from, common or
machine); `capture-new` (a new file in `claude/skills`, `claude/scripts`, `ai1/skills`, or the CLAUDE.md /
`stack.md` themselves); `capture-delete` and `apply-delete` (a deletion travels; the other side is deleted
only when unchanged); `conflict` (both changed, or the repo dropped a file the person changed): nothing
touched, named. Never managed: `claude/skills/synced`, `.trash`, `__pycache__`, `node_modules`, `*.pyc`,
`*.bak`, plus `exclude`. A target that is a symlink into the repo counts as in sync (an install script).
The repo is byte-exact: `init` and `adopt` write `.gitattributes` with `* -text` and `clone` runs with
`core.autocrlf=false`; without it a Windows clone turned LF into CRLF and every copy differed from the
other machines' (caught by the Windows CI job on v0.62.0).

`settings.json` goes key by key (`config-settings.mjs`): a key in `machines/<host>/claude/settings.json`
replaces the common one whole; keys that are not the person's are never read into the repo nor removed
from the target; a key changed on both sides is a conflict on its own.

# When it runs

- **config-sync-start** (SessionStart): applies what changed in the repo, names conflicts, and asks the
  agent to run `ai1 config sync` when the last sync is over 12 hours old and there is a remote. Without a
  config repo but with a global CLAUDE.md or user skills, a message to the person (not agent context)
  about /ai1:core-setup-config, at most every 30 days, never after `ai1 config off`.
- **config-sync-stop** (Stop): captures and commits locally; a file whose added lines look like a secret
  (`secret-lines.mjs`) is held back and named to the person; a conflict too. Silent otherwise.
- **config-skill-hint** (PostToolUse on Write): once per session, a new `~/.claude/skills/<name>/SKILL.md`
  with a config repo gets where it goes and the shape of a technology skill.
- The three are **person-scoped** (`personScoped` in `module-index.mjs`): they run in any folder, with or
  without `.ai1/config.json` there (`hook-dispatch.mjs` runs them next to the "inactive here" line), and a
  repo cannot switch them off; the person does with `ai1 config off`. No hook uses the network: pull and
  push are the CLI's. Every write holds `~/.config/ai1/config-repo.lock` (stale after 60 s); a session that
  cannot take it skips and the next one picks the change up (agent managers run many sessions at once).
- A notice from a hook in a folder without ai1 used to be dropped (the inactive path returned nothing
  when the combined decision was allow); fixed with this feature.

# The CLI

`ai1 config init [--remote <url>] [--auto-push]` (a new repo with what is already in `~/.claude`),
`clone <owner/repo|url>` (a new machine), `adopt <dir> [--auto-push]` (a repo wired with symlinks: finds
the symlinks into it under `~`, `~/.claude`, `~/.claude/scripts`, `~/.config/ai1` and `~/.local/bin`,
moves each file to its tree with `git mv` in one commit, renames `overlay.md` to `customization.md`, keeps
only the person's settings keys in the repo, moves the repo to `config-repo/` leaving a link at the old path,
turns the symlinks into copies, recreates links elsewhere, lists what it left in the repo unmapped),
`status [--json]`, `sync` (commit local changes, `pull --rebase` - aborted and reported when it stops -,
apply, capture, commit, push when `autoPush`), `commit [-m] [--include <repo path>]`, `push`,
`new-skill <name>` (the technology template: When it applies, Integrate, Audit, Operate, When done, and
its stack line), `machine <name>`, `off`, `on`.

# Tests

`test/config-repo.test.mjs`, `test/config-settings.test.mjs`, `test/config-command.test.mjs` (adopt
skipped on Windows: symlinks need rights there), `test/config-hooks.test.mjs`; on the Windows CI job.
`scripts/run-tests.mjs` points `HOME`/`USERPROFILE` at a folder of the run (git keeps the real global
config through `GIT_CONFIG_GLOBAL`), so the hooks under test never touch the person's real config.
