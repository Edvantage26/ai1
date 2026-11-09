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
  at: '2026-11-09T09:20:51Z'
---

Built 2026-11-09 from proposal 0005; decision in [harness guards](../decisions/harness-guards.md).
Part of the [hook runtime](hook-runtime.md), not of a feature: always on, off with `AI1_DECISION_LOG=0`.

# What is logged

`hook-dispatch.mjs` times every enabled module it runs and appends one line per run, in one write
per hook call, to `<state dir>/decisions-<shortHash(sharedRoot)>.jsonl` (one file per repo, shared
by its worktrees):

`{ at, session, event, tool, module, decision, ms, chars }` - `decision` is the module's kind
(`allow` included, `error` when it threw), `chars` the length of the context text or reason it added.
**No command text, paths or content**, so the log holds nothing private. Above 2 MB the file moves
to `.1` (one old file kept). Write errors are ignored.

# Reading it

`ai1 log [--session <id>] [--since <hours>] [--json]`: per module, runs, decisions by kind, total /
average / max ms and characters added, slowest first; then the latest 10 asks, refusals, blocks and
errors. `/ai1:core-report-issue` points to it for a hook that misfires or is slow.

# Cost

Measured 2026-11-09: the append costs 0.115 ms per hook call (1,000 calls of 5 entries, in process);
on the entry point (Node start ~120-160 ms) the difference is below the noise of 50 runs.
Tests set `AI1_DECISION_LOG=0` (`test/helpers.mjs`) so a test run never writes to the person's log.

Tests: `test/decision-log.test.mjs`.
