---
type: Overview
title: ai1 overview
description: What ai1 is, the four pieces of a harness, and what exists today.
tags: [overview, harness]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:15:28Z'
---

# What it is

`ai1` (*all in one*, called `jig` until v0.12.0) is one harness for coding agents (Claude Code
first) instead of loose skills and hooks: guardrails that hold even when the agent
forgets a rule, a verification gate before the agent calls work done, and project memory that lives
in the repo. Everything it writes in a repo lives under `.ai1/` (config, `okf/` bundle, `rfc/`,
git-ignored `work/`); see [plugin layout](architecture/plugin-layout.md).

# The four pieces

| Piece | What | Lives in |
|---|---|---|
| Memory | Project knowledge, as an OKF bundle (`.ai1/okf/`) | The repo |
| Hands | Tools (CLIs, MCP servers) with a connection test | The repo |
| Trade | Skills: method (generic) and domain (project) | Method in ai1, domain in the repo |
| Reflexes | Hooks that enforce rules | ai1 |

The frame is generic; each repo describes itself in `.ai1/config.json`
(see [contract](architecture/harness-contract.md)).

# Status

v0.2.0 (2026-10-31): per-repo [features](architecture/features.md) chosen with
[/ai1:core-setup-repo](features/init.md); the [okf feature](features/okf.md) (index, upkeep, OKF toolkit from
the [OKF pack](packs/okf-pack.md)) and the [danger guard](guards/danger.md), both on by default.
Verified in real Claude Code sessions. Next steps in the [roadmap](roadmap.md).

# Code map

- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: see [plugin layout](architecture/plugin-layout.md).
- `bin/ai1-hook.mjs`, `src/`: hook runtime and modules; `src/okf/`: okf feature.
- `bin/ai1`, `src/cli/`, `skills/core-setup-repo/`: setup CLI and `/ai1:core-setup-repo`.
- `packs/okf/`: vendored OKF toolkit (git subtree).
- `schema/ai1.schema.json`, `templates/config.json`: the per-repo contract.
- `test/`: `npm test` (node:test, no dependencies).
- [PROJECT.md](https://github.com/Edvantage26/ai1/blob/main/PROJECT.md): full spec.
