---
type: Component
title: test-guard
description: PreToolUse guard that asks the person before the agent skips, empties, weakens or deletes tests, or changes the configuration of a check (lint, format, types, test runner), so the verify gate cannot be passed that way.
tags: [guard, hooks, verify, tests]
resource: src/verify/test-guard.mjs
sources:
  - id: proposal-0003
    resource: .ai1/later/0003-test-weakening-guard.md
    title: Later 0003
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T21:12:24Z'
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
| `check-config-changed` | an edit, shell write, `rm` or `mv` of an existing check config file; see below |

Edit compares `old_string` with `new_string`; MultiEdit sums all its edits (moving an assertion
between edits of one call is not flagged); Write compares the file on disk with the new content.
Added tests are never flagged; renaming a test to another test path is fine. Any shape -> `ask`:
"fix the code, not the test; if the person asked for this change, they confirm".

# Check configuration (since 2026-11-09)

Agents make a check pass by relaxing its config instead of fixing the code (the reason for
`config-protection` in [Everything Claude Code](../decisions/prior-art.md#ecc-review-2026-11-09)).
- Dedicated files, option `modules.test-guard.check_config_paths` (globs, replacing the defaults):
  `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, `biome.json(c)`,
  `.stylelintrc*`, `stylelint.config.*`, `tsconfig*.json`, `jsconfig.json`, `jest.config.*`,
  `vitest.config.*`, `.mocharc*`, `ruff.toml`, `mypy.ini`, `.flake8`, `.pylintrc`,
  `pyrightconfig.json`, `pytest.ini`, `.coveragerc`, `.golangci.*`, `clippy.toml`, `.rubocop.yml`.
  Any change to an existing one asks; creating one does not.
- Shared files: `pyproject.toml`, `setup.cfg`, `tox.ini` count only when the text of a checker
  section (`[tool.ruff...]`, `[mypy]`, `[tool:pytest]`, `[coverage...]`...) differs after the edit;
  `package.json` only when its `eslintConfig`, `prettier`, `jest`, `stylelint`, `mocha` or `ava` keys
  differ. Shell writes to shared files are not judged (no section is known).
- Before and after are the file on disk and the file with the edit applied (`replace_all` honoured).

# Limits

- Counting is textual: moving assertions into a helper looks like a removal (the person confirms, or
  `ignore_rules`), and a weakened assertion that keeps its call (`toBe(3)` -> `toBeDefined()`) is not seen.
- Check configs are judged by file, not by effect: tightening a rule asks too (the person confirms).
- No Stop-time "tests changed, no source changed" check: sessions that only write tests are legitimate.

Tests: `test/test-guard.test.mjs`.
