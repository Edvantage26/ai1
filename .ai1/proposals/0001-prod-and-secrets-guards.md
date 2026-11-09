---
proposal: 1
title: Guards for production writes and committed secrets
size: idea
status: draft
created: 2026-11-08
updated: 2026-11-08
---

# Proposal 0001: Guards for production writes and committed secrets

## Problem

ai1 was born from a backend where "never write to prod" and "never commit a secret" were prompt rules,
and prompt rules get skipped or lost after compaction (see
[prior art](../okf/decisions/prior-art.md)). Today ai1 only has the `danger` guard
([danger](../okf/guards/danger.md)), which knows destructive commands but not *which resources are
production* in a given repo, and nothing looks at what is about to be committed.

## Idea

Two PreToolUse guards, each its own feature, driven by `.ai1/config.json`:

- **`prod`**: the repo declares what production is (MCP tool name patterns, shell patterns such as
  hostnames or connection strings, environment names). A matched write is refused (fail closed, the
  one exception to fail open in the [principles](../okf/decisions/principles.md)); reads pass.
- **`secrets`**: before `git commit` (and on Write/Edit), scan the staged or written content for
  well-known secret shapes (private keys, cloud keys, tokens) and refuse with the file and line.

Alternatives seen so far: leave both to external tools (gitleaks, pre-commit hooks) and only point to
them; ship only `secrets` (generic as is) and leave `prod` to private packs; do nothing.

## Why it matters

These are the two mistakes that cannot be undone by `git`. They are listed as "generic as is" and
"generic with config" in the [contract](../okf/architecture/harness-contract.md), so the contract is
not frozen until they exist.

## Open questions

- Schema for "what is production" that covers MCP tools and shell without becoming a regex zoo.
- Whether `secrets` should run its own scanner (zero dependencies) or call `gitleaks` when present.
- How to let the person consciously allow one write (ask instead of deny?) without the agent learning
  to route around it.

## How to resume

- Current guard behaviour: `src/guards/danger.mjs` and `npm test`.
- Planned position in the roadmap: [roadmap](../okf/roadmap.md), phase 3.

## Outcome

<!-- Filled in when it is decided. -->

## History

- 2026-11-08: created as an idea, from roadmap phase 3
