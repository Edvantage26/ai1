---
type: Component
title: rfc feature
description: RFCs - proposals for large changes and future features not decided yet - in docs/rfc/, apart from the bundle; brief, recall and a Stop check that accepted ones are carried to the bundle; /jig:rfc and jig rfc.
tags: [rfc, proposals, roadmap, hooks, cli, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T18:23:08Z'
sources:
  - id: rfc-documents
    resource: src/rfc/rfc-documents.mjs
    title: Files, statuses, checks, index
  - id: rfc-brief
    resource: src/rfc/rfc-brief.mjs
    title: SessionStart recipe and open RFCs
  - id: rfc-recall
    resource: src/rfc/rfc-recall.mjs
    title: UserPromptSubmit recall
  - id: rfc-upkeep
    resource: src/rfc/rfc-upkeep.mjs
    title: Stop check
  - id: rfc-command
    resource: src/cli/rfc-command.mjs
    title: jig rfc
  - id: rfc-skill
    resource: skills/rfc/SKILL.md
    title: /jig:rfc procedure and templates
---

# Why

Future features had nowhere to live: the [roadmap](/roadmap.md) is a list of lines, deep-lane plans
(`.jig/work/`, see [lanes](lanes.md)) are git-ignored and describe *how* to build something already
chosen, and writing a proposed design into the bundle makes it look real. Taken on 2026-11-08 from an
RFC skill written for another project, made generic (English, no project names) and backed by
mechanisms: numbering, statuses and the index are done by the CLI, not by the agent. One name, `rfc`,
for the feature, the skill, the folder and the command. Opt-in (`features.rfc`, default off); on in
this repo.

The lifecycle it fills:

| Stage | Where |
|---|---|
| Idea or proposal, not decided | `docs/rfc/NNNN-<slug>.md` (versioned) |
| Decided | `type: Decision` concepts in the bundle citing the RFC in `sources`, plus the roadmap |
| Being built | a deep-lane plan with `rfc: <number>` in its frontmatter |
| Built | the feature's concept in the bundle; RFC `implemented` |

# Files

- Frontmatter: `rfc`, `title`, `size` (`idea` = one page; `full` = criteria before options, "do
  nothing" always an option, assumptions, phases, risks, pending decisions, how to resume), `status`
  (`draft`, `review`, `accepted`, `rejected`, `superseded`, `implemented`), `created`, `updated`,
  `decided` (required once decided), `superseded_by`.
- `docs/rfc/README.md`: the table between `rfc-index` markers is generated; text around it is kept.
- Templates in `skills/rfc/templates/` (`idea.md`, `full.md`); titles with `: ` are quoted.
- RFCs are never deleted.

# CLI

`jig rfc new <slug> [--idea] [--title ...]` (next free number), `jig rfc set <n> <status> [--by <n>]`
(status, `updated`, `decided`, History line, index), `jig rfc index`, `jig rfc check` (exit 1 on any
problem).

# Modules (feature `rfc`)

| Module | Event | What it does |
|---|---|---|
| `rfc-brief` | SessionStart | Where RFCs live, that a proposal is not the system, when to load `/jig:rfc`, and the open RFCs (draft, review, accepted; at most 15). Skipped on `resume`. |
| `rfc-recall` | UserPromptSubmit | Ranks RFCs against the message with the [okf-recall](okf.md) keyword scoring (`buildKeywordCatalog`) and lists the hits with their status. |
| `rfc-upkeep` | Stop | Only when the session changed `docs/rfc/`: runs the `jig rfc check` rules (frontmatter, duplicate or mismatched numbers, sizes, statuses, dates, `decided`, `superseded_by`, index in sync and, with okf on, an accepted or implemented RFC that no bundle file cites). Also, when a deep plan with `rfc: <n>` was marked done in the session and RFC n is still accepted, asks to mark it implemented. Same problems reported once, at most 3 blocks per session. |

Effects on other features when `rfc` is on: [okf-upkeep](okf.md) ignores changes under `docs/rfc/`
(a draft must not be written into the bundle; acceptance is handled by `rfc-upkeep`), and
[lanes-gate](lanes.md) lets RFCs be written while a design waits for approval. [verify](verify.md)
already ignores `*.md`.

# Limits

- The folder is fixed (`docs/rfc/`); no `jig.json` field until a repo needs another one.
- The citation check is a substring match of `docs/rfc/NNNN-` anywhere in the bundle, not a parse of
  `sources`.
- Growing an idea into a full RFC is manual (set `size: full`, copy the missing sections).
- Whether the Outcome section is really filled in is not checked; only the `decided` date is.

# Verified

- `npm test` (2026-11-08): 14 tests for rfc (numbering, templates, slug and title rules, statuses
  and History, every check, index preserving hand-written text, brief, recall, upkeep blocks and the
  plan reminder, okf-upkeep exclusion through the hook, lanes-gate, CLI end to end). Mutation check:
  removing the okf-upkeep exclusion makes its test fail.
- Used on this repo: RFCs 0001-0003 created with `jig rfc new` for roadmap phases 3, 5 and 6;
  `jig rfc check` clean.
- Not yet tried in a live Claude Code session.
