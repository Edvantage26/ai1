---
type: Component
title: later feature
description: Later - large changes and future features not decided yet, noted down for later in .ai1/later/ (one file each, called by its number, "later 0003"), apart from the bundle; created only on request or when the person picks it in an offer; brief, recall and a Stop check that accepted ones are carried to the bundle; /ai1:later-write and ai1 later. Called rfc until v0.17 and proposals until v0.24.
tags: [later, proposals, roadmap, hooks, cli, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T07:38:33Z'
sources:
  - id: later-documents
    resource: src/later/later-documents.mjs
    title: Files, statuses, checks, index
  - id: later-brief
    resource: src/later/later-brief.mjs
    title: SessionStart recipe, creation rule, the "propuesta" rule and open entries
  - id: later-recall
    resource: src/later/later-recall.mjs
    title: UserPromptSubmit recall
  - id: later-upkeep
    resource: src/later/later-upkeep.mjs
    title: Stop check
  - id: later-command
    resource: src/cli/later-command.mjs
    title: ai1 later
  - id: later-skill
    resource: skills/later-write/SKILL.md
    title: /ai1:later-write procedure and templates
---

# Why

Future features had nowhere to live: the [roadmap](/roadmap.md) is a list of lines, deep plans
(`.ai1/work/`, see [sizing](sizing.md)) are git-ignored and describe *how* to build something already
chosen, and writing an undecided design into the bundle makes it look real. Taken on 2026-11-08 from
an RFC skill written for another project, made generic and backed by mechanisms: numbering, statuses
and the index are done by the CLI, not by the agent. Opt-in (`features.later`, default off); on in
this repo.

# The name

One name for the feature, the folder, the modules, the skill and the command: **later**. Each file is
called by its number ("later 0003"); there is no noun for it in conversation, so no everyday word can
trigger it.

- `rfc` until v0.17: IETF jargon, collides with real uses ("RFC 3339").
- `proposals` from v0.18.0 to v0.24: renamed to **later** on 2026-11-09 (v0.25.0, decided by the
  person). "Propuesta" is what the agent and the person say all the time about the agent's own
  suggestions: "acepto la propuesta" or "hazme una propuesta" loaded `/ai1:proposals-write`, whose
  description listed "accept" as a trigger, and the agent wrote a proposal file instead of building or
  answering. A name that is a common word in the conversation will always collide.
- Rejected names: `ideas` (there are full entries too, `idea` is already a size, and "buena idea"
  collides), `future-ideas` (two words, same clash), `task` (sizing and Claude Code already use it for
  the work at hand, and it sounds decided), `pitch` (Shape Up's word, precise but an anglicism few
  people know), `parked`, `someday`, `shelf`, `horizon` (less clear), and from v0.18: `drafts`
  (clashes with the `draft` status), `decisions`/ADR (those are decided), `plans` (clashes with
  `.ai1/work/` plans), `backlog` (sounds like a work queue).

The brief and the skill say it outright: "propuesta", "proposal", "proponme algo", "acepto la
propuesta" mean the agent's own proposal in the conversation, never this feature; the skill starts by
checking that it was really asked for.

The lifecycle it fills:

| Stage | Where |
|---|---|
| Not decided, noted down for later | `.ai1/later/NNNN-<slug>.md` (versioned) |
| Decided | `type: Decision` concepts in the bundle citing the entry in `sources`, plus the roadmap |
| Being built | a deep plan with `later: <number>` in its frontmatter |
| Built | the feature's concept in the bundle; entry `implemented` |

# Creation: only on request or when picked

The agent never notes one down on its own initiative: it does when the person asks ("apúntalo para
luego", "déjalo para más adelante", "apárcalo"). When, while working on one subject, a clearly
different and large one comes up (a new feature unrelated to the task at hand), it mentions it in one
line at the end of its report with the way it recommends (do it here, fork it into a new one with
[session fork](session-fork.md), or note it down for later) and does not stop to ask; a yes means the
recommended way, and a small fix found on the way is done here. Until 2026-11-09 it asked "¿lo hacemos
aquí, lo abro en un fork o lo apunto para luego?" and waited: in the transcripts of that week it was
asked 69 times, so the person dropped it the same day. Never for
details, steps or follow-ups of the current subject (decided by the person on 2026-11-09; the three
ways the same day). Once created, the agent confirms in one line ("Apuntado para luego como later
0007: «...»"). Said in the brief and in the skill; the offer lives in this feature, so with it off the
agent does not make it. Accepting, rejecting or resuming one is done only for an entry the person names
(by number or title).
`ai1 later new` does not ask in the permission prompt: the `ai1-later-new` danger rule (added on
2026-11-09 after an agent read a bundled "ok" as a yes to a proposal) was removed the same day, since
noting something down loses nothing. Decided by the person on 2026-11-09: ai1 asks only for what is truly delicate (losing work or data for good, publishing, production, a deep design); the rest the agent does and reports. Writing an entry file with Write/Edit is not gated (the skill forbids
numbering by hand).

# Files

- Frontmatter: `number`, `title`, `size` (`idea` = one page; `full` = criteria before options, "do
  nothing" always an option, assumptions, phases, risks, pending decisions, how to resume), `status`
  (`draft`, `review`, `accepted`, `rejected`, `superseded`, `implemented`), `created`, `updated`,
  `decided` (required once decided), `superseded_by`. Heading `# Later NNNN: <title>`.
- `.ai1/later/README.md`: the table between `later-index` markers is generated; text around it is kept.
- Templates in `skills/later-write/templates/` (`idea.md`, `full.md`); titles with `: ` are quoted.
- Entries are never deleted.

# CLI

`ai1 later new <slug> [--idea] [--title ...]` (next free number), `ai1 later set <n> <status>
[--by <n>]` (status, `updated`, `decided`, History line, index), `ai1 later index`,
`ai1 later check` (exit 1 on any problem). Options may come before or after the positionals.

# Modules (feature `later`)

| Module | Event | What it does |
|---|---|---|
| `later-brief` | SessionStart | Where entries live, that they are not the system, that "propuesta" in the conversation is never this feature, the creation rule and the offer, when to load `/ai1:later-write`, and the open entries (draft, review, accepted; at most 15). Skipped on `resume`. |
| `later-recall` | UserPromptSubmit | Ranks entries against the message with the [okf-recall](okf.md) keyword scoring (`buildKeywordCatalog`) and lists the hits with their status. |
| `later-upkeep` | Stop | Only when the session changed `.ai1/later/`: runs the `ai1 later check` rules (frontmatter, duplicate or mismatched numbers, sizes, statuses, dates, `decided`, `superseded_by`, index in sync and, with okf on, an accepted or implemented entry that no bundle file cites). Also, when a deep plan with `later: <n>` was marked done in the session and entry n is still accepted, asks to mark it implemented. Same problems reported once, at most 3 blocks per session (`claimStopBlock`). |

Effects on other features when `later` is on: [okf-upkeep](okf.md) ignores changes under
`.ai1/later/` (a draft must not be written into the bundle; acceptance is handled by `later-upkeep`),
and [sizing-gate](sizing.md) lets entries be written while a design waits for approval.
[verify](verify.md) already ignores `*.md`.

# Repos set up with an old name

No aliases (v0.x). A config with `features.rfc`/`features.proposals` or `modules.rfc-*`/
`modules.proposals-*`, or a repo with `.ai1/rfc/` or `.ai1/proposals/`, gets one notice at session
start and the old names are ignored (never an error; the guards keep working); the schema keeps them
as `deprecated`. `ai1 init --features rfc` or `--features proposals` is refused with the new name.
`ai1 init` migrates (`src/core/legacy-layout.mjs` plans, `src/cli/legacy-migration.mjs` moves):
`git mv .ai1/rfc` or `.ai1/proposals` to `.ai1/later`; in the moved files the field `rfc:`/`proposal:`
-> `number:`, the `rfc-index`/`proposals-index` markers, the heading and the index text; in the moved
files and the bundle the paths, the skill and CLI names, and `RFC NNNN`/`Proposal NNNN`/`proposal
NNNN` -> `Later NNNN`/`later NNNN` only for numbers of moved entries (never "RFC 3339"); plans
`rfc:`/`proposal:` -> `later:`; config ids renamed (the new name wins when both are set). The bundle's
`log.md` is left untouched: it is history. A jig repo with `docs/rfc/` goes straight to
`.ai1/later/`. Refuses if `.ai1/later/` exists. Not migrated: a skill overlay in
`.ai1/skills/proposals/` or `~/.config/ai1/skills/proposals/` (the overlays shipped the same day as
the rename); move it to `.../skills/later/` by hand.

# Limits

- The folder is fixed (`.ai1/later/`).
- The citation check is a substring match of `.ai1/later/NNNN-` anywhere in the bundle, not a
  parse of `sources`.
- Growing an idea into a full entry is manual (set `size: full`, copy the missing sections).
- Whether the Outcome section is really filled in is not checked; only the `decided` date is.
- Whether the skill loads on "propuesta" is up to the model reading its description: the exclusion is
  text in the description, the brief and the skill's first section, not a hook.

# Verified

- `npm test` (2026-11-09, v0.25.0): 16 tests in `test/later.test.mjs` (numbering, templates, slug and
  title rules, statuses and History, every check, index preserving hand-written text, brief with the
  creation rule, the "propuesta" rule and the offer wording, recall, upkeep blocks and the plan
  reminder, okf-upkeep exclusion, sizing-gate, CLI end to end with options in any order, the skill
  description excluding "propuesta"), plus the retired-name notices and renaming for rfc and proposals
  (config tests), the init refusal of both (setup tests) and both migrations (legacy-migration tests:
  move, names, bundle, plans, config, log untouched, refusal).
- This repo migrated on 2026-11-09 with the v0.25.0 migration (`migrateLegacyLayout`): entries
  0001-0006 moved with `git mv` to `.ai1/later/`, fields, headings, index and bundle references
  rewritten, `ai1 later check` clean; `features.proposals` -> `features.later` by hand in
  `.ai1/config.json` to keep its formatting.
