---
type: Decision
title: Prior art - take ideas, not code
description: What was reviewed before designing jig, what was taken from each, and what the community says about it.
tags: [decision, prior-art]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T17:33:51Z'
---

First review on 2026-10-30 by reading the repositories.

| Project | What it is | Taken | Left out |
|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) v7.0.1 | 14 method skills + one SessionStart hook | Verification before completion, fresh implementer + separate reviewer, "red flags" tables against rationalization, evals of skills | Enforcement is prompt-only; forced brainstorming on every task |
| [rsc-harness](https://github.com/ericrisco/rsc-harness) v3.6.0 (MIT) | Meta-harness: memory/hands/trade/reflexes, lanes Answer / FTD (Fast-Track Development) / ASDD (Agent Spec-Driven Development), hooks, 269 skills | The four pieces, lanes, tools with connection tests, refuting finding-verifier, OKF as memory | Auto-update from npm every session, grants `git commit`/`git push` without asking, ~56k lines of skills |
| [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) | One CLAUDE.md with four rules against common LLM coding mistakes: think before coding, simplicity first, surgical changes, goal-driven execution | Simplicity first and surgical changes, in the [craft feature](/features/craft.md) | Think before coding and goal-driven execution: already covered by lanes and the verify gate |
| [rsc-factory](https://github.com/gregoryjp/rsc-factory) (unofficial) | PRD-to-product engine outside the agent | Risk classifier idea (auto vs human PR) for a future pipeline mode | Whole engine: out of scope |

No code is copied at this stage; if any is, it keeps its MIT notice and attribution.

# Superpowers deep review (v7.0.2, 2026-11-08)

Whole repo read, including `RELEASE-NOTES.md` and `docs/superpowers/specs/`. Its value for jig is the
measured failures of prompt-only enforcement, each one a gap a hook can close:

- **Compaction drops rules.** Claude Code re-attaches an invoked skill truncated at 20,000 chars; SDD
  lost its 5-round fix cap and ran 18 rounds; one session made 269 dispatches for ~22 tasks. Their fix:
  an on-disk ledger plus a test failing any `SKILL.md` ≥ 20 KB.
- **Wording.** Token tripwires and recognition tables work; prohibitions on what to write do worse than
  no guidance; a positive recipe works best; shortest phrasing wins. Applies to jig's block reasons.
- **Cheapen mechanics, never judgment.** Haiku reviewers caught 0/10 planted defects.
- **Review loops churn** unless the re-review is scoped to the findings and capped.
- **Prompt cache.** Changing injected text between prompts rewrote the cache in 83% of sessions.
- Full-suite rule: in 11/12 probe runs the agent ran only the named test file.
- `executing-plans/scripts/task-done` records "task complete" only on exit 0: evidence the agent cannot write.

Candidate ideas, mapped to the [roadmap](../roadmap.md): `verify` Stop gate on "edit after the last
verify run" (scan as in `okf-upkeep`), test-weakening detector, fix-loop counters in a hook, ledger
re-injection on `compact`, reviewer contract (merge-base range, read-only, "declined to judge" list),
`review-package`/`task-brief` scripts, `jig doctor --session` (deterministic transcript diagnosis),
opt-in `claude -p --output-format stream-json` evals. Small gaps found in jig: `danger` misses
`git worktree remove --force`; `okf-index` re-injects on `resume`; the `/jig:init` description
describes the workflow instead of only triggers.

Left out: the "1% chance" bootstrap prose, forced brainstorming and its network server, the full SDD
choreography, agent-run merge/push, multi-harness shims, jq/yq scripts. Superpowers has no CI.

# Naming: SDD is ambiguous

In Superpowers, SDD = **Subagent**-Driven Development (one fresh subagent per plan task + review). In the
industry (GitHub Spec Kit, Kiro, Tessl) SDD = **Spec**-Driven Development; rsc-harness calls its lane ASDD.

# Community view (2026-11-08)

- Spec-driven: oversized for small changes (Kiro turned a bug into 16 acceptance criteria), heavy
  repetitive markdown to review, agents still ignore the spec, "waterfall strikes back"
  ([Böckeler](https://www.martinfowler.com/articles/exploring-gen-ai/sdd-3-tools.html),
  [marmelab](https://marmelab.com/blog/2025/11/12/spec-driven-development-waterfall-strikes-back.html)).
- Superpowers SDD: very token-hungry and slow; some report it worse than plain Claude/Codex
  ([HN](https://news.ycombinator.com/item?id=48739459)); praised for long, well-scoped tasks and TDD.

Conclusion: it backs [principles](principles.md) (mechanisms over prompts, friction proportional to
risk). Take the cheap mechanisms; keep any heavy spec/subagent lane opt-in, with FTD as default.

# Alternatives to SDD (2026-11-08)

- **Explore → Plan → Code → Commit** (Claude Code best practice): read and plan in plan mode, then code and verify.
- **Research → Plan → Implement** (HumanLayer, Dex Horthy): each phase in a fresh context; progress
  compacted on purpose into a file ("frequent intentional compaction").
- **Ralph loop** (Geoffrey Huntley): `while true` piping one prompt into the agent; state in files + git;
  exit only on external backpressure (tests, types, linters, coverage). Fails on irreversible side effects.
- **Augmented coding** (Kent Beck): strict TDD + Tidy First, fast tests always running, reject disabled
  tests and unasked-for features.
- Heavier role-based kits (BMAD, GSD) sit closer to SDD.

Common thread: small increments, state on disk, and an exit gate the agent cannot declare by itself.
That is jig's `verify` gate plus test-weakening detection, independent of the chosen workflow.

# Comparisons of methodologies (2026-11-08)

All small samples; read as signals, not proof.

- **Head-to-head, 2026-10-13** ([Fontoura](https://felipefontoura.com/articles/spec-driven-development-tools-compared/)):
  same 24-line repo, same model, n=1. Quality within one checklist item for all four; cost 8x apart:
  Superpowers 7.0.0 40 s / $0.33 / 0 spec lines; BMAD 217 s / $1.89; OpenSpec 277 s / $2.16;
  Spec Kit 473 s / $2.84 / 690 spec lines for a 9-line change. A reproducible 3-run version with a
  scripted 13-item checklist is proposed in petruseugene/full-development-cycle#12 (open).
- **TDD in the agent loop** ([Böckeler](https://martinfowler.com/articles/exploring-gen-ai/tdd-in-the-agent-loop.html)):
  3 greenfield tasks, blind Opus judge. Non-TDD ranked better; TDD cost 3-8.5x tokens; no mutation-score
  difference. Author stopped asking agents for test-first.
- **Spec tools on a real feature** ([Eretz Kdosha](https://ranthebuilder.cloud/blog/i-tested-three-spec-driven-ai-tools-here-s-my-honest-take/)):
  OpenSpec 4.0/5, BMAD Quick 3.74, BMAD Full 3.65, Spec Kit 2.77; none ready for enterprise unmodified.
- **Survey** ([Sakasegawa](https://nyosegawa.com/en/posts/coding-agent-workflow-2026/)): what matters is
  closing the feedback loop deterministically, humans at structured points, short sessions.

Takeaway for jig: process weight buys little measured quality and costs a lot; cheap deterministic
checks are the part every workflow benefits from. jig's own evals should measure cost and turns as well
as pass/fail, against a plain-Claude control, as these benchmarks do.
