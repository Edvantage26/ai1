---
name: later-write
description: Later — Note down for later large changes and future features that are NOT decided yet, in .ai1/later/ (one file each, called by its number, "later 0003"), with honest options, criteria, assumptions, phases and how to resume them; when one is accepted or rejected, carry its decisions to the knowledge bundle. Use when the person asks to note something down for later ("apúntalo para luego", "anótalo para más adelante", "déjalo para luego", "apárcalo", "note it down for later", "park it"), picks "for later" in your one-line offer (here, fork or later) for a different subject, or names an existing entry by its number to update, accept, reject or resume it ("acepta la 0003", "retoma later 0005"). NOT when the person says "propuesta", "proposal", "proponme algo", "hazme una propuesta" or "acepto la propuesta": that is your own proposal in the conversation, to answer or build. Never note one down on your own. Not for recording facts or decisions already taken (that is /ai1:okf-maintain-knowledge) nor for planning how to build something already accepted (that is a plan or /ai1:lanes-design-before-code).
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Later: changes that are not the system yet

## First: is this skill the right one?

"Propuesta", "proposal", "proponme algo", "hazme una propuesta", "acepto la propuesta", "me parece
bien la propuesta" mean **your own proposal in this conversation** (a plan, an approach, a name you
suggested): answer it, or build it by its lane. They never mean this skill. If the person did not ask
to note something down for later, did not pick "for later" in your offer, and did not name an
existing entry by its number, stop here and go back to the task.

## Only on request or acceptance

Never note one down on your own initiative. Do it when the person asks for it ("apúntalo para luego",
"déjalo para más adelante", "apárcalo").

Offer it only in this situation: the conversation is about one subject and a clearly different one
comes up (a large new feature unrelated to the task at hand). Then mention it in one line at the end
of your report with the way you recommend, without stopping to ask ("Otro tema: X. Recomiendo
apuntarlo para luego." / "Different subject: X. I recommend noting it down for later."):

- **here**: it is done in this conversation (after the current task, unless the person says now);
- **fork**: a new conversation takes it, with /ai1:session-fork-conversation (brief mode, usually,
  so it starts with only the context it needs);
- **later**: it is noted down with this skill.

A yes means the way you recommended; if there is no answer, carry on with the current task and drop
it. A small fix found on the way is done here without asking. Do not offer for details, steps, follow-ups or improvements of the subject being worked on: those
belong to the current task. Updating, accepting or rejecting an existing entry follows the person's
request too, and only for an entry they name (by number or title).


When it is created, confirm in one line: "Apuntado para luego como later 0007: «<title>»."

## What a later entry is

A later entry is something that is not the system and may never be. It exists to think through and
decide a large change calmly, and so that months later someone (a person or a new conversation)
understands what was noted down, why, what was decided, what was not, and how to go on.

It lives in `.ai1/later/`, versioned. **It is not knowledge of the system**: that is the knowledge
bundle, which is trusted because it is verified. The boundary matters: a design written in the bundle
as if it were real will be taken as true. So an entry stays in `.ai1/later/` while it is undecided, and
only what is decided or built moves to the bundle.

## Files and commands

- **One entry = one file** `.ai1/later/NNNN-<slug>.md`, called by its number ("later 0003"). The
  frontmatter (`number`, `title`, `size`, `status`, `created`, `updated`, then `decided` and
  `superseded_by`) is what ai1 reads.
- **Never number, rename or index by hand.** The `ai1` CLI (on the Bash PATH) does it:

  ```bash
  ai1 later new <slug> [--idea] [--title "<what would change>"]   # next free number, from the template
  ai1 later set <number> <status> [--by <number>]                 # status, dates, History line, index
  ai1 later index                                                 # regenerate .ai1/later/README.md
  ai1 later check                                                 # what is inconsistent, exit 1 if anything
  ```

- **Two sizes.** `--idea` gives one page (problem, idea, why it matters, open questions, how to
  resume): the right size for most future features. Without it you get the full template. An idea
  grows into a full entry with the same number: set `size: full` and add the missing sections from
  [templates/full.md](templates/full.md).
- **Long design apart:** detail that does not fit (sizing, tables, diagrams, configuration examples)
  goes to `.ai1/later/NNNN-<slug>/` and the entry links it. It must be readable alone in 10 minutes.
- The slug is short, lowercase, dashes (`prod-guard`), in the language of the repo's docs.

## Statuses

| Status | Means | On entering it |
|---|---|---|
| `draft` | being written or thought about | nothing else |
| `review` | ready for the people who decide | note in the entry who it was sent to and the deadline, if any |
| `accepted` | it was decided to do it (fully or in part) | fill in Outcome and **carry the decisions to the bundle** (below) |
| `rejected` | it was decided not to do it | fill in Outcome with the why; if the reason is useful later, record it in the bundle too |
| `superseded` | another entry replaces it | `ai1 later set <n> superseded --by <m>`; mention it in the new one |
| `implemented` | it is reality now | check the new mechanisms are documented in the bundle like any code change |

An entry is never deleted: the history of why something was decided (or not) is the valuable part.
Only the person (or whoever decides) moves an entry to `accepted` or `rejected`; you recommend.

## Writing one

1. **Gather context before asking.** The conversation usually carries it. Otherwise search the
   knowledge bundle, the code and the history. Ask the person only what cannot be found out (who
   pushes it, who decides, deadline), one question at a time, with options when they help.
2. **Create the file** with `ai1 later new`, then read the template comments: they say what goes in
   each section and why. Replace every comment; a section that does not apply gets one line saying why.
3. **Criteria before options** (full entries). Write what the decision will be based on, and how much
   each thing weighs, before presenting options. Written afterwards, they look chosen to justify the
   favourite.
4. **Honest options, always including "do nothing".** At least two real options plus the current
   state, each with its real drawbacks. An entry that only sells one idea is useless for deciding.
5. **Evidence linked, not copied.** Facts about the current system link to the bundle concept that
   holds them, so they are corrected in one place. Every measured figure has its date and source;
   estimates are marked as estimates.
6. **Explicit assumptions**, with confidence and what would invalidate them. They are what gets
   forgotten, and what explains, months later, why a decision stopped working.
7. **How to resume:** for every dated fact, the command, query or concept that redoes it. Figures go
   stale; whoever resumes the entry must refresh them without repeating the research.
8. **Tell the person** what you created, in one line ("Apuntado para luego como later 0007: «...»").
   `ai1 later new` already updated the index.

When naming anything in the system, say what it is and its name first, ids in parentheses.

## When it is accepted or rejected: carry it to the bundle

This is where the entry stops being only noted down. With /ai1:okf-maintain-knowledge (produce or maintain mode):

1. `ai1 later set <n> accepted` (or `rejected`), then fill in the **Outcome** section.
2. **One durable decision = one concept** of `type: Decision` in the bundle's decisions folder: the
   decision, the why, the discarded alternatives and the consequences, briefly. In `sources`, the entry
   (`resource: .ai1/later/NNNN-<slug>.md`). If a concept on the same subject exists, update it instead.
   `ai1 later check` (and the hook at stop) reports an accepted entry that no concept cites.
3. **Rejected ones too**, when the reason saves discussing it again.
4. **Link back:** list in Outcome the concepts that came out of it.
5. Add the work to the project's roadmap if it has one. Building it is a separate task: with the
   lanes feature, a deep plan whose frontmatter says `later: <number>`; when that plan is done, ai1
   reminds you to `ai1 later set <n> implemented`.
6. Validate the bundle with /ai1:okf-validate-bundle.

While an entry is a draft or in review, the bundle gets at most **one short concept** with
`status: draft` that summarises and links it, so a future conversation finds it when searching the
subject. Nothing of the design.

## What this skill does not do

- No commit or push: the files stay for the person to review and commit.
- No publishing to external services unless the person asks.
- No deciding for the person.
- No replacing /ai1:okf-maintain-knowledge (facts and decisions already taken) or a plan (how to build what was accepted).

## Fixed rules

- Never note one down on your own initiative; "propuesta" in the conversation is never a request for this skill.
- Never number, rename or index entries by hand: `ai1 later` does it.
- Only the person accepts or rejects; an undecided design never goes into the knowledge bundle as if it were real.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context later-write` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context later-write`
