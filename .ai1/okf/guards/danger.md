---
type: Component
title: danger guard
description: PreToolUse guard that confirms or refuses shell commands that destroy work, history or data.
tags: [guard, hooks, bash]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T07:36:47Z'
---

Source: `src/guards/danger.mjs`. Runs on `Bash` tool calls when the `danger` feature is on (on by default).

Commands are split with `src/core/shell-parse.mjs` (chains `&&`/`||`/`;`/`|`, env assignments,
`sudo`/`nohup` wrappers, `bash -c`/`-lc` scripts), and each simple command is checked against the
rules.

| Rule | Action | Matches |
|---|---|---|
| `git-skip-hooks` | deny | `--no-verify`, `git commit -n`, `-c core.hooksPath=...` |
| `git-reset-hard` | ask | `git reset --hard` |
| `git-force-push` | ask | `--force`, `-f`, `--force-with-lease`, `+refspec` |
| `git-clean` | ask | `git clean -f` (not `-n`) |
| `git-discard-changes` | ask | `checkout -- / .`, `restore` (not `--staged`), `stash drop/clear`, `branch -D` |
| `git-worktree-remove` | ask | `git worktree remove --force`, or a worktree with ignored files |
| `ai1-worktree-drop` | ask | `ai1 worktree drop` |
| `ai1-worktree-finish` | ask | `ai1 worktree finish`: the person decides when a branch is integrated |
| `ai1-proposals-new` | ask | `ai1 proposals new`: only the person decides that something becomes a proposal ([proposals](../features/proposals.md)) |
| `rm-recursive-force` | ask / deny | `rm -r` outside regenerable dirs (`node_modules`, `dist`, `/tmp/...`); deny on `/`, `~`, `$HOME` |
| `sql-destructive` | ask | `DROP`, `TRUNCATE`, `DELETE FROM x` without `WHERE` |
| `docker-destructive` | ask | `system prune`, `volume rm/prune`, `compose down -v` |
| `disk-destroy` | deny | `mkfs*`, `dd of=/dev/...` |

Option: `modules.danger.ignore_rules` (list of rule ids). The schema enum must list every rule id.

In headless sessions (`claude -p`, Paseo agents) an `ask` cannot be confirmed, so it acts as a refusal.
