---
type: Component
title: OKF toolkit (owned by ai1)
description: The OKF skills, agents and scripts, imported from okf-skills and maintained in ai1 itself; where they live and how they run.
tags: [okf, toolkit, third-party]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:32:23Z'
sources:
  - id: upstream
    resource: https://github.com/scaccogatto/okf-skills
    title: scaccogatto/okf-skills by Marco Boffo (MIT), the origin
---

The OKF toolkit came from `scaccogatto/okf-skills` (MIT) through the Edvantage fork
`Edvantage26/okf-skills`, vendored as a git subtree in `packs/okf/` until v0.12.0. On 2026-11-08 it
was imported into ai1 and the fork retired: Claude Code names plugin skills by their folder, so the
module-prefixed names needed folders ai1 owns, and keeping a fork in sync was not worth it.
Attribution in `THIRD-PARTY.md` and `licenses/`.

- **Where:** `skills/okf-maintain-knowledge/` (with `scripts/okf_init.py`, the spec in `reference/`,
  templates), `skills/okf-validate-bundle/`, `skills/okf-visualize-bundle/`,
  `skills/okf-backfill-from-history/`, `agents/bundle-weaver.md`, `agents/event-analyzer.md`.
  Claude Code discovers `skills/` and `agents/` by default; `plugin.json` lists neither.
- **Paths:** the skills default to `.okf/` but follow the bundle path the ai1 brief names
  (`.ai1/okf/`); one skill reaches another's script with `${CLAUDE_SKILL_DIR}/../okf-validate-bundle/`.
- **Runtime:** system `python3` (3.9+); PyYAML 6.0.3 vendored in `vendor/yaml/`, which the scripts
  find at the repo root (`parents[3]` of the script). No `uv`, `pip` or network.
- **Tests:** `test/okf-toolkit/` (validator and backfill events, with fixtures) runs inside
  `npm test` with `python3 -S`, so only the vendored PyYAML is used.
- **Left out on import:** upstream benchmarks, docs site, examples, MCP server, GitHub Action, its
  dormant Stop hook, CI and its own bundle. Upstream changes are no longer pulled; port by hand if needed.
