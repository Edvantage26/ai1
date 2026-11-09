---
type: Component
title: danger guard
description: PreToolUse guard that confirms or refuses shell commands that destroy work, history or data.
tags: [guard, hooks, bash]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T14:03:22Z'
---

Source: `src/guards/danger.mjs`. Runs on `Bash` tool calls when the `danger` feature is on (on by default).

Commands are split with `src/core/shell-parse.mjs` (chains `&&`/`||`/`;`/`|`, env assignments,
`sudo`/`nohup`/`xargs` wrappers, `bash -c`/`-lc` scripts, `eval`, and the commands of `find -exec`),
and each simple command is checked against the rules.

| Rule | Action | Matches |
|---|---|---|
| `git-skip-hooks` | deny | `--no-verify`, `git commit -n`, `-c core.hooksPath=...` |
| `git-reset-hard` | ask | `git reset --hard` |
| `git-force-push` | ask | `--force`, `-f`, `--force-with-lease`, `+refspec` |
| `git-clean` | ask | `git clean -f` (not `-n`) |
| `git-discard-changes` | ask | `checkout -- / .`, `restore` (not `--staged`), `stash drop/clear`, `branch -D` |
| `git-worktree-remove` | ask | `git worktree remove --force`, or a worktree with ignored files |
| `ai1-worktree-drop` | ask | `ai1 worktree drop --discard-uncommitted` (without it drop refuses uncommitted changes and keeps the commits in a bundle) |
| `rm-recursive-force` | ask / deny | `rm -r` outside regenerable dirs (`node_modules`, `dist`, `/tmp/...`); deny on `/`, `~`, `$HOME` |
| `find-delete` | ask | `find ... -delete` unless every search root is a regenerable dir |
| `file-truncate` | ask | `truncate` to a size that can cut the file (not `-s +N`) |
| `sql-destructive` | ask | `DROP`, `TRUNCATE`, `DELETE FROM x` without `WHERE` |
| `docker-destructive` | ask | `system prune`, `volume rm/prune`, `compose down -v` |

Removed on 2026-11-09: `ai1-worktree-finish` (integrating locally loses nothing) and `ai1-later-new`
(noting down loses nothing); `ai1-worktree-drop` now asks only when uncommitted changes would be lost.
Decided by the person on 2026-11-09: ai1 asks only for what is truly delicate (losing work or data for good, publishing, production, a deep design); the rest the agent does and reports. These rules are the asks that still reach the person in bypass and auto
permission modes (see [hook runtime](../architecture/hook-runtime.md)).

Here-document bodies that are only data (a script for `python3 -`, a file written with
`cat > f <<EOF`) are not read as commands (`stripHeredocBodies` in `src/core/shell-parse.mjs`);
until 2026-11-09 a script that only mentioned `ai1 worktree drop ... --discard-uncommitted` in a
string was asked about. Bodies a command on the same line runs (`bash`, `sh`, `ssh`, `psql`, `mysql`,
`sqlite3`, `| sh`...) are still checked.
| `disk-destroy` | deny | `mkfs*`, `dd of=/dev/...` |

Option: `modules.danger.ignore_rules` (list of rule ids). The schema enum must list every rule id.

In headless sessions (`claude -p`, Paseo agents) an `ask` cannot be confirmed, so it acts as a refusal.

The `danger` feature also runs [config-guard](config-guard.md) (changes to `.ai1/config.json`,
`.claude/settings*.json`, `.claude/hooks/` ask the person, so `ignore_rules` cannot be edited away
unseen) and [repo-rules](repo-rules.md) (the repo's own rules).
