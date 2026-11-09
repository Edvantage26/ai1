---
proposal: 5
title: Repo-declared block and warn rules
size: idea
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Proposal 0005: Repo-declared block and warn rules

## Problem

A repo cannot add its own guardrails: `danger` has fixed rules, and `.ai1/config.json` can only
switch them off (`ignore_rules`). Project rules ("never run the migration script", "use pnpm, not
npm", "do not touch generated/") live as text in CLAUDE.md, which is what ai1 exists to replace.

## Idea

Repo-declared block/warn rules, evaluated by the existing `danger` engine: in `.ai1/config.json` or
one file per rule in `.ai1/rules/`, with event (shell / file edit / prompt / stop), a regex or simple
conditions, `ask` or `deny`, and the message. A skill drafts a rule from a correction the person just
made and writes it only after a yes.

Alternatives: do nothing (CLAUDE.md text); recommend Anthropic's `hookify` alongside ai1; Claude Code
permission rules (shell prefixes and paths only, no message).

Prior art: [hookify](https://github.com/anthropics/claude-plugins-official) (official, Apache-2.0):
rules as `.claude/hookify.<name>.local.md`, re-read on every call, `/hookify` mines recent corrections.

## Why it matters

Turns per-repo text rules into mechanisms, the core idea of ai1. The largest of these five; depends
on the config guard (0001), since rules live in files the agent could edit.

## Open questions

- Overlap with hookify: build it, or detect hookify and point to it as with Impeccable?
- Rule format and where it lives; regex safety (catastrophic backtracking) within the hook time budget.
- Should rules be reviewable in `ai1 status`?

## How to resume

Survey and code check: `.ai1/okf/decisions/prior-art.md` ("Skills and hook packs survey" and "Harness and memory projects", 2026-11-09).

## Outcome

Accepted and built on 2026-11-09 (v0.21.0): `rules` in `.ai1/config.json` run by module `repo-rules` (feature `danger`), bash and edit rules, ask or deny, bad rules dropped with a notice; `/ai1:danger-write-rule` writes them through config-guard's prompt. Concepts: `.ai1/okf/guards/repo-rules.md`, `.ai1/okf/decisions/harness-guards.md`.

## History

- 2026-11-09: created as an idea
- 2026-11-09: status accepted
- 2026-11-09: status implemented
