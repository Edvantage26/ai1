---
type: Component
title: Decision log
description: Local JSONL log of every module run (event, module, decision, ms, characters added), metadata only, read by `ai1 log`.
tags: [hooks, observability, cli]
resource: src/core/decision-log.mjs
sources:
  - id: dispatch
    resource: src/core/hook-dispatch.mjs
    title: Dispatcher that times and logs each module run
  - id: log-command
    resource: src/cli/log-command.mjs
    title: ai1 log
  - id: proposal-0005
    resource: .ai1/proposals/0005-hook-decision-log.md
    title: Proposal 0005
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T12:10:02Z'
---

Built 2026-11-09 from proposal 0005; decision in [harness guards](../decisions/harness-guards.md).
Part of the [hook runtime](hook-runtime.md), not of a feature: always on, off with `AI1_DECISION_LOG=0`.

# What is logged

`hook-dispatch.mjs` times every enabled module it runs and appends one line per run, in one write
per hook call, to `<state dir>/decisions-<shortHash(sharedRoot)>.jsonl` (one file per repo, shared
by its worktrees):

`{ at, session, event, tool, module, decision, ms, chars, toolUse?, rules?, error? }` - `decision` is
the module's kind (`allow` included, `error` when it threw), `chars` the length of the context text or
reason it added, `toolUse` the PreToolUse `tool_use_id` (an opaque id, so the [retro](../features/retro.md)
can find the person's answer), `rules` the rule ids behind an ask or deny (`ruleIds` of
`askDecision`/`denyDecision`: danger, test-guard, repo-rules, config-guard), `error` the signature of a
thrown module: error class + first stack frame inside the plugin as `file:line` (`errorSignature`;
messages and outside frames dropped). A crash of `bin/ai1-hook.mjs` itself is logged as module
`entrypoint`. **No command text, paths or content**, so the log holds nothing private. Above 2 MB the
file moves to `.1` (one old file kept). Write errors are ignored.

A sidecar `decisions-<hash>.repo` holds the repo's folder name and path, written when missing: an
accepted exception to "no paths", local to this machine, read only by `ai1 log --all`, never put in an
issue. Errors also go to `errors-<hash>.json` ([issue report](../features/issue-report.md)). State files
not written for 7 days expire, so a repo unused for a week loses its log (the sidecar comes back with
the next write).

# Reading it

`ai1 log [--session <id>] [--since <hours>] [--all] [--json]`: per module, runs, decisions by kind,
total / average / max ms, characters added, errors and rules, slowest first; then the latest 10 asks,
refusals, blocks and errors. `--all` covers every repo on this machine with ask outcomes (the
[retro](../features/retro.md)). `/ai1:core-report-issue` points to it for a hook that misfires or is slow.

Hooks write to `${CLAUDE_PLUGIN_DATA}/state`; a shell has no such variable, so the CLI reads every
candidate (`listStateDirectoriesToRead`): that dir when set, else each `~/.claude/plugins/data/ai1-*/state`
and `~/.cache/ai1`, merged by time. Until 2026-11-09 `ai1 log` read only `~/.cache/ai1` from a shell
and found nothing.

# Cost

Measured 2026-11-09: the append costs 0.115 ms per hook call (1,000 calls of 5 entries, in process);
on the entry point (Node start ~120-160 ms) the difference is below the noise of 50 runs.
Tests set `AI1_DECISION_LOG=0` (`test/helpers.mjs`) so a test run never writes to the person's log.

Tests: `test/decision-log.test.mjs`.
