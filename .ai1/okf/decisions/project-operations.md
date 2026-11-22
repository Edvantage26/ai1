---
type: Decision
title: Each project says how it runs in production - generic format in ai1, the person's tools outside
description: Why the operations of a project (deploy, environments, logs, database, access, monitoring, alerts) are an Operations concept of its bundle with a gap category, and why the knowledge of one person's infrastructure stays in their own skills (or a private plugin) and customizations.
tags: [decision, okf, project-context, operations, public-repo]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T10:45:14Z'
---

# Decision

Asked by the person on 2026-11-22: the project must know how it is deployed, where, how to read the
production logs, how to reach the database or the server, its monitors and where its alerts go; and,
with it, empty their global agent instructions into plugins ("ir vaciando Claude config e ir
pasandolo a plugin"). Two layers, approved that day ("capa generica ok"):

- **ai1, generic:** an `Operations` concept per project (`operations.md`, seven topics), created by
  `ai1 okf project init`, a gap category `operations` that names what is empty, and the interview
  asking for it. No tool, host or vendor is named (a test checks it). Detail in
  [okf feature](../features/okf.md#project-context-interview-requirements-open-questions-since-2026-11-21).
- **The person's infrastructure, private:** how to query their deploy platform, logs, monitors and
  alert channels lives in their own skills and in their customization of `okf-interview-project`,
  which tells the interview to use them. First planned as a private plugin; changed the same day
  ("Si adelante" to the recommendation): skills made of markdown and scripts cost the same context as
  global skills or as a plugin, so the plugin waits until the skills are shared with someone or used on
  another machine. What shrinks the always-loaded instructions is moving their text into skill bodies,
  keeping only one-line rules that must hold everywhere. Same line as
  [host tooling stays out of the plugin](host-tooling-out-of-plugin.md).

# Why

- A customization alone is prose added to one ai1 skill: it carries no scripts nor skills of its own
  and does not reach repos without ai1. A private plugin alone would not let ai1 see that a project
  lacks its operations, and every repo kept them its own way (a runbook here, an operations folder
  there).
- Global instructions load whole in every session; a skill costs only its description until used. Moving
  infrastructure knowledge into plugin skills is what makes the global file smaller.
- Committed in the repo, like watches: a team fact. Secrets are named by where they live, never copied.

# Consequences

- Repos that already describe their operations in other concepts get an empty `operations.md` on the
  next `init`; it links to them rather than copying (done by hand with the person).
- A rule that must hold everywhere (not only when a skill runs) still belongs in the person's global
  instructions or in a guard.
