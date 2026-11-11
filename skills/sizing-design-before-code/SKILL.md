---
name: sizing-design-before-code
description: Sizing — Use when a task is sized deep - the goal is unclear, there are design choices with trade-offs, it touches a risky area (auth, data, money, migrations, public API), or it will take hours - or when the person says "piénsalo bien", "think it through", "dale una vuelta" or asks for a design before code.
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Deep task: understand, design, get approval, then build

Code edits outside `.ai1/` and the knowledge bundle are refused by the `sizing-gate` hook until the
person approves the design. Designing, reading and asking are always free.

## 1. Open the work folder

Pick a short slug for the task and create `.ai1/work/<slug>/plan.md` right away (`.ai1/work/` is
ignored by git) in the **main checkout**, even when this session works in a worktree: the design
gate, the approval and `ai1 step-done` read plans only there. With this frontmatter:

```markdown
---
title: <one line: what will be built>
status: draft
---
```

## 2. Look before you ask

Read the code, the knowledge bundle and recent history that the task touches. Never ask what
they already answer. Note in the plan what you learned that shapes the design.
If the task builds an accepted later entry from `.ai1/later/`, read it first, reuse its decisions
instead of reopening them, and add `later: <number>` to the plan frontmatter.

## 3. Ask what only the person knows

- One question per message, the most important first; start with *why* they want it.
- Open questions before menus; when you offer options, add your recommendation and why.
- Stop asking when a wrong guess would no longer matter. Small calls are yours: record them
  in the plan as `Ruling: <decision> - <why>`.

## 4. Write the design in plan.md

Keep it proportional: a page for most tasks, more only when the task truly needs it.

```markdown
# Request
> The person's original request, copied word for word.
> Later corrections from them, also word for word, each with its date.

# Goal
What the person can do when this is done, and why it matters.

# Constraints
Exact values and rules that must hold (versions, limits, compatibility, security).

# Behaviour
- S1: Given <state>, when <action>, then <observable result>.
- S2: ...

# Approaches
2-3 options with their trade-offs. **Chosen:** <option>, because <reason>.

# Steps
- [ ] 1. <smallest change with its own check> - verify: <command or observation>
- [ ] 2. ...

# Risks and open points
What could go wrong and how it would show; rulings you made.
```

**Behaviour** is what the person approves as "done means this": 2-5 scenarios, each one a
situation the person can observe (not an internal detail), numbered `S1`, `S2`... A scenario
quotes the person's exact strings (messages, names, examples) word for word, never paraphrased:
**Request** and those quotes are what survives a compaction intact. When the task
changes no observable behaviour (a refactor, docs, internals), write `None - <why>` instead.
The test that covers a scenario carries the tag `[<slug>:S<n>]` in its name or a comment next to it,
e.g. `test('locks the account after 4 failures [login-lock:S1]', ...)`. Name in each step which
scenarios it covers.

## 5. Builder check

Dispatch one fresh subagent with only the plan path and this brief: "You are a capable engineer
who must build this from the document alone and cannot talk to its author. List, most important
first, only the questions where you would have to guess and a wrong guess would matter; or say
nothing important is missing." Sort its questions into: already answered (make the plan say it),
minor (your ruling, recorded), and the person's (ask them, in one message).

## 6. Ask for approval

Set `status: ready` and show the person a short summary: goal, behaviour scenarios, chosen approach, steps, risks,
and the rulings you made. Ask them to approve or to say what to change. A plain yes from them
("aprobado", "adelante", "ok", "go ahead") is recorded by the `sizing-approval` hook and opens code
edits. If they ask for changes, update the plan, keep `status: ready` and ask again.

## 7. Build step by step

- One step at a time, in plan order. Close each step with `ai1 step-done <slug> "<step>: <files or
  commit>"`: it runs the repo's verify commands and logs the step in `progress.md` only if they
  pass, and says how many scenarios have a tagged test so far. Tick the step in the plan. If it
  fails, fix it before the next step.
- A subagent you hand a step to gets the plan path, the step and its `S<n>`, never your own
  summary of the request.
- When the person corrects the request, add it word for word to **Request**, then update only the
  affected scenarios and steps.
- When reality contradicts the design, stop: update the plan, set `status: ready`, ask again.
- After a compaction, the plan and progress are put back in context: trust them and `git log`
  over memory.

## 8. Close

Close with `ai1 plan-done <slug>` (from the worktree, if you work in one): it refuses while a
scenario has no tagged test, then runs the verify commands and, only when green, sets
`status: done` and logs where each scenario is tested. Writing `status: done` by hand on a plan with
scenarios is refused by `sizing-gate`, and so is dropping an approved scenario (go back to
`status: ready` and ask the person). Tell the person what was built, what was verified (per
scenario, with its test), and every ruling you made. Move lasting decisions to the knowledge bundle; the work
folder is scratch.

## Fixed rules

- No code edits outside `.ai1/` and the knowledge bundle before the person approves the design.
- The plan lives in `.ai1/work/<slug>/plan.md` of the main checkout.
- A step is done only through `ai1 step-done`, with the verify commands green.
- A plan is done only through `ai1 plan-done`: every approved scenario with its tagged test, verify green.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context sizing-design-before-code` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context sizing-design-before-code`
