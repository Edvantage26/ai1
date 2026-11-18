---
type: Decision
title: The person within a project - local by default, shared definitions committed, sealed sync on request
description: Why a person's role, subscriptions, contacts and state in a project live in the repo's ignored .ai1/local/, what is committed (maintainers, watches, project contacts), and why the optional sealed copy uses only node:crypto (2026-11-18).
tags: [decision, person, local, maintainers, watches, messages, seal]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T08:51:46Z'
sources:
  - id: person-project
    resource: src/core/person-project.mjs
    title: Person within a project
---

Decided with the person on 2026-11-17/18, from a conversation that started with "guardar como un estado
de cómo están las cosas ... que no se suba al repositorio" and grew into three uses:
[maintenance](../features/maintenance.md) for whoever acts as architect, [watches](../features/watches.md)
of what was shipped, and [messages](../features/messages.md) to the project's contacts. How it is built:
[the person within a project](../architecture/person-project-scope.md).

# Decisions

- **A third scope, inside the repo.** The person asked for it "dentro de la carpeta de ai1, aunque sea
  ignorados": `.ai1/local/`, ignoring itself, in the main checkout. Considered and dropped:
  `~/.config/ai1/projects/<remote>/` (survives deleting the repo, but not where the person wants it).
- **Team facts are committed in clear**: who maintains (`maintainers`, by git email, like CODEOWNERS),
  how a release is checked (`.ai1/watches/`, reusable by teammates and documenting how it is
  validated), who the contacts are (a bundle concept). Personal ones are not: role override, muted
  tasks, subscriptions, relation with contacts, state. The person kept watches and subscriptions apart
  ("lo dejamos como la has propuesto con las dos").
- **No list, everyone maintains.** Upgrading ai1 must not silence hints people already get. Creating the
  list (answering "arquitecto" at setup) is what makes the rest developers.
- **Sealed sync is opt-in and uses only `node:crypto`.** The person asked whether each one's data could
  go into the repo readable only by them, without external software ("que no necesitase un software
  externo") and on Linux and Windows. Chosen: an ai1 X25519 key and the age-like construction with
  Node's built-ins, explicit `ai1 local seal|unseal`, never `state.json`. Not automatic: committing
  churn and keeping every version in history forever are costs the person takes knowingly.
- **Watches follow a release; they are not monitoring.** A hook only reminds and reads state; checks
  run from `ai1 watch run` (a scheduler or the agent on a yes); results are counted since the release
  and the person confirms it works for them. Asked 2026-11-18 ("que sea proactivo ... cuántas veces ha
  funcionado de manera exitosa y si hay alguna que ha fallado").
- **Messages are drafted, not sent, by ai1**; sending goes through the person's own tool
  ([host tooling stays out](host-tooling-out-of-plugin.md)). The person chose it inside ai1 as the
  `messages` feature rather than a separate plugin.
- **Cross-platform** from the start ([principles](principles.md)): argument-list commands without a
  shell, CRLF-tolerant files, best-effort file modes, and a `windows-latest` CI job for these tests.

# Not done

A real Claude Code session exercising the message skill end to end (the CLI's login had expired).
The Windows job is green only once the branch is pushed and CI runs.
