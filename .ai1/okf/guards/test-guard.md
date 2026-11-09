---
type: Component
title: test-guard
description: PreToolUse guard that asks the person before the agent skips, empties, weakens or deletes tests, so the verify gate cannot be passed that way.
tags: [guard, hooks, verify, tests]
resource: src/verify/test-guard.mjs
sources:
  - id: proposal-0003
    resource: .ai1/later/0003-test-weakening-guard.md
    title: Later 0003
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T13:24:58Z'
---

Feature `verify` (on by default), PreToolUse on Edit, Write, MultiEdit and Bash. Built 2026-11-09
from later 0003; decision in [harness guards](../decisions/harness-guards.md).

# Why

The [verify gate](../features/verify.md) trusts a full passing run, and nothing read what the tests
say: deleting, skipping or loosening a test opens the gate without fixing anything.

# What it does

Only on test files: option `modules.test-guard.test_paths` (globs, replacing the defaults
`*.test.*`, `*.spec.*`, `test_*.py`, `*_test.py`, `*_test.go`, `**/test/**`, `**/tests/**`,
`**/__tests__/**`). Shapes, compared before and after, each one an id for `ignore_rules`:

| Rule | Matches |
|---|---|
| `test-skip-added` | more skip/focus markers after than before: `.skip(`/`.only(`/`.todo(`, `xit(`, `fit(`, `t.skip(`, `{ skip: true }`, `@pytest.mark.skip/skipif/xfail`, `@unittest.skip`, `pytest.skip(`, Go `t.Skip` |
| `test-assertions-removed` | fewer assertion calls after (`assert*(`, `assert x`, `expect(`, `self.assert*`, tap/ava `t.*`, Go `t.Error/Fatal`, `require.*`, `.should`) |
| `test-file-emptied` | a Write that leaves a test file with assertions without any |
| `test-file-removed` | `rm`/`git rm` of a test file holding assertions or of a test folder; `mv` of one to a non-test path |
| `test-shell-edit` | any other shell write to a test file (`sed -i`, redirect, `tee`, a move over it, an inline script naming one), since it bypasses the per-edit check |

Edit compares `old_string` with `new_string`; MultiEdit sums all its edits (moving an assertion
between edits of one call is not flagged); Write compares the file on disk with the new content.
Added tests are never flagged; renaming a test to another test path is fine. Any shape -> `ask`:
"fix the code, not the test; if the person asked for this change, they confirm".

# Limits

- Counting is textual: moving assertions into a helper looks like a removal (the person confirms, or
  `ignore_rules`), and a weakened assertion that keeps its call (`toBe(3)` -> `toBeDefined()`) is not seen.
- No Stop-time "tests changed, no source changed" check: sessions that only write tests are legitimate.

Tests: `test/test-guard.test.mjs`.
