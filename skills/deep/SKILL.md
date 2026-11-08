---
name: deep
description: Use when a task is in the deep lane - the goal is unclear, there are design choices with trade-offs, it touches a risky area (auth, data, money, migrations, public API), or it will take hours - or when the person says "piénsalo bien", "think it through", "dale una vuelta" or asks for a design before code.
---

# Deep lane: understand, design, get approval, then build

Code edits outside `.jig/` and the knowledge bundle are refused by the `lanes-gate` hook until the
person approves the design. Designing, reading and asking are always free.

## 1. Open the work folder

Pick a short slug for the task and create `.jig/work/<slug>/plan.md` right away (`.jig/` is
ignored by git), with this frontmatter:

```markdown
---
title: <one line: what will be built>
status: draft
---
```

## 2. Look before you ask

Read the code, the knowledge bundle and recent history that the task touches. Never ask what
they already answer. Note in the plan what you learned that shapes the design.

## 3. Ask what only the person knows

- One question per message, the most important first; start with *why* they want it.
- Open questions before menus; when you offer options, add your recommendation and why.
- Stop asking when a wrong guess would no longer matter. Small calls are yours: record them
  in the plan as `Ruling: <decision> - <why>`.

## 4. Write the design in plan.md

Keep it proportional: a page for most tasks, more only when the task truly needs it.

```markdown
# Goal
What the person can do when this is done, and why it matters.

# Constraints
Exact values and rules that must hold (versions, limits, compatibility, security).

# Approaches
2-3 options with their trade-offs. **Chosen:** <option>, because <reason>.

# Steps
- [ ] 1. <smallest change with its own check> - verify: <command or observation>
- [ ] 2. ...

# Risks and open points
What could go wrong and how it would show; rulings you made.
```

## 5. Builder check

Dispatch one fresh subagent with only the plan path and this brief: "You are a capable engineer
who must build this from the document alone and cannot talk to its author. List, most important
first, only the questions where you would have to guess and a wrong guess would matter; or say
nothing important is missing." Sort its questions into: already answered (make the plan say it),
minor (your ruling, recorded), and the person's (ask them, in one message).

## 6. Ask for approval

Set `status: ready` and show the person a short summary: goal, chosen approach, steps, risks,
and the rulings you made. Ask them to approve or to say what to change. A plain yes from them
("aprobado", "adelante", "ok", "go ahead") is recorded by the `lanes-approval` hook and opens code
edits. If they ask for changes, update the plan, keep `status: ready` and ask again.

## 7. Build step by step

- One step at a time, in plan order. Close each step with `jig step-done <slug> "<step>: <files or
  commit>"`: it runs the repo's verify commands and logs the step in `progress.md` only if they
  pass. Tick the step in the plan. If it fails, fix it before the next step.
- When reality contradicts the design, stop: update the plan, set `status: ready`, ask again.
- After a compaction, the plan and progress are put back in context: trust them and `git log`
  over memory.

## 8. Close

Run the full verify commands, set `status: done`, and tell the person what was built, what was
verified, and every ruling you made. Move lasting decisions to the knowledge bundle; the work
folder is scratch.
