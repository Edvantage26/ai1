---
type: Component
title: OKF toolkit (owned by ai1)
description: The OKF skills, agents and scripts, imported from okf-skills and maintained in ai1 itself; where they live and how they run.
tags: [okf, toolkit, third-party]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-14T09:01:31Z'
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
  (always `.ai1/okf/`); one skill reaches another's script with `${CLAUDE_SKILL_DIR}/../okf-validate-bundle/`.
- **Runtime:** system Python 3.9+ (`python3`; the validator gate also tries `python` and `py -3`); PyYAML 6.0.3 vendored in `vendor/yaml/`, which the scripts
  find at the repo root (`parents[3]` of the script). No `uv`, `pip` or network.
- **Tests:** `test/okf-toolkit/` (validator and backfill events, with fixtures) runs inside
  `npm test` with `python3 -S`, so only the vendored PyYAML is used.
- **Usage (measured 2026-11-13 on the maintainer's machine):** the validator is the only heavily used
  piece (~1,050 runs in ~100 sessions, plus the hook and `worktree finish` runs, which transcripts do
  not show); `--migrate` and `okf_init.py` a handful of times; `okf_visualize.py` once; the backfill
  script and its two agents never ran (every hit was moving or adapting their code). The backfill
  script does not import PyYAML (only `git log` and transcript JSON), so `vendor/yaml` is needed only
  by the validator, init and visualize. Context for porting the toolkit to Node.
- **Backfill cost upstream:** upstream's own map-tier benchmark (its `benchmark/map-tier/RESULTS.md`,
  2026-09-05) replayed its repo, 147 events, for an estimated 30 to 46 USD and about 2 hours
  per full replay (436 agents for four arms); the reduce phase (the weaver) costs about as much as
  the map phase whatever the analyzer tier. Upstream has had no release since v0.12.0 (2026-10-21).
- **Measuring usage:** scan `~/.claude/projects/**/*.jsonl` for `tool_use` entries (`Bash` commands
  that run a `python3 ... okf_*.py` script, `Skill`, `Agent`) grouped by project; a plain grep
  overcounts, because skill listings and edits of the scripts mention the names too.
- **Left out on import:** upstream benchmarks, docs site, examples, MCP server, GitHub Action, its
  dormant Stop hook, CI and its own bundle. Upstream changes are no longer pulled; port by hand if needed.
