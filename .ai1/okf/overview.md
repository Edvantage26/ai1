---
type: Overview
title: ai1 overview
description: What ai1 is, the four pieces of a harness, and what exists today.
tags: [overview, harness]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-10T16:51:39Z'
---

# What it is

`ai1` (*all in one*, called `jig` until v0.12.0) is one harness for coding agents (Claude Code
first) instead of loose skills and hooks: guardrails that hold even when the agent
forgets a rule, a verification gate before the agent calls work done, and project memory that lives
in the repo. Everything it writes in a repo lives under `.ai1/` (config, `okf/` bundle, `later/`,
git-ignored `work/`); see [plugin layout](architecture/plugin-layout.md).

# The four pieces

| Piece | What | Lives in |
|---|---|---|
| Memory | Project knowledge, as an OKF bundle (`.ai1/okf/`) | The repo |
| Hands | Tools (CLIs, MCP servers) with a connection test | The repo |
| Trade | Skills: method (generic) and domain (project) | Method in ai1, domain in the repo |
| Reflexes | Hooks that enforce rules | ai1 |

The frame is generic; each repo describes itself in `.ai1/config.json`
(see [contract](architecture/harness-contract.md)).

# Why it exists

Born from professionalizing an internal document-processing backend, where the rules ("never write
to prod", "run the regression test before calling a change done", "keep the knowledge bundle
updated") existed only as text in `CLAUDE.md`. The same rules apply to many other repos with a
similar stack, and almost none enforce them. Prior art and what was taken from it:
[prior art](decisions/prior-art.md).

# Status

v0.29.1 (2026-11-10). Per-repo [features](architecture/features.md) chosen with
[/ai1:core-setup-repo](features/init.md). On by default: the [okf feature](features/okf.md) (index, CLAUDE.md drift hint,
recall, upkeep and the [OKF toolkit](packs/okf-pack.md)), the [danger guard](guards/danger.md), the
[craft rules](features/craft.md) and the [verify gate](features/verify.md); with them, the
[config-guard](guards/config-guard.md), the repo's own [rules](guards/repo-rules.md) and the
[test-guard](guards/test-guard.md). Every module run goes to the local [decision log](architecture/decision-log.md) (`ai1 log`). Opt-in:
[lanes](features/lanes.md), [later](features/later.md), [design](features/design.md),
[walkthrough](features/walkthrough.md) and [worktrees](features/worktrees.md). Plus the [session fork](features/session-fork.md) and [issue report](features/issue-report.md) skills and CLI.
Any customizable skill takes project and personal overlays ([skill customization](architecture/skill-customization.md)).
After 3 failed fix attempts in a row the agent is told to stop and find the root cause ([verify feature](features/verify.md)).
Since v0.28.0 [test-guard](guards/test-guard.md) also asks before a check's config (lint, format, types) is changed, and `tool-loop` nudges the agent after 5 identical tool calls ([verify feature](features/verify.md)).
Since v0.29.0 `worktree-recipe-offer` asks once at stop to offer the worktree recipe when a repo without one had files changed in its main checkout ([worktrees feature](features/worktrees.md)).
The feature for undecided changes is called [later](features/later.md) since v0.25.0 (was `proposals`).
When ai1 itself fails, the agent offers to report it (or reports it, per `AI1_REPORT_ERRORS`; [issue report](features/issue-report.md)).
Next steps in the [roadmap](roadmap.md).

# Code map

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: see [plugin layout](architecture/plugin-layout.md).
- `bin/ai1-hook.mjs`, `src/core/`: hook runtime (see [hook runtime](architecture/hook-runtime.md)).
- `src/<feature>/`: one folder per feature (`okf`, `guards`, `craft`, `verify`, `lanes`, `later`,
  `design`, `walkthrough`, `worktrees`, `session`, `context` for the brief).
- `bin/ai1`, `src/cli/`, `skills/core-setup-repo/`, `skills/core-report-issue/`: the CLI (`status`, `init`, `verify`, `step-done`,
  `later`, `worktree`, `walkthrough`, `fork`, `issue`, `claude-md`, `log`), `/ai1:core-setup-repo` and `/ai1:core-report-issue`.
- `skills/okf-*/`, `agents/`, `vendor/`: OKF toolkit, owned by ai1 (see [OKF toolkit](packs/okf-pack.md)); `skills/okf-tidy-claude-md/` is ai1's own.
- `schema/ai1.schema.json`, `templates/config.json`: the per-repo contract.
- `test/`: `npm test` (node:test suite, plus the Python tests of the OKF toolkit in `test/okf-toolkit/`).
