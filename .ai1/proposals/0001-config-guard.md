---
proposal: 1
title: Guard the harness configuration from the agent
size: idea
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Proposal 0001: Guard the harness configuration from the agent

## Problem

The agent can switch its own guardrails off. Checked in the code on 2026-11-09 (see the
[prior art](../okf/decisions/prior-art.md) code-check table):
- `danger` reads `ignore_rules` from `.ai1/config.json` (`src/guards/danger.mjs:5`), a file the agent can edit;
- nothing guards `.ai1/config.json`, `.claude/settings.json`, `.claude/settings.local.json` or the plugin's `hooks/`;
- `verify-gate` ignores `.claude/**` and `.ai1/**` on purpose (harness config is not project code), so such an edit does not even reach the gate.

Hooks are guardrails, not walls (Trail of Bits), but this is the cheapest way round all of them.

## Idea

A PreToolUse module (in `src/guards/`) that asks the person before any Edit/Write/MultiEdit, or any
shell write found by `listShellWriteTargets` (`src/core/shell-writes.mjs`), whose target is harness
configuration: `.ai1/config.json`, `.claude/settings*.json`, `hooks/`. `ask`, not `deny`: the
setup assistant and the person change these files legitimately. Plain `rm` of those files counts
too (today `danger` only catches `rm -r`).

Alternatives: do nothing (rely on the person reading diffs); a `deny` with an escape hatch; Claude
Code permission `deny` rules for those paths written by the setup (covers Edit/Write, and Bash only
under `/sandbox`).

Prior art: `config-guard` in [karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks) (MIT).

## Why it matters

Every other guard assumes its config is trustworthy. Small (one module, reuses the shell parser). Not urgent: no incident seen yet.

## Open questions

- Should `/ai1:core-setup-repo` and `ai1 init` pass without a prompt (they already ask the person), and how does the hook recognise them?
- Inline scripts (`python3 - <<EOF`) may write anywhere: ask on every one in the repo, or ignore?
- A feature of its own, or part of `danger` (on by default)?

## How to resume

Survey and code check: `.ai1/okf/decisions/prior-art.md` ("Skills and hook packs survey" and "Harness and memory projects", 2026-11-09). Re-check with `grep -rn "ai1/config.json\|settings" src/guards src/lanes src/verify`.

## Outcome

Accepted and built on 2026-11-09 (v0.21.0), at the person's request ("adelante con todo"): module `config-guard` in feature `danger`, `ask` on Edit/Write/shell writes, removals and moves of `.ai1/config.json`, `.claude/settings*.json` and `.claude/hooks/`, matched by path ending (other worktrees included). Concepts: `.ai1/okf/guards/config-guard.md`, `.ai1/okf/decisions/harness-guards.md`.

## History

- 2026-11-09: created as an idea
- 2026-11-09: status accepted
- 2026-11-09: status implemented
