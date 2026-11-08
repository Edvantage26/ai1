---
rfc: 3
title: Method skills and refuting reviewers
size: idea
status: draft
created: 2026-11-08
updated: 2026-11-08
---

# RFC 0003: Method skills and refuting reviewers

## Problem

jig enforces *when* work is done (lanes, verify) but gives no method for reviewing it. Agents tend to
approve their own work, and the [prior art](../../.okf/decisions/prior-art.md) measured that cheap
reviewers catch little (Haiku reviewers caught 0/10 planted defects) and that review loops churn unless
the re-review is scoped and capped.

## Idea

A small set of skills and agents, opt-in:

- **review**: a reviewer subagent with a fixed contract: a merge-base range, read-only, findings with
  file and line, and a "declined to judge" list.
- **finding verifier**: each finding is re-checked by a fresh agent that tries to refute it, so only
  confirmed findings reach the person.
- **ftd** (fast-track development) as a named method for the plan lane, if lanes shows it is needed.
- Deterministic helpers instead of prose where possible: a `review-package` script that builds the
  diff and context for the reviewer.

Alternatives seen so far: rely on Claude Code's own review commands; take Superpowers' skills as is
(rejected in the prior art: too heavy, prompt-only); do nothing.

## Why it matters

It closes the loop after `verify`: tests passing is necessary, not sufficient.

## Open questions

- Which of these overlap with built-in Claude Code review commands, and is a jig version still worth it?
- Model choice per role (judgment must not be cheapened, per the prior art).
- How to cap re-review rounds with a hook rather than a prompt.

## How to resume

- Source of the ideas: [prior art](../../.okf/decisions/prior-art.md), "Candidate ideas".
- Current lanes and verify behaviour: [lanes](../../.okf/features/lanes.md), [verify](../../.okf/features/verify.md).

## Outcome

<!-- Filled in when it is decided. -->

## History

- 2026-11-08: created as an idea, from roadmap phase 6
