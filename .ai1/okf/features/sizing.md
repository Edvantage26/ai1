---
type: Component
title: sizing feature
description: Each task sized quick, plan or deep - with a plan file for plan and deep tasks, a hook-enforced approval gate for deep designs and progress restored after compaction.
tags: [sizing, workflow, hooks, skills, approval]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-13T10:32:42Z'
sources:
  - id: sizing-work
    resource: src/sizing/sizing-work.mjs
    title: Plans, statuses and approvals
  - id: sizing-scenarios
    resource: src/sizing/sizing-scenarios.mjs
    title: Behaviour scenarios, tag scan and plan-write check
  - id: plan-done
    resource: src/cli/verify-run.mjs
    title: ai1 plan-done
  - id: sizing-brief
    resource: src/sizing/sizing-brief.mjs
    title: SessionStart recipe and progress restore
  - id: sizing-approval
    resource: src/sizing/sizing-approval.mjs
    title: UserPromptSubmit approval
  - id: sizing-gate
    resource: src/sizing/sizing-gate.mjs
    title: PreToolUse gate
  - id: sizing-escalate
    resource: src/sizing/sizing-escalate.mjs
    title: PreToolUse escalation
  - id: deep-skill
    resource: skills/sizing-design-before-code/SKILL.md
    title: /ai1:sizing-design-before-code procedure
---

# Why

Easy tasks should be done without ceremony; complex ones need questions, a design and the person's
approval before code. The [prior-art review](/decisions/prior-art.md) found that heavy process applied
to every task (spec-driven tools, forced brainstorming) costs up to 8x with no measured quality gain,
and that prompt-only gates are skipped or lost after compaction. So the size choice is a prompt, and
what must hold is a hook. Opt-in (`features.sizing`, default off); on in this repo.

# Name (since v0.32.0)

Called **lanes** until v0.31.0 (feature `lanes`, modules `lanes-*`, skill `lanes-design-before-code`, "Lane:
quick"). Renamed with the person on 2026-11-11 because "lane" is a metaphor that does not say what the
feature does: it sizes each task before acting. Considered: `triage` (names the action, sounds medical),
`depth` ("Depth: deep" is redundant), `rigor`, `gears`; `effort` and `mode` were ruled out because Claude
Code already uses them (reasoning effort, plan mode). The person chose size: feature id `sizing` (the act,
reads well in `sizing-gate`), line "Size: quick, because ...", "a deep task", "deep plans"; the levels
quick / plan / deep stayed. Existing repos are moved by the first [migration](/architecture/migrations.md)
at session start; a plan with the old field `lane: plan` is still read as a plan task.

# Sizes

The agent sizes each task and names the size in one line ("Size: quick, because ..."); the person can force one ("rápido",
"piénsalo bien"). Decided with the person on 2026-11-08: the agent decides and announces; the deep
gate is a hook block; plans live in a local ignored folder.

- **quick**: do it, run `verify`, report.
- Sizing (since 2026-11-09, taken from gentle-ai's ODD, see [prior art](/decisions/prior-art.md)): a
  task is quick when it could be resumed from the request and `git diff` alone; the number of files
  never decides. Risky areas that send a task to deep: auth, data or irreversible effects, money,
  migrations, a public API or contract others use, concurrency, deploy or environment, and code no
  test would catch breaking.
- **plan**: read the code, say the plan in a few lines and start without waiting for a yes. Only when it
  has more than about 3 steps or may not finish in one go, also write it to `.ai1/work/<slug>/plan.md`
  with frontmatter `size: plan`, `status: active` and `title` (goal, steps as `- [ ]` checkboxes, how it
  is verified); tick steps as they finish and close with `ai1 plan-done <slug>`
  (verify green, no approval). Until 2026-11-09 it waited for a yes (approving plans and their
  adjustments was 38 of the questions counted that week); until 2026-11-11 it lived only in the
  conversation, so a compaction lost it. The file, taken from superpowers' living plan doc at the
  person's request, is what compaction restores; it is not gated and `sizing-approval` ignores it.
  Conditional (decided with the person on 2026-11-11): most plan tasks end before any compaction, and a
  file on every one would be the ceremony the prior-art review warns against.
- **deep**: `/ai1:sizing-design-before-code` skill - look before asking, one question at a time, design in
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

- `ai1 plan-done <slug>` (`src/cli/verify-run.mjs`) is the one way to close a plan: a deep plan
  (main checkout, or this worktree) must be `approved` (a plan task's plan only not finished), no duplicate ids, every scenario's tag found in the current
  checkout (the worktree, where the tests live before merge), then the verify commands green; only
  then `status: done` and a progress line with each scenario's test location. A plan without
  scenarios closes after a green verify. Without git it fails closed.
- Tag scan (`src/sizing/sizing-scenarios.mjs`): `git ls-files -co --exclude-standard`, exact
  case-sensitive `[<slug>:S<n>]`, skipping `.ai1/`, `*.md`, binaries and files over 1 MB, so a tag
  quoted in docs or the plan is not coverage. Headings inside code fences do not count.
- `ai1 step-done` prints how many scenarios are covered so far (informative only).
- `sizing-gate` refuses a Write/Edit/MultiEdit that sets `status: done` by hand on a plan with
  scenarios, or drops an approved scenario (or the section) unless the same write sets the plan back
  to `ready`/`draft`. Adding and rewording scenarios are free.

# Modules (feature `sizing`)

| Module | Event | What it enforces |
|---|---|---|
| `sizing-brief` | SessionStart | Injects the sizing recipe (byte-stable, skipped on `resume`), lists unfinished plan and deep plans, and after `compact` restores the active plans with the last 15 lines of `progress.md`. Records the session base HEAD and writes `.ai1/work/.gitignore` (`*`). |
| `sizing-approval` | UserPromptSubmit | When a plan of this session has `status: ready` and the person sends a short plain yes (`aprobado`, `adelante`, `ok`, `acepto`, `go ahead`, `accept`... with no `pero`/`but`/`no`, at most 120 chars, no `?`; `si` counts only as the first word, since inside a sentence it is the conditional "if" - on 2026-11-09 "o que si hay un error..., eso cuadraría?" approved a design), records the approval in ai1's state dir (outside the repo) and sets `status: approved`. |
| `sizing-gate` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | While a deep plan of this session is `draft`/`ready`, or not approved by the person, refuses writes to project files outside `.ai1/work/`, the knowledge bundle and, with the [later feature](later.md), `.ai1/later/`. Shell writes come from `src/core/shell-writes.mjs`; an inline interpreter script (`python3 - <<EOF`, `node -e`), whose writes it cannot tell, asks the person instead. Always (any plan, approved or not): refuses closing a plan with behaviour scenarios by hand or dropping its approved scenarios (see above). |
| `sizing-escalate` | PreToolUse (same tools) | With no active plan, once per session, tells the person (a notice, not a permission prompt; it asked until 2026-11-09) when the session's changes pass `max_files` (6) or `max_lines` (300), options under `modules.sizing-escalate`. |

Plans of plan tasks (`size: plan`; `lane: plan` before v0.32.0 is still read): `active` -> `done` (via `ai1 plan-done`, which then needs only a green
verify) or `abandoned`. Deep plan statuses: `draft` -> `ready` (agent asks) -> `approved` (only via the person) -> `done` (via
`ai1 plan-done`) or `abandoned`. Setting `ready` again requires a new approval. Plans from earlier sessions never block;
they are listed at startup.

**Whose plan it is (since v0.20.2):** plans live in the main checkout's `.ai1/work/`, shared by every
session open on the repo. A session isolated in a worktree (Claude Code's EnterWorktree, the way ai1's
worktree flow enters one) cannot write outside it, file tools and symlinks included (tried
2026-11-13), so since 2026-11-13 its plans live in the worktree's `.ai1/work/`: `listPlanRoots`
gives the gate, the escalation check, the approval, the brief and `ai1 step-done`/`plan-done` the
worktree first and the main checkout after; the gate makes the worktree's `.ai1/work/` ignore itself
before the first plan is written; `ai1 worktree finish` and `drop` move its plan folders to the main
checkout (`movePlansToMainCheckout`, a taken slug gets `-<worktree name>`). Before (2026-11-09 to
2026-11-13) the gate refused a plan in the worktree and named the main checkout path, which such a
session could not write; earlier still, a plan there was invisible to the gate and the approval. Approvals stay keyed
by the plan's relative path under the main checkout's state. A plan is this session's when the session's transcript shows a call that
wrote its `plan.md` (Write/Edit/MultiEdit on it, or a shell command naming it that is not read-only;
`readSessionPlanSlugs` in `src/sizing/sizing-work.mjs`, incremental scan, state `<session>-<hash>.sizing-plans`).
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
- The plan size has a file but no gate: nothing checks the agent writes it, and its checkboxes are
  ticked by hand (`ai1 step-done` logs a step in `progress.md` if the agent uses it).
- Behaviour scenarios prove a tagged test exists and the suite is green, not that the test proves the
  scenario (the person's review, and [test-guard](../guards/test-guard.md) against weakened tests). A
  tag in a file the verify commands never run still counts. Tags outlive the plan (`.ai1/work/` is
  git-ignored). A shell write of `status: done` (`sed -i`) is not seen by the gate.
- The approval store is outside the repo but not tamper-proof against a determined agent; the brief
  tells the agent not to work around hooks.
- A subagent's own edits to a plan are not in the parent transcript; a plan written only by a
  subagent is not the parent session's until the parent touches it.

# Verified

- `npm test` (2026-11-08): 125 tests, 15 for lanes, now sizing (recipe, compaction restore, gate on Edit and
  shell writes, approval and re-approval, approval wording, escalation by files and lines).
- Entry point fed real hook JSON on a scratch repo: deny with a ready plan, `aprobado` unlocks, the
  edit passes, `git status` clean.
- Behaviour scenarios (2026-11-09): 6 tests in `test/sizing-scenarios.test.mjs` (parsing, fences,
  tag scan exclusions, exact match, no git), 4 in `test/verify.test.mjs` (plan-done closes, stays
  open, no scenarios, coverage line), 2 in `test/lanes.test.mjs` (now `test/sizing.test.mjs`) (gate on Edit/Write/MultiEdit,
  dropped scenarios). Not yet tried on a real plan with scenarios.
- Not yet tried in a live Claude Code session.
