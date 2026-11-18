---
type: Component
title: routines feature
description: The person's own periodic tasks in a repo (run a skill or follow a prompt, every hours or days or on a weekday) in their ignored .ai1/local/routines.json, said in one line at session start and offered here or in a new conversation they see; ai1's periodic maintenance tasks are built-in routines for maintainers; ai1 routine, /ai1:routines-set-routine.
tags: [routines, periodic, reminders, fork, maintenance, hooks, cli, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T16:52:08Z'
sources:
  - id: store
    resource: src/routines/routine-store.mjs
    title: Routines, due, snooze, runs
  - id: notice
    resource: src/routines/routine-notice.mjs
    title: SessionStart notice (personal and built-in)
  - id: command
    resource: src/cli/routine-command.mjs
    title: ai1 routine
  - id: skill
    resource: skills/routines-set-routine/SKILL.md
    title: /ai1:routines-set-routine
  - id: tests
    resource: test/routines.test.mjs
    title: Tests
---

Built 2026-11-18. Asked by the person: "que pudiera ponerme tareas periódicas a hacer y que incluso me
proponga lanzar otro agente para hacerlo ... que sea genérico". Only theirs ("Solo mias"), and "another
agent" is a new conversation they see ("La primera"). It absorbed the periodic part of
[maintenance](maintenance.md) ("unificaríamos lo que estaba hecho con esto").

# Where things live

- **Definitions**: `.ai1/local/routines.json` ([person within a project](../architecture/person-project-scope.md)),
  `{ <id>: { title, every, action: { skill } | { prompt }, created, mode?: "off", snoozedUntil? } }`;
  sealed with the person's other local files.
- **Runs**: `.ai1/local/state.json` `routines.<id>` (`lastRun`, `lastOffered`, last 10 runs
  `{ at, how: here|launched|told, note? }`) and `routineSessionStarts`; never sealed, so runs on two
  machines do not make the sealed copies conflict. On a machine without that state a routine is due once.

# Due and offered

- `every`: `<n>h` / `<n>d` since the last run (else since it was created), or a weekday `mon`..`sun`:
  due when not run since that day's local midnight ("cada lunes").
- `routine-notice` (SessionStart `startup` or `clear`, feature routines) lists the due, unmuted ones
  in one line, each at most once per local calendar day, and tells the agent to offer: here (then
  `ai1 routine done <id> "<result>"`), a new conversation (the skill), `snooze` (1 day by default) or `off`.
- `ai1 routine launch <id>` writes a brief (`.ai1/work/handoffs/routine-<id>.md`: title, the skill to
  run or the prompt, the last note, "run `ai1 routine done` when done") and opens it with the same code
  as `ai1 fork brief` ([session fork](session-fork.md)), so the person's opener (`fork_opener`,
  `--open-command`) applies. Recorded as launched only when the conversation opened; `done` from it
  completes that run with its note, a `done` after the period is a new run.

# Built-in routines

`MAINTENANCE_TASKS` entries of kind `periodic` (today `later-backlog`) are ai1's own: run only for
maintainers with the maintenance feature on, told when their check finds something, at most every
`everyDays` and 3 session starts. The same notice line, and `ai1 routine off|on|snooze <id>` (or the
v0.49 `ai1 maintain`, kept as an alias) mute them in `profile.json` `tasks`. `maintenance-notice`
is retired (listed in `RETIRED_MODULE_IDS`). Switching `routines` off stops every periodic reminder,
built-in ones included; the condition hints of maintenance stay with okf.

# Validate

`node --test test/routines.test.mjs test/maintenance.test.mjs`: every and due (periods, weekdays, local
midnight), add/replace/refuse, snooze/off/on, launch recorded only when opened and its brief, done after a
launch and done here, one line once a day and not on resume, built-in `later-backlog` in the same line
and muted by both commands.
