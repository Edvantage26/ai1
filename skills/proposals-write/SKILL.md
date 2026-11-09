---
name: proposals-write
description: Proposals — Write and manage proposals - large changes and future features that are NOT decided yet - in .ai1/proposals/, with honest options, criteria, assumptions, phases and how to resume them; when one is accepted or rejected, carry its decisions to the knowledge bundle. Use when the person asks for a proposal ("escribe una propuesta", "guárdalo como propuesta", "apúntalo para más adelante", "write a proposal", "save this for later"), picks "proposal" in your one-line offer (here, fork or proposal) for a different subject, or asks to update, accept, reject or resume one. Never create a proposal on your own. Not for recording facts or decisions already taken (that is /ai1:okf-maintain-knowledge) nor for planning how to build something already accepted (that is a plan or /ai1:lanes-design-before-code).
allowed-tools: Bash(ai1 skill-context *)
---

# Proposals: changes that are not the system yet

## Only on request or acceptance

Never create a proposal on your own initiative. Create one when the person asks for it.

Offer one only in this situation: the conversation is about one subject and a clearly different one
comes up (a new feature or change unrelated to the task at hand). Then offer in one line three ways
and let the person choose ("Esto es otro tema: ¿lo hacemos aquí, lo abro en un fork o lo guardo como
propuesta?" / "This is a different subject: do it here, fork it, or save it as a proposal?"):

- **here**: it is done in this conversation (after the current task, unless the person says now);
- **fork**: a new conversation takes it, with /ai1:session-fork-conversation (brief mode, usually,
  so it starts with only the context it needs);
- **proposal**: it is saved for later with this skill.

Act only on the way the person picks; if there is no answer, carry on with the current task and drop it. Do not offer for details, steps, follow-ups or improvements of the
subject being worked on: those belong to the current task. Updating, accepting or rejecting an
existing proposal follows the person's request too.

A yes to a question that bundles several things is not a yes to the proposal: ask about it on its own.
`ai1 proposals new` also asks the person in the permission prompt (danger rule `ai1-proposals-new`);
if they refuse, do not create the file another way.

## What a proposal is

A proposal is something that is not the system and may never be. It exists to think
through and decide a large change calmly, and so that months later someone (a person or a new
conversation) understands what was proposed, why, what was decided, what was not, and how to go on.

It lives in `.ai1/proposals/`, versioned. **It is not knowledge of the system**: that is the knowledge
bundle, which is trusted because it is verified. The boundary matters: a proposed design written in
the bundle as if it were real will be taken as true. So a proposal stays in `.ai1/proposals/` while it is a
proposal, and only what is decided or built moves to the bundle.

## Files and commands

- **One proposal = one file** `.ai1/proposals/NNNN-<slug>.md`. The frontmatter (`proposal`, `title`, `size`,
  `status`, `created`, `updated`, later `decided` and `superseded_by`) is what ai1 reads.
- **Never number, rename or index by hand.** The `ai1` CLI (on the Bash PATH) does it:

  ```bash
  ai1 proposals new <slug> [--idea] [--title "<what is proposed>"]   # next free number, from the template
  ai1 proposals set <number> <status> [--by <number>]                # status, dates, History line, index
  ai1 proposals index                                                # regenerate .ai1/proposals/README.md
  ai1 proposals check                                                # what is inconsistent, exit 1 if anything
  ```

- **Two sizes.** `--idea` gives a one-page proposal (problem, idea, why it matters, open questions, how to
  resume): the right size for most future features. Without it you get the full template. An idea
  grows into a full proposal with the same number: set `size: full` and add the missing sections from
  [templates/full.md](templates/full.md).
- **Long design apart:** detail that does not fit (sizing, tables, diagrams, configuration examples)
  goes to `.ai1/proposals/NNNN-<slug>/` and the proposal links it. The proposal must be readable alone in 10 minutes.
- The slug is short, lowercase, dashes (`prod-guard`), in the language of the repo's docs.

## Statuses

| Status | Means | On entering it |
|---|---|---|
| `draft` | being written or thought about | nothing else |
| `review` | ready for the people who decide | note in the proposal who it was sent to and the deadline, if any |
| `accepted` | it was decided to do it (fully or in part) | fill in Outcome and **carry the decisions to the bundle** (below) |
| `rejected` | it was decided not to do it | fill in Outcome with the why; if the reason is useful later, record it in the bundle too |
| `superseded` | another proposal replaces it | `ai1 proposals set <n> superseded --by <m>`; mention it in the new one |
| `implemented` | it is reality now | check the new mechanisms are documented in the bundle like any code change |

A proposal is never deleted: the history of why something was decided (or not) is the valuable part.
Only the person (or whoever decides) moves a proposal to `accepted` or `rejected`; you recommend.

## Writing one

1. **Gather context before asking.** The conversation usually carries it. Otherwise search the
   knowledge bundle, the code and the history. Ask the person only what cannot be found out (who
   pushes it, who decides, deadline), one question at a time, with options when they help.
2. **Create the file** with `ai1 proposals new`, then read the template comments: they say what goes in
   each section and why. Replace every comment; a section that does not apply gets one line saying why.
3. **Criteria before options** (full proposals). Write what the decision will be based on, and how much
   each thing weighs, before presenting options. Written afterwards, they look chosen to justify the
   favourite.
4. **Honest options, always including "do nothing".** At least two real options plus the current
   state, each with its real drawbacks. A proposal that only sells one idea is useless for deciding.
5. **Evidence linked, not copied.** Facts about the current system link to the bundle concept that
   holds them, so they are corrected in one place. Every measured figure has its date and source;
   estimates are marked as estimates.
6. **Explicit assumptions**, with confidence and what would invalidate them. They are what gets
   forgotten, and what explains, months later, why a decision stopped working.
7. **How to resume:** for every dated fact, the command, query or concept that redoes it. Figures go
   stale; whoever resumes the proposal must refresh them without repeating the research.
8. **Tell the person** what you created, one line per file. `ai1 proposals new` already updated the index.

When naming anything in the system, say what it is and its name first, ids in parentheses.

## When it is accepted or rejected: carry it to the bundle

This is where the proposal stops being only a proposal. With /ai1:okf-maintain-knowledge (produce or maintain mode):

1. `ai1 proposals set <n> accepted` (or `rejected`), then fill in the **Outcome** section.
2. **One durable decision = one concept** of `type: Decision` in the bundle's decisions folder: the
   decision, the why, the discarded alternatives and the consequences, briefly. In `sources`, the proposal
   (`resource: .ai1/proposals/NNNN-<slug>.md`). If a concept on the same subject exists, update it instead.
   `ai1 proposals check` (and the hook at stop) reports an accepted proposal that no concept cites.
3. **Rejected ones too**, when the reason saves discussing it again.
4. **Link back:** list in Outcome the concepts that came out of it.
5. Add the work to the project's roadmap if it has one. Building it is a separate task: with the
   lanes feature, a deep plan whose frontmatter says `proposal: <number>`; when that plan is done, ai1
   reminds you to `ai1 proposals set <n> implemented`.
6. Validate the bundle with /ai1:okf-validate-bundle.

While a proposal is a draft or in review, the bundle gets at most **one short concept** with
`status: draft` that summarises and links it, so a future conversation finds it when searching the
subject. Nothing of the design.

## What this skill does not do

- No commit or push: the files stay for the person to review and commit.
- No publishing to external services unless the person asks.
- No deciding for the person.
- No replacing /ai1:okf-maintain-knowledge (facts and decisions already taken) or a plan (how to build what was accepted).

## Fixed rules

- Never create a proposal on your own initiative.
- Never number, rename or index proposals by hand: `ai1 proposals` does it.
- Only the person accepts or rejects; a proposed design never goes into the knowledge bundle as if it were real.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `ai1 skill-context proposals-write` and apply what it prints.

!`ai1 skill-context proposals-write`
