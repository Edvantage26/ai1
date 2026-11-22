---
name: okf-interview-project
description: >-
  OKF — Interview the person about the project (purpose, users, scope, constraints, how it runs and
  ships, who decides), inferring first from the repo and asking only what is left, and keep the
  answers, requirements and open questions in the knowledge bundle. Use when the person says "inicializa el proyecto", "entrevístame sobre el
  proyecto", "define los requisitos", "qué te falta saber del proyecto", "interview me about this
  project", "define the requirements", or accepts the offer of /ai1:core-setup-repo or the
  session-start line naming project gaps.
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *) Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" okf project *)
---

# Interview the person about the project

Goal: the agent understands the project before working on it, and what only the person knows is
asked once and kept in the knowledge bundle, not lost in a chat. Three modes: **kickoff** (first time,
or most categories missing), **resume** (a few gaps or open questions left) and **review** (a milestone
closed, or the session start offers it: go to "Review" below).
If `ai1 okf project gaps` says requirements are off in this repo, do not offer this skill; run it only
when the person asks.

Where it lives (all in the bundle, `.ai1/okf/`):

| What | Where | Written by |
|---|---|---|
| Purpose, users, constraints, stack, run and test, deploy, integrations and data, decision makers | `product.md` (`type: Product`), one `## <heading>` each | you, editing the concept |
| How it runs in production: deploy, environments, logs, database, access, monitoring, alerts | `operations.md` (`type: Operations`), one `## <heading>` each | you, editing the concept |
| Requirements, including what is out of scope | `requirements/R<nnn>-<slug>.md` (`type: Requirement`) | `ai1 okf project req add\|set` only |
| Questions the person cannot answer now, and assumptions | `requirements/questions.md` | `ai1 okf project question add\|assume\|answer` only |
| The developer's technical vision: architecture, libraries and services to reuse, how it integrates, what to avoid | `decisions/<slug>.md` (`type: Decision`, tag `technical-vision`, proposed / accepted / replaced) | `ai1 okf project decision add\|set` only |

`ai1` below is `"${CLAUDE_PLUGIN_DATA}/bin/ai1"`.

**What is a requirement.** It says what the project must achieve and why, in words the client would
sign ("a customer can pay by card"); changing it needs the person's decision. How it is built
("Stripe Checkout with a webhook") goes in the other concepts of the bundle, updated as the code
changes. A project has tens of requirements, not hundreds: when one reads like implementation, it is a
concept. Requirements change only from the person's words, never from what the code does.

**Who answers decides where it goes.** The interview has two blocks, and each answer records who
said it (`--from client`, `--from developer`, or a name):
- *Product* (the client or whoever owns the product): purpose, users, scope, constraints, who decides.
  What they impose stays even if the developer would choose otherwise: a requirement or a Product
  constraint ("it must talk to their SAP", "their servers, in the EU").
- *Technical vision* (the developer): how they picture it built, which existing libraries or services
  to reuse, how it integrates with what exists, what to avoid, and the non-functional targets
  (performance, security, cost). These are decisions, not requirements: the developer changes them
  without asking anyone, so they never trigger a requirement change.

## 1. See what is missing

Run `ai1 okf project gaps`. With no Product concept yet, run `ai1 okf project init` first (it creates
`product.md`, `operations.md`, the requirements index and the questions file, and links them from the
bundle index; run it again in a repo started before `operations.md` existed and it adds only that).
Each category reads clear, partial or missing.

## 2. Infer before asking

Read the repo and the bundle for every partial or missing category: README, manifests (stack),
`.ai1/config.json` verify commands (run and test), CI and deploy files, env examples (integrations),
existing concepts. In resume mode, also what this session already learned.

For operations, look also at what production really has, when you can reach it read-only: the
deploy platform, the log and monitoring tools, the alert channels (the customization below may name
the person's own tools and how to query them). Each section of `operations.md` gets the exact command
or place (how to read the logs, open a tunnel to the database, get into the server), and secrets only
as where they live (a secret manager item, the platform's environment), never their value. Existing
runbooks or operations concepts are linked from it, not copied. A topic the project lacks (no
monitoring, no alerts, no backup of its data) is an open question `--about operations`, with your
recommendation to set it up.

Then the project's documents **outside the repo**: many projects keep the brief, the quote or
contract, the client's spreadsheets and specs, and meeting notes in a project folder elsewhere.
- Where to look: the folders the customization below names (a project's own, or the person's
  default with the project name in it, e.g. a docs folder per project on a synced drive); links in
  the README, CLAUDE.md or the bundle to documents outside the repo; the knowledge of `related`
  repositories in `.ai1/config.json`.
- List what is there and read the relevant ones (briefs, quotes, contracts, client spreadsheets,
  specs, notes); skip what is clearly unrelated.
- Cite the document as the source of each fact or requirement you take from it (`--from
  "<document name>"`, its words in `--quote`).
- Before the first question, tell the person which documents you read and ask once whether there
  are more to read first (other folders, links, attachments). When they point to a folder no
  customization names, offer once to save it with /ai1:core-customize-skill (for this project, or
  as their default for every project), so the next interview reads it on its own.

Write what you found into the Product sections as a **draft**, then show the person a short summary
of it ("this is what I understood; correct anything wrong") before the first question. Never ask what
the repo or those documents answer.

## 3. Ask, one question at a time

- Kickoff starts open: "¿Qué es este proyecto y para quién?" Then follow the answer: make vague words
  concrete, surface assumptions, find the edges, ask why.
- Rank the rest by impact × uncertainty: what would change most what gets built, and what you are
  least sure of. At most 5 questions per sitting; the rest stay as open questions for another time.
- Every question carries your recommended answer and why, so the person can just say yes.
- Scope: offer the candidate features as a multi-select (`AskUserQuestion`) and record each as
  active (must or should) or out of scope with its reason.
- Technical vision: propose, do not only ask. For each piece the project needs (auth, payments,
  storage, queues, UI kit...), look first at what the repo and the person's other projects already
  use and at the person's defaults (their customization), then search the web for the current
  options, and offer two or three with your recommendation and why ("para pagos: Stripe Checkout o
  Redsys; recomiendo Stripe porque..."). Ask about the developer's own picture only where it differs
  from their defaults.
- Stop when the person says enough ("vale", "ya está", "stop"), when the cap is reached, or when a
  wrong guess would no longer matter.

## 4. Write every answer where it belongs, at once

- Technical vision: `ai1 okf project decision add --title "<what it decides>" --decision "<the choice>"
  --why "..." --alternatives "a; b" [--avoid "x; y"] --from developer [--state accepted] --quote
  "<their words>"`; one decision per piece (architecture, payments, auth...). `--avoid` names what the
  plans must not bring in (`ai1 okf project conflicts` reports it). A change of mind: `decision set
  <slug> replaced --by <new slug>`.
- Add `--from <who>` to every `req add|set` too, so a client's word is told apart from a developer's.
- Product facts: edit the section of `product.md`, replacing what the answer contradicts instead of
  adding beside it; refresh its `generated`.
- Requirements: `ai1 okf project req add --title "<what must hold>" [--statement "..."] [--priority
  must|should] [--check "<how to prove it>"] --quote "<the person's words>"`; out of scope with
  `--state out-of-scope --reason "<why>"`. A check that a test or a command can show makes the
  requirement usable as a `/goal` (`ai1 okf project req goal <id>`); when a command proves it, add
  `--check-command "<command>"` (or later `req command <id> "<command>"`): `ai1 okf project verify` runs
  them and sends a validated requirement whose check fails back to active, and `ai1 plan-done`
  validates one only when it passes.
- A requirement that changes: a nuance is `req set` with the person's words; a different requirement
  replaces it with `req add ... --supersedes <id>` (the old one stays, superseded by the new one).
- Not known now ("lo hablo con el cliente"): `ai1 okf project question add --about <category>
  "<question>"`; when you must go on anyway, `ai1 okf project question assume <id> "<assumption>"` and
  say you are working on it.
- An answer to an open question: `ai1 okf project question answer <id> "<answer>" --to <concept>`,
  after writing it into that concept.
- Milestones: when the person groups what comes first and what later ("esto para la primera versión"),
  `req add --milestone v1` or `req milestone <id> v1`. Write requirements in the person's language:
  the hints that catch a change in a message match words, not translations.
- Code that serves a requirement: the concept that describes it gets `satisfies: [R004]` in its
  frontmatter (when you write or update that concept), so editing that code asks to run R004's check.

## 5. Close

Run `ai1 okf project gaps` again and tell the person in a few lines: what was recorded, what is still
missing or open, and the requirements created. Validate the bundle (/ai1:okf-validate-bundle .ai1/okf).

## Review

When a milestone closes or the session start offers it (enough plans closed or requirements changed
since the last review):

1. `ai1 okf project review` (or `--milestone v1`) and `ai1 okf project verify`: what holds, what is still
   to build, what was left out and why, what was replaced, what has no command to prove it, and which
   checks fail now.
2. Ask the person only what the review raises, one question at a time, each with your recommendation:
   does each out-of-scope reason still hold; is the purpose in `product.md` still right; should a
   requirement in force without a command get one. At most 5, as in the interview.
3. Record every answer as in step 4 (their words, `req set`, `--supersedes`, a changed purpose in
   `product.md`; a changed purpose is also a dated line in the bundle's `log.md`).
4. `ai1 okf project review --done`, then tell the person in a few lines what changed.

## Fixed rules

- Infer first, show the draft, then ask: never a form, never a question the repo or the project's
  documents already answer.
- At most 5 questions per sitting, one at a time, each with a recommended answer.
- The person's words are quoted as they said them; nothing they did not say is written as theirs.
- A requirement says what and why; how it is built is never a requirement. Requirements change only
  from the person's words, never from what the code does.
- Requirement and question files are changed only through `ai1 okf project`, never by hand.
- Never run in the middle of another task: offered at its routes, done when the person says yes.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-interview-project` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-interview-project`
