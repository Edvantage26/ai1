---
name: okf-define-stack
description: >-
  OKF — Define the stack the person always uses (hosting, data and backups, logs, monitoring, alerts,
  auth, payments, UI...) once for every project, or the pieces of one project: each piece with when it
  applies, how it is set up and how it is checked. The project interview then offers the pieces that
  fit each project. Use when the person says "define mi stack", "lo que uso siempre en producción",
  "mi stack por defecto", "añade X a mi stack", "este proyecto usa X", "define the stack", "my default
  stack", "add X to my stack", or accepts the offer of /ai1:okf-interview-project.
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *) Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" okf stack *)
---

# Define the stack

`ai1` below is `"${CLAUDE_PLUGIN_DATA}/bin/ai1"`. Every stack file is written by `ai1 okf stack`, never
by hand.

A **piece** is one thing a project uses, written once: an `id` (slug), a title, its `area` (a topic of
`operations.md` - Deploy, Environments, Logs, Database, Access, Monitoring, Alerts - or another one such
as Auth, Payments, UI), when it `applies` ("if it has a frontend"), how it is set up (`setup`: a skill or
short steps) and how it is checked (`check`: what shows it is there and works). Not versions or files:
the stack says what is used, not how its dependencies are pinned.

| Where | For | Written with |
|---|---|---|
| The person: `~/.config/ai1/stack.md` | what they use in every project | `ai1 okf stack add --scope user ...` |
| A plugin they enabled: `ai1/stack.md` inside it | a private pack (read only here) | the plugin's own repo |
| The project: `.ai1/okf/stack.md` | what this project uses: integrated, pending or none | `ai1 okf stack add --scope project`, `adopt`, `set` |

Run `ai1 okf stack catalog` first: the person's and the plugins' pieces, with their source.

## The person's stack

1. Infer before asking: what their repos already use (manifests, Dockerfiles, deploy files, CI, the
   bundles' `operations.md` and `stack.md`), what the catalog already has, and their customization below.
2. Propose the pieces area by area, each fully written (id, title, area, applies, setup, check), with
   your recommendation, and let the person correct them. One area per question, at most 4 pieces per
   question.
3. Write each accepted piece: `ai1 okf stack add --scope user --id <id> --title "..." --area "..."
   --applies "..." --setup "..." --check "..."`. A piece a plugin already has is not copied: the person
   only adds what differs (theirs wins on the same id).

## A project's stack

- From the catalog: `ai1 okf stack adopt <id>...` (as pending). The pieces that do not apply:
  `ai1 okf stack add --scope project --id <id> --title "..." --state none --note "<why>"`, or `set <id>
  none --note` once adopted.
- A piece only this project uses: `ai1 okf stack add --scope project ...` with its fields.
- `ai1 okf stack set <id> integrated --note "<checked how, date>"` only after running its `check` and
  seeing it pass; a piece set up but not checked stays pending.
- How each integrated piece is operated (commands, places, where secrets live) goes in
  `operations.md`, not here.

## Fixed rules

- Stack files are written only through `ai1 okf stack`; the person sees each piece before it is written.
- A piece says what is used, when it applies, how it is set up and checked; never versions, files or secrets.
- `integrated` only after its check passed; `none` always with its reason.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-define-stack` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-define-stack`
