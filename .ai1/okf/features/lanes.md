---
type: Component
title: lanes feature
description: Work lanes by task size - quick, plan or deep - with a hook-enforced approval gate for deep designs and progress restored after compaction.
tags: [lanes, workflow, hooks, skills, approval]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T08:30:31Z'
sources:
  - id: lanes-work
    resource: src/lanes/lanes-work.mjs
    title: Plans, statuses and approvals
  - id: lanes-brief
    resource: src/lanes/lanes-brief.mjs
    title: SessionStart recipe and progress restore
  - id: lanes-approval
    resource: src/lanes/lanes-approval.mjs
    title: UserPromptSubmit approval
  - id: lanes-gate
    resource: src/lanes/lanes-gate.mjs
    title: PreToolUse gate
  - id: lanes-escalate
    resource: src/lanes/lanes-escalate.mjs
    title: PreToolUse escalation
  - id: deep-skill
    resource: skills/lanes-design-before-code/SKILL.md
    title: /ai1:lanes-design-before-code procedure
---

# Why

Easy tasks should be done without ceremony; complex ones need questions, a design and the person's
approval before code. The [prior-art review](/decisions/prior-art.md) found that heavy process applied
to every task (spec-driven tools, forced brainstorming) costs up to 8x with no measured quality gain,
and that prompt-only gates are skipped or lost after compaction. So the lane choice is a prompt, and
what must hold is a hook. Opt-in (`features.lanes`, default off); on in this repo.

# Lanes

The agent sizes each task and names the lane in one line; the person can force one ("rápido",
"piénsalo bien"). Decided with the person on 2026-11-08: the agent decides and announces; the deep
gate is a hook block; plans live in a local ignored folder.

- **quick**: do it, run `verify`, report.
- **plan**: read the code, present a short plan, start after a yes (conversation only).
- **deep**: `/ai1:lanes-design-before-code` skill - look before asking, one question at a time, design in
  `.ai1/work/<slug>/plan.md` (goal, constraints, approaches with the choice, steps with checks,
  risks, rulings), one builder-check subagent, approval, then step by step; a task that builds an accepted proposal carries `proposal: <number>` in the plan frontmatter; each step closed with `ai1 step-done`, which logs it in `progress.md` only when
  the [verify](verify.md) commands pass.

# Modules (feature `lanes`)

| Module | Event | What it enforces |
|---|---|---|
| `lanes-brief` | SessionStart | Injects the lane recipe (byte-stable, skipped on `resume`), lists unfinished plans, and after `compact` restores the active plans with the last 15 lines of `progress.md`. Records the session base HEAD and writes `.ai1/work/.gitignore` (`*`). |
| `lanes-approval` | UserPromptSubmit | When a plan of this session has `status: ready` and the person sends a short plain yes (`aprobado`, `adelante`, `ok`, `go ahead`... with no `pero`/`but`/`no`, at most 120 chars), records the approval in ai1's state dir (outside the repo) and sets `status: approved`. |
| `lanes-gate` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | While a plan of this session is `draft`/`ready`, or not approved by the person, refuses writes to project files outside `.ai1/work/`, the knowledge bundle and, with the [proposals feature](proposals.md), `.ai1/proposals/`. Shell writes come from `src/core/shell-writes.mjs`; an inline interpreter script (`python3 - <<EOF`, `node -e`), whose writes it cannot tell, asks the person instead. |
| `lanes-escalate` | PreToolUse (same tools) | With no active plan, once per session, asks the person when the session's changes pass `max_files` (6) or `max_lines` (300), options under `modules.lanes-escalate`. |

Plan statuses: `draft` -> `ready` (agent asks) -> `approved` (only via the person) -> `done` or
`abandoned`. Setting `ready` again requires a new approval. Plans from earlier sessions never block;
they are listed at startup.

**Whose plan it is (since v0.20.2):** plans live in the main checkout's `.ai1/work/`, shared by every
session open on the repo. A plan is this session's when the session's transcript shows a call that
wrote its `plan.md` (Write/Edit/MultiEdit on it, or a shell command naming it that is not read-only;
`readSessionPlanSlugs` in `src/lanes/lanes-work.mjs`, incremental scan, state `<session>-<hash>.lanes-plans`).
The gate, the escalation check, the approval and the post-compaction restore only look at this
session's plans: another session's draft does not block, and a yes here never approves a design
another session has waiting. Without a transcript in the hook input, the old rule applies (a plan
modified since the session started). Before: that rule was the only one, and on 2026-11-09 a long
session was refused every code edit by another session's new draft (`prod-guard`), with "mark it
`abandoned`" as the only way out offered - which would have broken the other session's work; a yes
could also have approved the other session's `ready` plan.

# Limits

- Classification is a prompt: a task wrongly sized as quick is caught only by the escalation size.
- Shell write detection is heuristic; inline interpreter scripts are not resolved to paths, so while
  a design waits the gate asks before any of them, even one that only reads. A script saved to a
  file and then run (`python3 tool.py`) is not seen.
- The "plan" lane has no file and no gate; it relies on the conversation.
- The approval store is outside the repo but not tamper-proof against a determined agent; the brief
  tells the agent not to work around hooks.
- A subagent's own edits to a plan are not in the parent transcript; a plan written only by a
  subagent is not the parent session's until the parent touches it.

# Verified

- `npm test` (2026-11-08): 125 tests, 15 for lanes (recipe, compaction restore, gate on Edit and
  shell writes, approval and re-approval, approval wording, escalation by files and lines).
- Entry point fed real hook JSON on a scratch repo: deny with a ready plan, `aprobado` unlocks, the
  edit passes, `git status` clean.
- Not yet tried in a live Claude Code session.
