---
type: Plan
title: Roadmap
description: Phases from proving ai1 in a real repo to the doctor command.
tags: [roadmap]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T04:00:04Z'
---

Order changed on 2026-10-30: build the generic structure in ai1 first, then prove it in real repos.

1. **Core + first guard** (done): dispatcher, config, schema, `brief`, `danger`, tests, CI.
2. **Features + okf feature + /ai1:core-setup-repo** (done 2026-10-31): per-repo features, OKF pack, okf-index/okf-upkeep, CLI.
2b. **Lanes** (done 2026-11-08): quick / plan / deep by task size, deep designs gated by the
   person's approval, progress restored after compaction. See [lanes feature](features/lanes.md).
2c. **Craft** (done 2026-11-08): code craft rules at session start (simplicity, surgical changes,
   reuse, proposed refactors, names). See [craft feature](features/craft.md).
2d. **Design** (done 2026-11-08): UI rules at session start and deterministic design checks on
   edited UI files, ideas from Impeccable. See [design feature](features/design.md).
2e. **RFC** (done 2026-11-08): undecided proposals and future features in `.ai1/rfc/`, apart from
   the bundle until decided. See [rfc feature](features/rfc.md).
2f. **Worktrees** (phase 1 done 2026-11-08): a worktree per significant change with a per-project
   recipe planned once (`/ai1:worktrees-plan-recipe`), engine `ai1 worktree`, brief and reminder. Phase 2 (planned):
   shared read-only caches per version, `writable`, build slots and locks, `WorktreeCreate` hook for
   heavy repos. See [worktrees feature](features/worktrees.md).
2g. **Session fork** (done 2026-11-09, v0.14): `/ai1:session-fork-conversation` and `ai1 fork`, a
   full or brief fork of the conversation opened natively per host. See
   [session fork](features/session-fork.md).
3. **`prod` and `secrets` guards**, driven by .ai1/config.json (MCP tools writing to production, shell
   patterns, secrets in staged files). Proposal (draft): `.ai1/rfc/0001-prod-and-secrets-guards.md`.
4. **`verify` Stop gate** (done 2026-11-08): see [verify feature](features/verify.md).
5. **`ai1 doctor`**: audit a repo against its features. Proposal (draft): `.ai1/rfc/0002-jig-doctor.md`.
6. **Method skills and reviewers**: `ftd`, `verify`, `review`, finding verifier. Proposal (draft):
   `.ai1/rfc/0003-method-skills-and-reviewers.md`.

Not-yet-decided items live as RFCs in `.ai1/rfc/` (index in `.ai1/rfc/README.md`); this roadmap only
orders them. When one is accepted, its decisions become concepts in [decisions/](decisions/index.md).

After each increment, the plugin is tried in real repos of different shapes; the
[contract](architecture/harness-contract.md) is frozen once three of them run it.
