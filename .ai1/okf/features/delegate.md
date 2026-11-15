---
type: Feature
title: delegate feature (foreign-repo, ai1 delegate, /ai1:session-delegate-change)
description: An edit to a file of another repository with ai1 active is refused and delegated to a claude -p session started there, so its own rules apply; the delegated session stops and returns its questions, and is resumed with the person's answer.
tags: [delegate, foreign-repo, cross-repo, claude-p, submodules]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-15T08:56:48Z'
---

# What it does

- **Detection (module `foreign-repo`, PreToolUse on Edit/Write/MultiEdit/NotebookEdit/Bash).** For each
  path a call changes (file tools; for Bash, what the command line tells: redirections, `sed -i`,
  cp/mv/rm targets; inline scripts are not read), the owning repository is found from the `.git` entries
  on disk (`src/core/owning-repo.mjs`): `launch` (the launch repo or one of its linked worktrees),
  `submodule` (of the launch repo, nested too) or `foreign`.
  - Foreign with ai1 and `features.delegate` on **in that repo**: **deny** (kept in bypass mode), naming
    the repo and `ai1 delegate --cwd <repo> ...`. Reading is never refused.
  - Foreign without ai1: one line of context per repo and session (read its CLAUDE.md).
  - Submodule of a launch repo with ai1, or the launch repo: nothing.
- **The edited repository decides** (`decidedByTarget` in `src/core/module-index.mjs`): the dispatcher runs
  the module whatever the launch repo enables, and also where the launch directory has no ai1 at all
  (`runTargetDecidedModules` in `src/core/hook-dispatch.mjs`; every other module stays off there, as
  before). With no launch project, a submodule that has its own ai1 counts as foreign. Needs the plugin
  enabled for the person (user settings), not only in the launch repo.
- **"Do it here".** Only when the person says so: `ai1 delegate allow <repo> --because "<their words>"`
  allows edits to that repo for the rest of the session (state keyed by session and launch root).

# ai1 delegate (src/delegate/delegate-session.mjs, src/cli/delegate-command.mjs)

- `ai1 delegate --cwd <repo> (--brief <file> | "<task>")` runs `claude -p --output-format json
  --session-id <uuid>` in that repository, with the brief plus a fixed protocol (follow that repo's
  rules, do not push, end with `AI1-DELEGATE: done` or `AI1-DELEGATE: needs-input: <question>`).
  `CLAUDE_PROJECT_DIR` is set to the repo so its hooks resolve there. Claude Code is started with
  `claude`, or the command given with `--claude-command` / `AI1_CLAUDE_COMMAND` (a resume reuses it). A
  plain `claude` launched from a tool call may not be logged in (seen 2026-11-15: "OAuth session
  expired"); the command a machine needs (a wrapper that logs in its account) goes in the person's skill
  customization, never in the plugin ([host tooling stays out](../decisions/host-tooling-out-of-plugin.md)).
- The permission mode is inherited from the calling session (recorded by `foreign-repo` from the hook
  input), `--permission-mode` overrides it. Hooks run in every mode, so the repo's guards always apply.
- **Status:** `done` / `needs-input` from the status line; `blocked` when `permission_denials` is not
  empty and the agent did not finish (in `claude -p` a hook `ask` counts as a denial in every mode,
  checked 2026-11-15); `failed` for a crash, `is_error`, no JSON or no status line.
- **Result:** JSON on stdout and saved in `.ai1/work/delegations/<session>.json` of the caller (temp dir
  without ai1): status, question, summary, session_id, commits (any branch, since the run started),
  changed_files (commits plus uncommitted, worktrees included), new_worktrees, denied, cost.
- **Resume:** `ai1 delegate --resume <id> "<answer>"` continues the same session (`claude -p --resume`).
  `--allow-once "<command>"` grants a one-time allow that `danger` and `repo-rules` honour once in that
  session for that exact command or file; it lifts an **ask** only, never a deny.
- Skill `/ai1:session-delegate-change`: write the brief, run in the background, relay questions word
  for word, `--allow-once` and `allow` only after the person's explicit yes.

# Submodules (superprojects with one config)

`listFilesChangedSinceBase` (`src/core/session-base.mjs`) lists a changed submodule by its own changed
files, with the path from the top repo, nested submodules too (depth 3), against each submodule's HEAD
at session start (recorded with the session base from `git submodule status --recursive`, only where
`.gitmodules` exists). So verify-gate, storyboard-reminder, later-upkeep and okf-upkeep see changes
inside submodules. Fallbacks: no record, the commit the parent recorded; base commit missing locally,
the submodule path; not initialized, skipped. A repo without submodules gets the plain git lists.
Untracked files not ignored in a submodule (an un-ignored `venv/`) are listed and slow the Stop hook.

# Validate

- `node --test test/owning-repo.test.mjs test/foreign-repo.test.mjs test/delegate.test.mjs test/submodule-changes.test.mjs`.
- End to end: `ai1 delegate --cwd <temp repo> "<task that commits a file>"` returns `done` with the commit
  (done 2026-11-15, about 0.4 USD).

# Not covered

- Shell edits the command line does not show (inline scripts, `cd ../x && ...` resolved later).
- Live questions while the delegated session waits: see the Agent SDK idea (not built).
- Each delegated change is a new session: one-line edits pay the same.

See [hook runtime](../architecture/hook-runtime.md), [session fork](session-fork.md), [verify](verify.md).
