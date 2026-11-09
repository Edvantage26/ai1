---
type: Component
title: proposals feature
description: Proposals - large changes and future features not decided yet - in .ai1/proposals/, apart from the bundle; created only on request or after the person accepts an offer; brief, recall and a Stop check that accepted ones are carried to the bundle; /ai1:proposals-write and ai1 proposals.
tags: [proposals, roadmap, hooks, cli, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T07:43:47Z'
sources:
  - id: proposals-documents
    resource: src/proposals/proposals-documents.mjs
    title: Files, statuses, checks, index
  - id: proposals-brief
    resource: src/proposals/proposals-brief.mjs
    title: SessionStart recipe, creation rule and open proposals
  - id: proposals-recall
    resource: src/proposals/proposals-recall.mjs
    title: UserPromptSubmit recall
  - id: proposals-upkeep
    resource: src/proposals/proposals-upkeep.mjs
    title: Stop check
  - id: proposals-command
    resource: src/cli/proposals-command.mjs
    title: ai1 proposals
  - id: proposals-skill
    resource: skills/proposals-write/SKILL.md
    title: /ai1:proposals-write procedure and templates
---

# Why

Future features had nowhere to live: the [roadmap](/roadmap.md) is a list of lines, deep-lane plans
(`.ai1/work/`, see [lanes](lanes.md)) are git-ignored and describe *how* to build something already
chosen, and writing a proposed design into the bundle makes it look real. Taken on 2026-11-08 from an
RFC skill written for another project, made generic and backed by mechanisms: numbering, statuses and
the index are done by the CLI, not by the agent. Opt-in (`features.proposals`, default off); on in
this repo.

One name for the feature, the folder, the modules, the skill and the command. Until v0.17 that name
was `rfc`; renamed to **proposals** on 2026-11-09 (v0.18.0, decided by the person): "RFC" is IETF
jargon and collides with real uses ("RFC 3339"), "proposal" says what it is. Rejected names: `ideas`
(there are full proposals too), `drafts` (clashes with the `draft` status), `decisions`/ADR (those
are decided), `plans` (clashes with `.ai1/work/` plans), `backlog` (sounds like a work queue). The
CLI is plural too (`ai1 proposals`), so the agent never guesses the form.

The lifecycle it fills:

| Stage | Where |
|---|---|
| Idea or proposal, not decided | `.ai1/proposals/NNNN-<slug>.md` (versioned) |
| Decided | `type: Decision` concepts in the bundle citing the proposal in `sources`, plus the roadmap |
| Being built | a deep-lane plan with `proposal: <number>` in its frontmatter |
| Built | the feature's concept in the bundle; proposal `implemented` |

# Creation: only on request or acceptance

The agent never creates a proposal on its own initiative: it creates one when the person asks for
it. When, while working on one subject, a clearly different one comes up (a new feature or change
unrelated to the task at hand), it offers in one line three ways and the person picks: do it here, in
this conversation; fork it into a new one ([session fork](session-fork.md)); or save it as a proposal
("Esto es otro tema: ¿lo hacemos aquí, lo abro en un fork o lo guardo como propuesta?"). Never for
details, steps or follow-ups of the current subject (decided by the person on 2026-11-09; the three
ways the same day, replacing a proposal-only offer). Said in the brief and in the skill; the offer
lives in the proposals feature, so with it off the agent does not make it.
`ai1 proposals new` also asks the person through the [danger guard](../guards/danger.md) (rule
`ai1-proposals-new`, an `ask` in the permission prompt), so a proposal is never created on the agent's
reading of an answer. Decided by the person on 2026-11-09, replacing the earlier "text only, no hook"
decision of the same day: an agent read an "ok, go ahead" to a question that bundled a code change and
a proposal as a yes to both. Only creation asks; `set`, `index` and `check` do not. Writing a proposal
file with Write/Edit is not gated (the skill forbids numbering by hand).

# Files

- Frontmatter: `proposal` (the number), `title`, `size` (`idea` = one page; `full` = criteria before
  options, "do nothing" always an option, assumptions, phases, risks, pending decisions, how to
  resume), `status` (`draft`, `review`, `accepted`, `rejected`, `superseded`, `implemented`),
  `created`, `updated`, `decided` (required once decided), `superseded_by`.
- `.ai1/proposals/README.md`: the table between `proposals-index` markers is generated; text around it is kept.
- Templates in `skills/proposals-write/templates/` (`idea.md`, `full.md`); titles with `: ` are quoted.
- Proposals are never deleted.

# CLI

`ai1 proposals new <slug> [--idea] [--title ...]` (next free number), `ai1 proposals set <n> <status>
[--by <n>]` (status, `updated`, `decided`, History line, index), `ai1 proposals index`,
`ai1 proposals check` (exit 1 on any problem). Options may come before or after the positionals.

# Modules (feature `proposals`)

| Module | Event | What it does |
|---|---|---|
| `proposals-brief` | SessionStart | Where proposals live, that a proposal is not the system, the creation rule, when to load `/ai1:proposals-write`, and the open proposals (draft, review, accepted; at most 15). Skipped on `resume`. |
| `proposals-recall` | UserPromptSubmit | Ranks proposals against the message with the [okf-recall](okf.md) keyword scoring (`buildKeywordCatalog`) and lists the hits with their status. |
| `proposals-upkeep` | Stop | Only when the session changed `.ai1/proposals/`: runs the `ai1 proposals check` rules (frontmatter, duplicate or mismatched numbers, sizes, statuses, dates, `decided`, `superseded_by`, index in sync and, with okf on, an accepted or implemented proposal that no bundle file cites). Also, when a deep plan with `proposal: <n>` was marked done in the session and proposal n is still accepted, asks to mark it implemented. Same problems reported once, at most 3 blocks per session (`claimStopBlock`). |

Effects on other features when `proposals` is on: [okf-upkeep](okf.md) ignores changes under
`.ai1/proposals/` (a draft must not be written into the bundle; acceptance is handled by
`proposals-upkeep`), and [lanes-gate](lanes.md) lets proposals be written while a design waits for
approval. [verify](verify.md) already ignores `*.md`.

# Repos set up with the old name

No aliases (decided 2026-11-09: v0.x, and this repo was the only one with the feature on). A config
with `features.rfc` or `modules.rfc-*`, or a repo with `.ai1/rfc/`, gets one notice at session start
and the old names are ignored (never an error; the guards keep working); the schema keeps them as
`deprecated`. `ai1 init --features rfc` is refused with the new name. `ai1 init` migrates
(`src/core/legacy-layout.mjs` plans, `src/cli/legacy-migration.mjs` moves): `git mv .ai1/rfc
.ai1/proposals`; in the moved files the field `rfc:` -> `proposal:`, the `rfc-index` markers, the
`# RFCs` heading and the index text; in the moved files and the bundle the paths, the skill and CLI
names, and `RFC NNNN` -> `Proposal NNNN` only for numbers of moved proposals (never "RFC 3339"); plans
`rfc:` -> `proposal:`; config ids renamed (the new name wins when both are set). The bundle's
`log.md` is left untouched: it is history. A jig repo with `docs/rfc/` goes straight to
`.ai1/proposals/`. Refuses if `.ai1/proposals/` exists.

# Limits

- The folder is fixed (`.ai1/proposals/`).
- The citation check is a substring match of `.ai1/proposals/NNNN-` anywhere in the bundle, not a
  parse of `sources`.
- Growing an idea into a full proposal is manual (set `size: full`, copy the missing sections).
- Whether the Outcome section is really filled in is not checked; only the `decided` date is.
- The creation rule is text: nothing stops the agent from running `ai1 proposals new` unasked.

# Verified

- `npm test` (2026-11-09): 15 tests for proposals (numbering, templates, slug and title rules,
  statuses and History, every check, index preserving hand-written text, brief with the creation
  rule, recall, upkeep blocks and the plan reminder, okf-upkeep exclusion, lanes-gate, CLI end to end
  with options in any order), plus the retired-name notice and renaming (config tests), the init
  refusal of `rfc` (setup tests) and the migration (legacy-migration tests: move, names, bundle,
  plans, config, log untouched, refusal).
- This repo migrated with the new `ai1 init` on 2026-11-09: proposals 0001-0003 moved with `git mv`,
  config renamed, `ai1 proposals check` clean. The same day the person removed all of them (the
  roadmap keeps the items, without proposals); git history keeps the files.
