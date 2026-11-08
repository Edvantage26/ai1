# Update Log

## 2026-11-08
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
