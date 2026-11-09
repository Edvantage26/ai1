---
type: Component
title: verify feature
description: Stop gate - the agent cannot finish while code it changed is newer than the last passing run of the verify commands; ai1 verify and ai1 step-done.
tags: [verify, hooks, evidence, cli]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T09:20:51Z'
sources:
  - id: verify-gate
    resource: src/verify/verify-gate.mjs
    title: Stop module
  - id: verify-run
    resource: src/cli/verify-run.mjs
    title: ai1 verify / ai1 step-done
  - id: transcript-scan
    resource: src/core/transcript-scan.mjs
    title: Incremental transcript reader
---

# Why

"Evidence before claims" ([principles](/decisions/principles.md)) as a mechanism. Every workflow
that works in the [prior-art review](/decisions/prior-art.md) shares one thing: an exit condition the
agent cannot declare by itself (Ralph loop backpressure, Superpowers `task-done`). Superpowers'
prompt-only version measured agents running only the named test file in 11/12 runs. On by default;
it does nothing in a repo without `verify` commands in `.ai1/config.json`.

# test-guard (PreToolUse)

The gate trusts a passing suite, so [test-guard](../guards/test-guard.md) asks the person before an
edit or shell command skips, empties, weakens or deletes tests (since 2026-11-09).

# verify-gate (Stop)

1. Files changed in the session: `git diff --name-only <base HEAD>` + untracked, modified after the
   session started, minus ignored globs (`*.md`, `.claude/**`, `.ai1/work/**`, the knowledge bundle,
   plus `modules.verify-gate.ignore_paths`).
2. Runs of each verify command, from the transcript (incremental, `src/core/transcript-scan.mjs`):
   a Bash call whose simple commands contain the full command (redirects and pipes allowed; extra
   arguments or filters do not count; compound commands must appear in order), or `ai1 verify` /
   `ai1 step-done`. Outcome: `is_error` of the tool result (Claude Code marks a non-zero exit with
   `Exit code N`), or a failure summary in the output (`# fail N`, `N failed`, `FAILED`, `FAIL`)
   for exit codes hidden by a pipe.
3. Blocks when a changed file is newer than the end of the last run (lists those files and asks to
   run the command as is), or when that run failed (asks to fix it or say plainly that it fails).
   At most 2 blocks per situation, then it lets the agent stop.
   It does not block when the transcript shows no call that may have written files
   (`src/core/session-writes.mjs`): the changes belong to another session in the same folder.

Changes are judged by file modification time, not by which tool wrote them, so edits by subagents or
shell commands count. Session start comes from the base HEAD recorded by `brief` (core, always on).
Files that `ai1 worktree finish` wrote into this checkout after a pre-finish that ran every verify
command, and untouched since, do not count (see the integration record in [worktrees](worktrees.md)).

# CLI

- `ai1 verify`: runs the verify commands in order with their output, stops at the first failure,
  exits with its code.
- `ai1 step-done <slug> "<step>"`: `ai1 verify`, then appends `- <time> <step> - verify green: ...`
  to `.ai1/work/<slug>/progress.md` only when green. Used by the [lanes](lanes.md) deep skill, so the
  progress log is evidence.

# Limits

- The transcript does not say in which directory a command ran: `cd elsewhere && npm test` counts.
- Runs made by subagents are not in the main transcript: the main agent must run the command itself.
- Failure summaries are a heuristic for piped output; prefer running the command unpiped.
- Two sessions that both write in the same folder still see each other's changes: dates cannot tell
  them apart. One worktree per session avoids it ([worktrees](worktrees.md)).

# Verified

- `npm test` (2026-11-08): 138 tests, 13 for verify (stale, pass, re-change, failed twice then
  allowed, piped failure, filtered run vs `ai1 verify`, ignored paths, pre-session changes,
  feature off, command matching, failure detection, CLI, globs).
- Scan of a real 2.2 MB session transcript: finds the last `npm test 2>&1 | grep ...` run as
  passed; 71 ms first pass, 2 ms incremental.
- Not yet tried in a live Claude Code session.
