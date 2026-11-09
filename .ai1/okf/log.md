# Update Log

## 2026-11-09
* **Creation**: [config-guard](guards/config-guard.md), [test-guard](guards/test-guard.md), [repo-rules](guards/repo-rules.md), [decision log](architecture/decision-log.md) and the decision [harness guards](decisions/harness-guards.md) — proposals 0002-0006 built in v0.21.0 (plus credential deny rules in [ai1 init](features/init.md)).
* **Creation**: [issue report](features/issue-report.md) — `/ai1:core-report-issue` and `ai1 issue` (env, url): a problem with ai1 filed on its public repo after the person approves the text.
* **Supersession**: the `rfc` feature is now [proposals](features/proposals.md) (`features/rfc.md` renamed): folder `.ai1/proposals/`, `/ai1:proposals-write`, `ai1 proposals`, modules `proposals-*`; created only on request or acceptance; `ai1 init` migrates the old names. Older entries keep the names of their time.

## 2026-11-08
* **Creation**: [session fork](features/session-fork.md) — `/ai1:session-fork-conversation` and `ai1 fork` (full or brief), opened natively per host.
* **Supersession**: the OKF pack (git subtree of the `Edvantage26/okf-skills` fork in `packs/okf/`) is replaced by the [OKF toolkit](packs/okf-pack.md) owned by ai1 (`skills/okf-*`, `agents/`, `vendor/`); the fork is retired.
* **Supersession**: the plugin `jig` is now `ai1` (all in one): skills `/ai1:<module>-<action>`, CLI `ai1`, and everything it writes in a repo under `.ai1/` (`.claude/jig.json` -> `.ai1/config.json`, `.okf/` -> `.ai1/okf/`, `docs/rfc/` -> `.ai1/rfc/`, `.jig/work/` -> `.ai1/work/`), migrated by `ai1 init`; see [plugin layout](architecture/plugin-layout.md). This bundle moved to `.ai1/okf/`; older entries keep the names of their time.
* **Creation**: [worktrees feature](features/worktrees.md) — per-project worktree recipe planned with `/jig:worktree` and saved as the project skill, `jig worktree` engine (modes full/light/auto by disk), session brief and reminder; hooks resolve a tree root and a shared root ([hook runtime](architecture/hook-runtime.md)).
* **Creation**: [rfc feature](features/proposals.md) (now proposals) — proposals and future features in `.ai1/rfc/`, `/jig:rfc`, `jig rfc`, rfc-brief/recall/upkeep; roadmap phases 3, 5 and 6 recorded as RFCs 0001-0003.
* **Creation**: [verify feature](features/verify.md) — Stop gate on unverified changes, `jig verify`, `jig step-done`.
* **Creation**: [design feature](features/design.md) — UI rules at session start and the `design-detect` PostToolUse check (26 deterministic rules), ideas from Impeccable.
* **Creation**: [lanes feature](features/lanes.md) — work lanes by task size, approval gate for deep designs, `/jig:deep` skill.
* **Verification**: [prior art](decisions/prior-art.md) — Superpowers re-reviewed in depth (v7.0.2) and community view on SDD recorded.

## 2026-10-31
* **Supersession**: the per-repo file `.claude/harness.json` is now `.claude/jig.json` (schema `schema/jig.schema.json`), see [contract](architecture/harness-contract.md).
* **Creation**: [features](architecture/features.md), [okf feature](features/okf.md), [/jig:init and the CLI](features/init.md), [OKF pack](packs/okf-pack.md).
* **Deprecation**: [profiles](architecture/profiles.md) superseded by [features](architecture/features.md).

## 2026-10-30
* **Migration**: bundle migrated to OKF v0.2 with `okf_validate.py --migrate` (`timestamp` -> `generated`).
* **Creation**: [Hook runtime](architecture/hook-runtime.md) and [danger guard](guards/danger.md) — increment 1: single entry point, module registry, harness.json validation, brief at session start, 65 tests, CI, verified in real Claude Code sessions.
* **Update**: [harness.json contract](architecture/harness-contract.md) — per-module settings under `modules.<id>`; `version` field. [Roadmap](roadmap.md) — generic structure first.
* **Creation**: bundle created with [overview](overview.md), [plugin layout](architecture/plugin-layout.md), [harness.json contract](architecture/harness-contract.md), [profiles](architecture/profiles.md), [prior art](decisions/prior-art.md), [principles](decisions/principles.md) and [roadmap](roadmap.md), from PROJECT.md and the review of Superpowers, rsc-harness and rsc-factory.
