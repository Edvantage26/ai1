---
type: Configuration
title: .ai1/config.json contract
description: The per-repo file that makes generic hooks behave correctly in each project.
tags: [config, contract, hooks]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T13:24:58Z'
---

Each repo commits `.ai1/config.json` (template in `templates/config.json`).

| Field | Meaning |
|---|---|
| `version` | Contract version, currently `1` |
| `features.<id>` | `true`/`false` per [feature](features.md); omitted features use their default (`okf`, `danger`: on) |
| `trunk` | Protected branch name; default `main` |
| `verify` | Commands that must pass before the agent calls a change done |
| `modules.<id>` | `true`/`false` to force a module on/off, or an options object (with optional `enabled`) |
| `rules` | the repo's own guard rules, see [repo-rules](/guards/repo-rules.md); a bad rule is dropped with a notice, a non-list is invalid |

The OKF bundle is always `.ai1/okf/` (`KNOWLEDGE_BUNDLE_PATH` in `src/core/config.mjs`).

# Retired: `knowledge` (v0.16.0)

Until v0.15 the bundle path was configurable with `knowledge`. Decision (2026-11-09, by the
person): fix it, because every module read it its own way (some normalized `./` and trailing `/`,
some did not; `null` meant "default" for okf but "no bundle" for rfc, craft and lanes), it
contradicted "everything ai1 writes lives under `.ai1/`", and no repo used another value. Now:
`knowledge: ".ai1/okf"` is ignored silently; any other value (another path, `null`) is ignored with
a notice at session start, never an error, so the guards keep working; `ai1 init` moves that
bundle to `.ai1/okf/` with `git mv` (the same migration as the old `jig` layout) and removes the
setting; `--knowledge` is refused. The schema keeps the field as `deprecated`, so editors flag it
without an error on configs that still carry `.ai1/okf`.

# Retired: the `rfc` (v0.18.0) and `proposals` (v0.25.0) features and modules

`rfc` was renamed to `proposals` in v0.18.0, and `proposals` to `later` in v0.25.0 (see the
[later feature](/features/later.md)). Not aliased: `features.rfc`, `features.proposals`,
`modules.rfc-*`, `modules.proposals-*` and a `.ai1/rfc/` or `.ai1/proposals/` folder give one notice
at session start and are ignored; `ai1 init` renames them (`renameRetiredIds` in `src/core/config.mjs`, the folder move in the
legacy migration). The schema keeps them as `deprecated`.

Schema: `schema/ai1.schema.json` (for editors). Validation at runtime is hand-written in
`src/core/config.mjs`. Wrong types or an unsupported `version` make the file invalid and ai1
inactive. Fields, features or modules this ai1 version does not know (a repo set up with a newer
ai1) are only warnings since 2026-11-08: they are ignored, the agent is told at session start to
update the plugin, and every other module keeps working. Before, a repo enabling `lanes` switched
ai1 off entirely for anyone on an older plugin, guards included.

Three levels of genericity:

- **Generic as is**: destructive-command guard, no `--no-verify`, secret scan, verify-before-done.
- **Generic with config**: everything driven by the fields above.
- **Specific**: knowledge, domain skills and MCP servers stay in the repo, never in ai1.

The contract is still a draft; it is fixed once it works in three different repos
(see [roadmap](/roadmap.md)).
