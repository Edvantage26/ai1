---
rfc: 2
title: "ai1 doctor: audit a repo against its features"
size: idea
status: draft
created: 2026-11-08
updated: 2026-11-08
---

# RFC 0002: ai1 doctor: audit a repo against its features

## Problem

Whether a repo really runs ai1 as configured is only visible when something goes wrong: a stale
plugin version that does not know a feature (it happened in this repo on 2026-11-08: plugin 0.5.0
with `lanes` enabled), a bundle that fails validation, `verify` commands that no longer exist, an
RFC folder out of sync. Each module checks its own corner at its own event; nothing gives the whole
picture on demand.

## Idea

A `ai1 doctor` CLI command that runs deterministic checks and prints one line per finding with how
to fix it, exit 1 when something is wrong:

- installed plugin version vs. the features and modules `.ai1/config.json` names;
- `.ai1/config.json` valid against the schema; `.claude/settings.json` enables ai1;
- the OKF bundle validates; `ai1 rfc check` passes;
- each `verify` command resolves (binary on the PATH, script in package.json);
- leftovers: unfinished deep plans older than N days.

A later `ai1 doctor --session` would diagnose a session transcript (which hooks fired, blocks,
loops), as suggested in the [prior art](../okf/decisions/prior-art.md).

Alternatives seen so far: keep the checks spread in `ai1 status`; do nothing.

## Why it matters

The contract is frozen after three repos run ai1 ([roadmap](../okf/roadmap.md)); doctor is how
those repos are checked without reading every file by hand.

## Open questions

- Can the CLI know the installed plugin version from outside Claude Code reliably?
- Should `/ai1:core-setup-repo` run doctor at the end?

## How to resume

- Existing pieces to reuse: `ai1 status` (`src/cli/setup-repo.mjs`), the OKF validator, `ai1 rfc check`.

## Outcome

<!-- Filled in when it is decided. -->

## History

- 2026-11-08: created as an idea, from roadmap phase 5
