---
number: 5
title: Local log of hook decisions
size: idea
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Later 0005: Local log of hook decisions

## Problem

There is no record of what ai1's hooks decided: which module asked, blocked or injected, how long it
took, how many tokens it added. Misfires are reported from memory, and the critique that memory and
harness add-ons cost context (lord.technology, 2026-04) cannot be answered with numbers. Superpowers
measured that changing injected text broke the prompt cache in 83% of sessions; ai1 has not measured
its own.

## Idea

An opt-in local JSONL log, one line per hook decision: time, session, event, module, decision
(allow/ask/deny/block/inject), duration in ms, characters injected. Under the state directory or a
git-ignored `.ai1/` path, rotated. Read by an `ai1` CLI report (per session and module) and, with
private data removed, by `/ai1:core-report-issue`. Base for `ai1 doctor --session` (roadmap phase 5).

Alternatives: do nothing; Claude Code's own debug output; transcript mining only (no durations).

Prior art: [claude-code-hooks-mastery](https://github.com/disler/claude-code-hooks-mastery) logs every
event as JSON (no license: ideas only); `nerf-receipts` and `context-hogs` (karanb192, MIT).

## Why it matters

Gives the data to decide on everything else (false positives, cost per module). Not urgent.

## Open questions

- On by default or opt-in? Where exactly, and how long kept?
- What counts as private (command lines, paths) and how it is stripped for issues.
- Writing a file per hook call must stay within the milliseconds budget.

## How to resume

Survey and code check: `.ai1/okf/decisions/prior-art.md` ("Skills and hook packs survey" and "Harness and memory projects", 2026-11-09).

## Outcome

Accepted and built on 2026-11-09 (v0.21.0): always on (off with `AI1_DECISION_LOG=0`), one line per module run with metadata only, rotated at 2 MB, read with `ai1 log`; 0.115 ms per hook call. Concepts: `.ai1/okf/architecture/decision-log.md`, `.ai1/okf/decisions/harness-guards.md`.

## History

- 2026-11-09: created as an idea
- 2026-11-09: status accepted
- 2026-11-09: status implemented
