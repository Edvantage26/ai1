---
number: 3
title: Detect weakened, skipped or deleted tests
size: idea
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Later 0003: Detect weakened, skipped or deleted tests

## Problem

The `verify` gate (see [verify feature](../okf/features/verify.md)) needs a full passing run of the
verify commands, but nothing reads what the tests say: deleting a test, marking it skipped, or
weakening an assertion makes the suite pass and the gate open. Checked 2026-11-09: no test-content
check anywhere in `src/` ([prior art](../okf/decisions/prior-art.md)). Superpowers measured agents
running only the named test file in 11/12 runs; weakening is the next cheapest shortcut.

## Idea

Deterministic checks on test files, no LLM:
- PreToolUse on Edit/Write: in the added text of a test file, flag skip/focus markers (`.skip`,
  `.only`, `xit`, `@pytest.mark.skip`, `t.skip`), assertions removed or loosened, mocks of the module
  under test, snapshot rewrites; `ask` with the reason.
- Stop: tests deleted or renamed in the session, or tests changed with no source changed, named in the
  `verify` block reason.

Alternatives: do nothing; only the Stop half (cheaper, later feedback); an LLM review of the diff
(like `security-guidance` v2), against [principles](../okf/decisions/principles.md).

Prior art: `protect-tests` (karanb192, MIT, JS) and [agent-guard](https://github.com/hahahahahahahahah6/agent-guard)
(MIT, Python: tamper shapes, test-tampering at Stop, mutation check).

## Why it matters

Closes the main way to pass `verify` without fixing code. Second after the config guard.

## Open questions

- Which languages first (JS/TS node:test and Jest, Python pytest)? How are test files recognised (globs in `.ai1/config.json`)?
- False positives: a skip the person asked for, a test legitimately removed with its feature.
- Part of `verify` or its own feature?

## How to resume

Survey and code check: `.ai1/okf/decisions/prior-art.md` ("Skills and hook packs survey" and "Harness and memory projects", 2026-11-09). Re-check with `grep -rn "skip\|only" src/verify`.

## Outcome

Accepted and built on 2026-11-09 (v0.21.0): module `test-guard` in feature `verify`, per-edit shapes (skip added, assertions removed, file emptied, file removed, shell edit), `ask`, options `test_paths` and `ignore_rules`; no Stop-time check (it would block sessions that only write tests). Concepts: `.ai1/okf/guards/test-guard.md`, `.ai1/okf/decisions/harness-guards.md`.

## History

- 2026-11-09: created as an idea
- 2026-11-09: status accepted
- 2026-11-09: status implemented
