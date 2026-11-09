---
type: Component
title: lanes feature
description: Work lanes by task size - quick, plan or deep - with a hook-enforced approval gate for deep designs and progress restored after compaction.
tags: [lanes, workflow, hooks, skills, approval]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T18:33:50Z'
sources:
  - id: lanes-work
    resource: src/lanes/lanes-work.mjs
    title: Plans, statuses and approvals
  - id: lanes-scenarios
    resource: src/lanes/lanes-scenarios.mjs
    title: Behaviour scenarios, tag scan and plan-write check
  - id: plan-done
    resource: src/cli/verify-run.mjs
    title: ai1 plan-done
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
- Sizing (since 2026-11-09, taken from gentle-ai's ODD, see [prior art](/decisions/prior-art.md)): a
  task is quick when it could be resumed from the request and `git diff` alone; the number of files
  never decides. Risky areas that send a task to deep: auth, data or irreversible effects, money,
  migrations, a public API or contract others use, concurrency, deploy or environment, and code no
  test would catch breaking.
- **plan**: read the code, say the plan in a few lines and start without waiting for a yes (conversation
  only; until 2026-11-09 it waited, and approving plans and their adjustments was 38 of the questions
  counted that week).
- **deep**: `/ai1:lanes-design-before-code` skill - look before asking, one question at a time, design in
  `.ai1/work/<slug>/plan.md` (the request word for word with later corrections, goal, constraints, approaches with the choice, steps with checks,
  risks, rulings), one builder-check subagent, approval, then step by step; a task that builds an accepted [later](later.md) entry carries `later: <number>` in the plan frontmatter; each step closed with `ai1 step-done`, which logs it in `progress.md` only when
  the [verify](verify.md) commands pass; the plan closed with `ai1 plan-done` (below).

# Behaviour scenarios (since 2026-11-09)

A deep plan carries a `# Behaviour` section: 2-5 scenarios the person approves with the design,
`- S1: Given <state>, when <action>, then <observable result>`, or `None - <why>` for refactors and
internals. Scenarios quote the person's exact strings, and a subagent handed a step gets the plan
path and its `S<n>`, never a summary: the verbatim request and quotes survive compaction and handoffs
without drifting. The test that covers a scenario carries `[<slug>:S<n>]` in its name or a comment. Light
BDD: the valuable part (concrete examples agreed before the code, a shared language) without
Gherkin/Cucumber glue. Decided with the person on 2026-11-09; goal: the agent cannot call a design
done while an agreed behaviour has no test - the verify gate alone only knows the suite is green.

- `ai1 plan-done <slug>` (`src/cli/verify-run.mjs`) is the one way to close a deep plan: the plan
  (main checkout) must be `approved`, no duplicate ids, every scenario's tag found in the current
  checkout (the worktree, where the tests live before merge), then the verify commands green; only
  then `status: done` and a progress line with each scenario's test location. A plan without
  scenarios closes after a green verify. Without git it fails closed.
- Tag scan (`src/lanes/lanes-scenarios.mjs`): `git ls-files -co --exclude-standard`, exact
  case-sensitive `[<slug>:S<n>]`, skipping `.ai1/`, `*.md`, binaries and files over 1 MB, so a tag
  quoted in docs or the plan is not coverage. Headings inside code fences do not count.
- `ai1 step-done` prints how many scenarios are covered so far (informative only).
- `lanes-gate` refuses a Write/Edit/MultiEdit that sets `status: done` by hand on a plan with
  scenarios, or drops an approved scenario (or the section) unless the same write sets the plan back
  to `ready`/`draft`. Adding and rewording scenarios are free.

# Modules (feature `lanes`)

| Module | Event | What it enforces |
|---|---|---|
| `lanes-brief` | SessionStart | Injects the lane recipe (byte-stable, skipped on `resume`), lists unfinished plans, and after `compact` restores the active plans with the last 15 lines of `progress.md`. Records the session base HEAD and writes `.ai1/work/.gitignore` (`*`). |
| `lanes-approval` | UserPromptSubmit | When a plan of this session has `status: ready` and the person sends a short plain yes (`aprobado`, `adelante`, `ok`, `acepto`, `go ahead`, `accept`... with no `pero`/`but`/`no`, at most 120 chars, no `?`; `si` counts only as the first word, since inside a sentence it is the conditional "if" - on 2026-11-09 "o que si hay un error..., eso cuadraría?" approved a design), records the approval in ai1's state dir (outside the repo) and sets `status: approved`. |
| `lanes-gate` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | While a plan of this session is `draft`/`ready`, or not approved by the person, refuses writes to project files outside `.ai1/work/`, the knowledge bundle and, with the [later feature](later.md), `.ai1/later/`. Shell writes come from `src/core/shell-writes.mjs`; an inline interpreter script (`python3 - <<EOF`, `node -e`), whose writes it cannot tell, asks the person instead. Always (any plan, approved or not): refuses closing a plan with behaviour scenarios by hand or dropping its approved scenarios (see above). |
| `lanes-escalate` | PreToolUse (same tools) | With no active plan, once per session, tells the person (a notice, not a permission prompt; it asked until 2026-11-09) when the session's changes pass `max_files` (6) or `max_lines` (300), options under `modules.lanes-escalate`. |

Plan statuses: `draft` -> `ready` (agent asks) -> `approved` (only via the person) -> `done` (via
`ai1 plan-done`) or `abandoned`. Setting `ready` again requires a new approval. Plans from earlier sessions never block;
they are listed at startup.

**Whose plan it is (since v0.20.2):** plans live in the main checkout's `.ai1/work/`, shared by every
session open on the repo. From a worktree, `lanes-gate` refuses writing a plan under the worktree's own
`.ai1/work/` and names the main checkout path (since 2026-11-09): a plan there was invisible to the
gate, the approval and `ai1 step-done`, so a deep design made from a worktree was never gated (seen in
a real session: the person's "adelante" was not recorded). A plan is this session's when the session's transcript shows a call that
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
- Behaviour scenarios prove a tagged test exists and the suite is green, not that the test proves the
  scenario (the person's review, and [test-guard](../guards/test-guard.md) against weakened tests). A
  tag in a file the verify commands never run still counts. Tags outlive the plan (`.ai1/work/` is
  git-ignored). A shell write of `status: done` (`sed -i`) is not seen by the gate.
- The approval store is outside the repo but not tamper-proof against a determined agent; the brief
  tells the agent not to work around hooks.
- A subagent's own edits to a plan are not in the parent transcript; a plan written only by a
  subagent is not the parent session's until the parent touches it.

# Verified

- `npm test` (2026-11-08): 125 tests, 15 for lanes (recipe, compaction restore, gate on Edit and
  shell writes, approval and re-approval, approval wording, escalation by files and lines).
- Entry point fed real hook JSON on a scratch repo: deny with a ready plan, `aprobado` unlocks, the
  edit passes, `git status` clean.
- Behaviour scenarios (2026-11-09): 6 tests in `test/lanes-scenarios.test.mjs` (parsing, fences,
  tag scan exclusions, exact match, no git), 4 in `test/verify.test.mjs` (plan-done closes, stays
  open, no scenarios, coverage line), 2 in `test/lanes.test.mjs` (gate on Edit/Write/MultiEdit,
  dropped scenarios). Not yet tried on a real plan with scenarios.
- Not yet tried in a live Claude Code session.
