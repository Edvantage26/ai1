---
type: Component
title: maintenance feature
description: Maintenance tasks only for the people who maintain ai1 in a repo (maintainers) - the CLAUDE.md drift and bundle health hints, plus periodic checks at session start gated on days and sessions; each person mutes a task with ai1 maintain off|snooze.
tags: [maintenance, maintainers, hooks, cli]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-19T09:34:32Z'
sources:
  - id: tasks
    resource: src/maintenance/maintenance-tasks.mjs
    title: Task registry, gate, muting
  - id: notice
    resource: src/routines/routine-notice.mjs
    title: SessionStart module (built-in routines; replaced maintenance-notice)
  - id: command
    resource: src/cli/maintain-command.mjs
    title: ai1 maintain
  - id: tests
    resource: test/maintenance.test.mjs
    title: Tests
---

Built 2026-11-18 ([decision](../decisions/person-in-project.md)): the person wanted "tareas de
mantenimiento" for whoever chooses to act as architect of ai1 in a repo, and the rest of the team left
alone. Who is a maintainer: [the person within a project](../architecture/person-project-scope.md#role).

# Tasks

`MAINTENANCE_TASKS` in `src/maintenance/maintenance-tasks.mjs`, each with the feature it belongs to (that
feature off, the task off):

| Task | Kind | Shown by |
|---|---|---|
| `claude-md-drift` | condition | `okf-claude-md` ([okf](okf.md)), its own fingerprint dedupe |
| `bundle-health` | condition | `okf-index`'s bundle health notes |
| `later-backlog` | periodic, every 7 days | a built-in [routine](routines.md), told by `routine-notice`: later entries open and untouched for over 60 days |

- **Condition** tasks keep their module and dedupe; `shouldShowMaintenanceTask` only decides who sees
  them. With the `maintenance` feature off they reach everyone, as before.
- **Periodic** tasks are built-in [routines](routines.md) since v0.50.0, told by `routine-notice` (it replaced `maintenance-notice`; SessionStart, maintainers only): due
  when `everyDays` passed **and** 3 session starts happened since the last notice (counted in
  `.ai1/local/state.json` `routines` and `routineSessionStarts`), so a repo opened once a month does not get everything at once (the gate of
  Claude Code's Auto Dream, [prior art](../decisions/prior-art.md)). One combined line; each run records
  `lastRun`, `lastResult` and, when told, `lastNotified`.

# Muting

`ai1 routine off|on|snooze <task>` mutes them like the person's own routines; `ai1 maintain` (kept as an alias) lists the role and each task (mode, snooze, last told). `ai1 maintain off <task>` (never
again, for this person in this repo), `on <task>`, `snooze <task> [days]` (default 7) write
`.ai1/local/profile.json` `tasks`. The notice tells the agent to use them when the person says "ahora
no" or "nunca".

# Adding a task

One entry in `MAINTENANCE_TASKS`: `id`, `kind`, `feature`, `title`, and for a periodic one `everyDays`
and `check({ projectRoot, sharedRoot, config, now })` returning a one-line summary or null. The check
runs at SessionStart: deterministic, no network, milliseconds.

# Validate

`node --test test/maintenance.test.mjs`: the drift hint reaches only listed maintainers
(case-insensitive) and everyone without a list; `off` silences it and is listed; `snooze` and `on`; the
feature off restores the old behaviour; the periodic notice waits for days and sessions; developers and
resumed sessions get nothing.
