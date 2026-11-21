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
asked once and kept in the knowledge bundle, not lost in a chat. Two modes: **kickoff** (first time,
or most categories missing) and **resume** (a few gaps or open questions left).

Where it lives (all in the bundle, `.ai1/okf/`):

| What | Where | Written by |
|---|---|---|
| Purpose, users, constraints, stack, run and test, deploy, integrations and data, decision makers | `product.md` (`type: Product`), one `## <heading>` each | you, editing the concept |
| Requirements, including what is out of scope | `requirements/R<nnn>-<slug>.md` (`type: Requirement`) | `ai1 okf project req add\|set` only |
| Questions the person cannot answer now, and assumptions | `requirements/questions.md` | `ai1 okf project question add\|assume\|answer` only |

`ai1` below is `"${CLAUDE_PLUGIN_DATA}/bin/ai1"`.

## 1. See what is missing

Run `ai1 okf project gaps`. With no Product concept yet, run `ai1 okf project init` first (it creates
`product.md`, the requirements index and the questions file, and links them from the bundle index).
Each category reads clear, partial or missing.

## 2. Infer before asking

Read the repo and the bundle for every partial or missing category: README, manifests (stack),
`.ai1/config.json` verify commands (run and test), CI and deploy files, env examples (integrations),
existing concepts. In resume mode, also what this session already learned. Write what you found into
the Product sections as a **draft**, then show the person a short summary of it ("this is what I
understood; correct anything wrong") before the first question. Never ask what the repo answers.

## 3. Ask, one question at a time

- Kickoff starts open: "¿Qué es este proyecto y para quién?" Then follow the answer: make vague words
  concrete, surface assumptions, find the edges, ask why.
- Rank the rest by impact × uncertainty: what would change most what gets built, and what you are
  least sure of. At most 5 questions per sitting; the rest stay as open questions for another time.
- Every question carries your recommended answer and why, so the person can just say yes.
- Scope: offer the candidate features as a multi-select (`AskUserQuestion`) and record each as
  active (must or should) or out of scope with its reason.
- Stop when the person says enough ("vale", "ya está", "stop"), when the cap is reached, or when a
  wrong guess would no longer matter.

## 4. Write every answer where it belongs, at once

- Product facts: edit the section of `product.md`, replacing what the answer contradicts instead of
  adding beside it; refresh its `generated`.
- Requirements: `ai1 okf project req add --title "<what must hold>" [--statement "..."] [--priority
  must|should] [--check "<how to prove it>"] --quote "<the person's words>"`; out of scope with
  `--state out-of-scope --reason "<why>"`. A check that a test or a command can show makes the
  requirement usable as a `/goal` (`ai1 okf project req goal <id>`).
- Not known now ("lo hablo con el cliente"): `ai1 okf project question add --about <category>
  "<question>"`; when you must go on anyway, `ai1 okf project question assume <id> "<assumption>"` and
  say you are working on it.
- An answer to an open question: `ai1 okf project question answer <id> "<answer>" --to <concept>`,
  after writing it into that concept.

## 5. Close

Run `ai1 okf project gaps` again and tell the person in a few lines: what was recorded, what is still
missing or open, and the requirements created. Validate the bundle (/ai1:okf-validate-bundle .ai1/okf).

## Fixed rules

- Infer first, show the draft, then ask: never a form, never a question the repo already answers.
- At most 5 questions per sitting, one at a time, each with a recommended answer.
- The person's words are quoted as they said them; nothing they did not say is written as theirs.
- Requirement and question files are changed only through `ai1 okf project`, never by hand.
- Never run in the middle of another task: offered at its routes, done when the person says yes.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-interview-project` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-interview-project`
