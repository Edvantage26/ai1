---
type: Component
title: verify feature
description: Stop gate - the agent cannot finish while code it changed is newer than the last passing run of the verify commands; ai1 verify, ai1 step-done and ai1 plan-done.
tags: [verify, hooks, evidence, cli]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T06:43:05Z'
sources:
  - id: verify-gate
    resource: src/verify/verify-gate.mjs
    title: Stop module
  - id: verify-run
    resource: src/cli/verify-run.mjs
    title: ai1 verify / ai1 step-done / ai1 plan-done
  - id: transcript-scan
    resource: src/core/transcript-scan.mjs
    title: Incremental transcript reader
  - id: fix-loop
    resource: src/verify/fix-loop.mjs
    title: Failed fix attempts counter
  - id: tool-loop
    resource: src/verify/tool-loop.mjs
    title: Repeated tool call nudge
  - id: debug-skill
    resource: skills/verify-debug-systematically/SKILL.md
    title: /ai1:verify-debug-systematically
  - id: llm-prompts-skill
    resource: skills/verify-evaluate-llm-prompts/SKILL.md
    title: /ai1:verify-evaluate-llm-prompts
  - id: error-analysis-faq
    resource: https://hamel.dev/blog/posts/evals-faq/why-is-error-analysis-so-important-in-llm-evals-and-how-is-it-performed.html
    title: Hamel Husain - why error analysis matters in LLM evals
  - id: error-analysis-notes
    resource: https://hamel.dev/notes/llm/ai-product-engineering/evals-error-analysis.html
    title: Hamel Husain - evals error analysis notes
  - id: advanced-evals
    resource: https://lennysnewsletter.com/p/advanced-evals-how-to-find-and-fix
    title: Hamel Husain and Shreya Shankar - advanced evals, how to find and fix
  - id: llm-eval-speedup
    resource: https://arxiv.org/html/2407.06172v1
    title: On speeding up language model evaluation (bandit model and prompt selection)
  - id: evals-faq
    resource: https://hamel.dev/blog/posts/evals-faq/
    title: Hamel Husain and Shreya Shankar - evals FAQ (open/axial coding, binary checks, TPR/TNR, dev/test)
  - id: judge-self-preference
    resource: https://arxiv.org/pdf/2410.21819
    title: Self-preference bias in LLM-as-a-judge
---

# Why

"Evidence before claims" ([principles](/decisions/principles.md)) as a mechanism. Every workflow
that works in the [prior-art review](/decisions/prior-art.md) shares one thing: an exit condition the
agent cannot declare by itself (Ralph loop backpressure, Superpowers `task-done`). Superpowers'
prompt-only version measured agents running only the named test file in 11/12 runs. On by default;
it does nothing in a repo without `verify` commands in `.ai1/config.json`.

# test-guard (PreToolUse)

The gate trusts a passing suite, so [test-guard](../guards/test-guard.md) asks the person before an
edit or shell command skips, empties, weakens or deletes tests (since 2026-11-09), or changes the
configuration of a check (lint, format, types, test runner): agents relax the check instead of fixing
the code (seen in [Everything Claude Code](../decisions/prior-art.md#ecc-review-2026-11-09)).

# tool-loop (PreToolUse)

Built 2026-11-09 from the ECC review. When the last `repeat_threshold` tool calls (default 5) are the
same tool with the same input (a Bash `description` does not count), the agent gets one line of
context: wait in the background instead of polling by hand, or stop retrying and look for the cause.
- Sees every tool: it reads the transcript incrementally (state `<session>-<hash>.tool-loop`) plus the
  call about to run, deduplicated by tool use id, so a Read or Grep in between breaks the streak.
  Runs on the PreToolUse tools ai1 already wires (Bash, Edit, Write, MultiEdit, NotebookEdit): no new
  hook process per call; a run of identical Reads is seen at the next wired call.
- 5, not 3: ECC fired false warnings on legitimate retries and polling with 3 among 5.
- Told once per repeated call; a different call resets it. Never blocks. Needs PreToolUse
  `additionalContext` (documented by Claude Code; enabled in `hook-io` on 2026-11-09).

# fix-loop (PostToolUse) and /ai1:verify-debug-systematically

Built 2026-11-09. The method skill (from Superpowers `systematic-debugging`, Pocock `diagnosing-bugs`,
Every `ce-debug`, see [prior art](../decisions/prior-art.md)): find the cause before changing code -
read the whole error, reproduce, check recent changes, trace the value back; compare with a working
case; one hypothesis at a time; fix with a test that failed first; red-flag table; wait on conditions,
not sleeps, for flaky tests; after 3 failed attempts stop and talk to the person. Customizable per
project and person (`.ai1/skills/verify/overlay.md`: how to reproduce, where logs are).

The 3-attempt rule is counted, because prose rules are lost after a compaction. `fix-loop` reads the
transcript incrementally (state `<session>-<hash>.fix-loop`) and counts **failed attempts**: a failing
test run (`didRunFail`) with an edit to project code since that same test command's previous run.
- Test runs: the verify commands (any form) and known runners in each simple command - npm/pnpm/yarn/bun
  test, `node --test`, pytest, `python -m unittest`, jest/vitest/mocha, go/cargo/bun/deno test - or
  `modules.fix-loop.test_commands` (regexes, replacing the runner list).
- Streaks are per test command text: the first failure is the bug, not an attempt; re-running without
  an edit does not count; a pass of the same command resets it, a full verify run passing resets all.
- Edits skip `*.md`, `.claude/**`, `.ai1/**`, the bundle and `ignore_paths`; a redirect inside the
  test run (`npm test > out.log`) is not an edit.
- At `max_failed_attempts` (default 3) the next Edit/Write gets one line of context: stop patching, go
  back to the root cause with the skill and tell the person what was tried. Once more at twice the
  threshold, then silent until a reset. Context, not a prompt: the person decided (2026-11-09) not to
  be asked, and headless sessions keep working. Never blocks.
- Checked with the entry point and a compact transcript (2026-11-09). A transcript written with spaced
  JSON (`"type": "tool_use"`) is not scanned: the scan filters lines by the compact marker, as Claude
  Code writes them.

# /ai1:verify-evaluate-llm-prompts

Built 2026-11-11, from a real extraction pipeline where rounds were lost on more expensive models and
almost no failure was the model's (missing context, unstated rules, no vocabulary, a badly built test,
wrong reference labels; cheap confidence signals at AUROC 0.5-0.6). A method skill, no hook, scoped
to evaluating LLM steps in general (named for prompts, not failures, so it also loads while writing
or comparing prompts). Effort grows with the trouble (decided 2026-11-11 with the person): start with a
simple prompt on one cheap model (for a complex task or JSON output, first look on the web - open
repos, papers, provider guides, existing schemas - for how others structured the prompt and the
response, decided 2026-11-11), read 10-20 real outputs, stop if good enough; only otherwise the
rest, in this order: diagnose the failures (checklist; a failure log `case | output | note | failure
mode | cause | evidence`, the cause from a fixed list - `context`, `instructions`, `vocabulary/schema`,
`test setup`, `wrong reference label`, `model limit` -; the agent reads every failure and shows the
person about 10 before fixing the failure modes; fix the most frequent cause; models only after the
first five are ruled out), measure while iterating (20-30 % kept apart as test, used once to confirm;
2-3 runs to see noise; pinned model versions; pass/fail checks over 1-5 scales), a tournament for
models or prompts (candidates looked up on the web first - the agent's knowledge of models stops at
its cutoff and models and prices change every few weeks; climb by price, decided 2026-11-11 with the person: cheap and mid-priced models
first, an expensive one only when none reaches the bar and the failures left are `model limit`, and
it must beat the best cheaper one by the sign test; one case set that grows from the 10-20 starting cases; drop a candidate only when
the leader wins enough of their disagreements by an exact sign test, given as a table - none dropped
with 5 or fewer; cheapest among the indistinguishable; close finalists retried with 2-3 prompt
formats), and labels and judges (expert labels, or a fresh-context subagent labelling blind, ideally
two model families, sampled by the person - decided 2026-11-11; code checks first, one judge per
failure mode by TPR/TNR; position, length and self-family biases). Five fixed rules: start simple,
causes before a model change, same cases for every candidate with test only confirming, labels and
judges checked, testing key and budget. Description kept short on purpose: every skill description
loads in every session.
In `verify` and not a feature of its own because it is the same rule as debugging (cause before
change); the cost is a shared overlay: `.ai1/skills/verify/overlay.md` reaches both skills.

# verify-gate (Stop)

1. Files changed in the session: `git diff --name-only <base HEAD>` + untracked, modified after the
   session started, minus ignored globs (`*.md`, `.claude/**`, `.ai1/work/**`, the knowledge bundle,
   plus `modules.verify-gate.ignore_paths`).
2. Runs of each verify command, from the transcript (incremental, `src/core/transcript-scan.mjs`):
   a Bash call whose simple commands contain the full command (redirects and pipes allowed; extra
   arguments or filters do not count; compound commands must appear in order), or `ai1 verify` /
   `ai1 step-done` / `ai1 plan-done`. Outcome: `is_error` of the tool result (Claude Code marks a non-zero exit with
   `Exit code N`), or a failure summary in the output (`# fail N`, `N failed`, `FAILED`, `FAIL`)
   for exit codes hidden by a pipe.
3. Blocks when a changed file is newer than the end of the last run (lists those files and asks to
   run the command as is), or when that run failed (asks to fix it or say plainly that it fails).
   At most 2 blocks per situation, then it lets the agent stop.
   Only files modified inside one of the session's **write windows** count
   (`src/core/session-writes.mjs`): each call that may write opens a window from its tool_use to its
   tool_result (subagents, background shells and events without a time stay open; ±2 s slack), and a
   shell command whose writes all go to absolute paths outside the project (`/tmp` scratch files)
   opens none. The rest belong to another session in the same folder or predate this one. Until
   2026-11-09 it was one flag per session: any command not known to be read-only (a `python3` script,
   `node bin/ai1 log`, a scratch file in `/tmp`) made every later change by another session count, so a
   session that had only investigated was stopped to run the tests over another session's release.

Changes are judged by file modification time, not by which tool wrote them, so edits by subagents or
shell commands count. Session start comes from the base HEAD recorded by `brief` (core, always on).
Files that `ai1 worktree finish` wrote into this checkout after a pre-finish that ran every verify
command, and untouched since, do not count (see the integration record in [worktrees](worktrees.md)).

# CLI

- `ai1 verify`: runs the verify commands in order with their output, stops at the first failure,
  exits with its code.
- `ai1 step-done <slug> "<step>"`: `ai1 verify`, then appends `- <time> <step> - verify green: ...`
  to `.ai1/work/<slug>/progress.md` only when green. Used by the [lanes](lanes.md) deep skill, so the
  progress log is evidence. When the plan has behaviour scenarios it also prints "scenarios covered
  so far: n/m (missing ...)" (informative; never fails the step).
- `ai1 plan-done <slug>`: closes a deep plan (see [lanes, behaviour scenarios](lanes.md)): approved
  plan, every scenario tagged in the checkout, then `ai1 verify`; only then `status: done` and a
  progress line with each scenario's test location. The verify gate counts it as a full run, like
  `ai1 verify` and `ai1 step-done`.

# Limits

- The transcript does not say in which directory a command ran: `cd elsewhere && npm test` counts.
- Runs made by subagents are not in the main transcript: the main agent must run the command itself.
- Failure summaries are a heuristic for piped output; prefer running the command unpiped.
- Two sessions that write in the same folder at the same moment still see each other's changes: a
  file modified while one of this session's calls was running counts as its own. One worktree per
  session avoids it ([worktrees](worktrees.md)).

# Verified

- `npm test` (2026-11-08): 138 tests, 13 for verify (stale, pass, re-change, failed twice then
  allowed, piped failure, filtered run vs `ai1 verify`, ignored paths, pre-session changes,
  feature off, command matching, failure detection, CLI, globs).
- Scan of a real 2.2 MB session transcript: finds the last `npm test 2>&1 | grep ...` run as
  passed; 71 ms first pass, 2 ms incremental.
- Not yet tried in a live Claude Code session.
