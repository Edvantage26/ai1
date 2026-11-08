---
type: Component
title: craft feature
description: Code craft rules injected at session start so the code grows in order - simplicity, surgical changes, reuse before writing, proposed refactors, self-explanatory names.
tags: [craft, clean-code, hooks, context]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T17:33:51Z'
sources:
  - id: craft-brief
    resource: src/craft/craft-brief.mjs
    title: SessionStart recipe
---

# Why

Agents tend to add code that is not needed, touch code next to the change, and write a new helper
when one already exists. A plugin cannot ship a `CLAUDE.md`, so the rules go in as SessionStart
context. Decided with the person on 2026-11-08; on by default because it is text only and blocks
nothing.

# Rules

From the [Karpathy guidelines](/decisions/prior-art.md): **simplicity first** (the minimum code
that solves the task, no speculative options or abstractions) and **surgical changes** (every
changed line traces to the request, match the surrounding style, remove only what your change left
unused). Their other two rules are already covered: think before coding by
[lanes](/features/lanes.md), goal-driven execution by `verify`.

Added on top: **reuse before writing** (look in the code and, with `okf` on, the bundle),
**refactors are proposed, not applied** (duplication, dead code, missing or needless abstraction:
one line, wait for a yes), and **self-explanatory names** in the casing of the language.

The surgical rule and the refactor rule meet like this: notice and propose, do not fix inside an
unrelated change.

# Where things live

Layout, how to add each kind of piece and the catalogue of reusable helpers are knowledge, so
they are concepts in the OKF bundle (kept current by [okf-upkeep](/features/okf.md)), not part of
this feature. The reuse rule points the agent at the bundle for that reason.

# Module

| Module | Event | What it does |
|---|---|---|
| `craft-brief` | SessionStart | Injects the five rules, byte-stable per repo, skipped on `resume`. |

# Limits

- Prompt only: nothing checks that the diff stays surgical. A separate check (*planned*, not part
  of the `verify` gate) that flags a diff touching files outside the task would make part of it a
  mechanism.

# Verified

- `npm test` (2026-11-08): 128 tests, 3 for craft (rules present by default, bundle path when
  `okf` is on, silent on resume and when off).
