---
type: Decision
title: Stack - what the person always uses, chosen per project and kept in the bundle
description: Why a person's usual pieces (hosting, data, logs, monitoring, auth...) are a structured stack with three sources, offered in the project interview, instead of prose in a customization or one decision per piece.
tags: [decision, okf, project-context, stack]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T12:41:07Z'
---

# Decision

Asked by the person on 2026-11-22 ("una skill de definir stack ... que pueda establecerse a nivel de
proyecto o a nivel global de usuario, y si ya existe a nivel de usuario que pregunte cual de ese stack
quiere meter en el proyecto"), approved the same day. A stack is a list of pieces with a fixed format
(area, applies, setup, check); the person's and their enabled plugins' make the catalog; each project
keeps the pieces it chose with their state. How it is built: [okf feature](../features/okf.md).

# Why

- Prose in a customization cannot be offered as a choice nor audited; a structured piece can be
  pre-selected by `applies` and checked by `check`.
- One technical-vision decision per piece would mix "what I always use" with choices weighed against
  alternatives; a piece links to a decision in its note only when there was such a choice.
- The project's `stack.md` answers "what does this project have integrated" in one place; how each
  piece is operated stays in `operations.md`.
- A plugin source lets a person's private pack carry their stack to any machine, like its
  customizations ([project operations](project-operations.md)).

# Not done

- A piece adopted by a project is a copy: a later change in the catalog is not flagged.
- Whether a piece applies is judged by the agent reading `applies`; ai1 evaluates no conditions.
