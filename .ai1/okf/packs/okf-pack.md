---
type: Component
title: OKF toolkit (owned by ai1)
description: The OKF skills, imported from okf-skills and maintained in ai1 itself, and their Node commands (ai1 okf validate, init, visualize); where they live and how they run.
tags: [okf, toolkit, third-party]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-15T05:09:16Z'
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

- **Where:** `skills/okf-maintain-knowledge/` (the spec in `reference/`, templates),
  `skills/okf-validate-bundle/`, `skills/okf-visualize-bundle/`; their scripts are `ai1` subcommands:
  `ai1 okf validate` (`src/okf/okf-validate.mjs`, also run in-process by okf-upkeep and
  `ai1 worktree finish`), `ai1 okf init` (`okf-init.mjs`) and `ai1 okf visualize` (`okf-visualize.mjs`,
  page in `templates/okf-viz.html`). Claude Code discovers `skills/` by default.
- **Paths:** the skills default to `.okf/` but follow the bundle path the ai1 brief names
  (always `.ai1/okf/`); they call `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" okf ...`.
- **Runtime:** Node only, since 2026-11-15. YAML is read with js-yaml 4.1.0 vendored in
  `vendor/js-yaml/`, through `src/okf/okf-yaml.mjs`, which keeps PyYAML's reading where a bundle can
  notice it (YAML 1.1 booleans, a duplicate key keeps the last value) and keeps timestamps as text.
- **Port to Node (2026-11-15):** checked against the Python scripts on the 21 bundles of the
  maintainer's machine plus a corpus of odd cases: identical validation reports, byte-identical
  `--migrate`, the same graph data and page. Intended differences: dates are shown as written (Python
  printed its datetime, `2026-01-01 00:00:00+00:00`), and the Python crashed (whole run lost) on an
  unhashable `status` (`[a, b]`) and on an impossible unquoted date (`2026-02-30`), which Node
  reports or accepts as text. The backfill skill, its script and its two agents were removed instead
  of ported (never used, see below).
- **Tests:** `test/okf-validate.test.mjs` (the 61 cases of the Python suite, regrouped),
  `test/okf-init.test.mjs`, `test/okf-visualize.test.mjs`, all in `npm test`.
- **Usage (measured 2026-11-13 on the maintainer's machine):** the validator is the only heavily used
  piece (~1,050 runs in ~100 sessions, plus the hook and `worktree finish` runs, which transcripts do
  not show); `--migrate` and `okf_init.py` a handful of times; `okf_visualize.py` once; the backfill
  script and its two agents never ran (every hit was moving or adapting their code). The backfill
  script does not import PyYAML (only `git log` and transcript JSON), so `vendor/yaml` was needed only
  by the validator, init and visualize. That measurement decided the port above.
- **Backfill cost upstream:** upstream's own map-tier benchmark (its `benchmark/map-tier/RESULTS.md`,
  2026-09-05) replayed its repo, 147 events, for an estimated 30 to 46 USD and about 2 hours
  per full replay (436 agents for four arms); the reduce phase (the weaver) costs about as much as
  the map phase whatever the analyzer tier. Upstream has had no release since v0.12.0 (2026-10-21).
- **Measuring usage:** scan `~/.claude/projects/**/*.jsonl` for `tool_use` entries (`Bash` commands
  that run a toolkit command, `Skill`, `Agent`) grouped by project; a plain grep
  overcounts, because skill listings and edits of the scripts mention the names too.
- **Left out on import:** upstream benchmarks, docs site, examples, MCP server, GitHub Action, its
  dormant Stop hook, CI and its own bundle. Upstream changes are no longer pulled; port by hand if needed.
