---
type: Decision
title: Prior art - take ideas, not code
description: What was reviewed before designing ai1, what was taken from each, and what the community says about it.
tags: [decision, prior-art]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T14:59:15Z'
---

First review on 2026-10-30 by reading the repositories.

| Project | What it is | Taken | Left out |
|---|---|---|---|
| [Superpowers](https://github.com/obra/superpowers) v7.0.1 | 14 method skills + one SessionStart hook | Verification before completion, fresh implementer + separate reviewer, "red flags" tables against rationalization, evals of skills | Enforcement is prompt-only; forced brainstorming on every task |
| [rsc-harness](https://github.com/ericrisco/rsc-harness) v3.6.0 (MIT) | Meta-harness: memory/hands/trade/reflexes, lanes Answer / FTD (Fast-Track Development) / ASDD (Agent Spec-Driven Development), hooks, 269 skills | The four pieces, lanes, tools with connection tests, refuting finding-verifier, OKF as memory | Auto-update from npm every session, grants `git commit`/`git push` without asking, ~56k lines of skills |
| [andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills) | One CLAUDE.md with four rules against common LLM coding mistakes: think before coding, simplicity first, surgical changes, goal-driven execution | Simplicity first and surgical changes, in the [craft feature](/features/craft.md) | Think before coding and goal-driven execution: already covered by lanes and the verify gate |
| [Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0, Paul Bakaus; reviewed 2026-11-08) | Design skill for coding agents: one `/impeccable` skill with ~24 commands (critique, audit, polish...), `PRODUCT.md`/`DESIGN.md` context, and a deterministic anti-pattern detector (62 rules, Rust) run as a hook, CLI and browser extension | The detector-as-hook idea and rule ids, re-implemented for source text, and the product/design context (as OKF concepts) in the [design feature](/features/design.md) | The command set and its reference texts: install Impeccable for those; ai1 points to it when present |
| [rsc-factory](https://github.com/gregoryjp/rsc-factory) (unofficial) | PRD-to-product engine outside the agent | Risk classifier idea (auto vs human PR) for a future pipeline mode | Whole engine: out of scope |
| [graphify](https://github.com/gmh5225/graphify) (reviewed 2026-11-09 from its docs and third-party reviews, not its code) | `/graphify` skill: tree-sitter code graph + LLM pass over docs/PDFs/images into `graphify-out/` (`graph.json`, `GRAPH_REPORT.md`, `graph.html`), Leiden clusters, EXTRACTED/INFERRED/AMBIGUOUS edges, PreToolUse nudge on Grep/Glob, MCP server, git hooks | Nothing yet; see [graphify review](#graphify-review-2026-11-09) | The LLM semantic pass (the OKF bundle covers it, curated), Python + native deps, git hooks, a committed `graph.json` |

No code is copied at this stage; if any is, it keeps its license notice and attribution.

# Superpowers deep review (v7.0.2, 2026-11-08)

Whole repo read, including `RELEASE-NOTES.md` and `docs/superpowers/specs/`. Its value for ai1 is the
measured failures of prompt-only enforcement, each one a gap a hook can close:

- **Compaction drops rules.** Claude Code re-attaches an invoked skill truncated at 20,000 chars; SDD
  lost its 5-round fix cap and ran 18 rounds; one session made 269 dispatches for ~22 tasks. Their fix:
  an on-disk ledger plus a test failing any `SKILL.md` ≥ 20 KB.
- **Wording.** Token tripwires and recognition tables work; prohibitions on what to write do worse than
  no guidance; a positive recipe works best; shortest phrasing wins. Applies to ai1's block reasons.
- **Cheapen mechanics, never judgment.** Haiku reviewers caught 0/10 planted defects.
- **Review loops churn** unless the re-review is scoped to the findings and capped.
- **Prompt cache.** Changing injected text between prompts rewrote the cache in 83% of sessions.
- Full-suite rule: in 11/12 probe runs the agent ran only the named test file.
- `executing-plans/scripts/task-done` records "task complete" only on exit 0: evidence the agent cannot write.

Candidate ideas, mapped to the [roadmap](../roadmap.md): `verify` Stop gate on "edit after the last
verify run" (scan as in `okf-upkeep`), test-weakening detector, fix-loop counters in a hook, ledger
re-injection on `compact`, reviewer contract (merge-base range, read-only, "declined to judge" list),
`review-package`/`task-brief` scripts, `ai1 doctor --session` (deterministic transcript diagnosis),
opt-in `claude -p --output-format stream-json` evals. Small gaps found in ai1: `danger` misses
`git worktree remove --force` (closed 2026-11-08 with the [worktrees feature](../features/worktrees.md)); `okf-index` re-injects on `resume`; the `/ai1:core-setup-repo` description
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
That is ai1's `verify` gate plus test-weakening detection, independent of the chosen workflow.

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

Takeaway for ai1: process weight buys little measured quality and costs a lot; cheap deterministic
checks are the part every workflow benefits from. ai1's own evals should measure cost and turns as well
as pass/fail, against a plain-Claude control, as these benchmarks do.

# Worktrees (2026-11-08)

Reviewed before the [worktrees feature](../features/worktrees.md):

- **Claude Code native** (`claude -w`, `EnterWorktree`, subagent `isolation: worktree`): worktrees in
  `.claude/worktrees/`, `.worktreeinclude` copies gitignored files, isolation checks block edits and
  git aimed at the main checkout, exit asks before deleting work. A `WorktreeCreate` hook replaces
  creation entirely (losing the sweep marker, PR refs and `.worktreeinclude`). Hooks get the worktree
  in `cwd` while `CLAUDE_PROJECT_DIR` stays at the launch checkout. No modes, ports or recipe.
- **Superpowers** `using-git-worktrees` / `finishing-a-development-branch`: detect state with
  `git-dir` vs `git-common-dir` (plus a submodule guard), consent first, native tool before
  `git worktree add` (naming the tools took compliance from 2/6 to 50/50), provenance-based cleanup,
  never `--force`. Per-worktree env, ports and path hooks explicitly deferred.
- **Worktrunk** (`.config/wt.toml`): hooks per event, `hash_port` (stable port per branch),
  `copy-ignored`, copy-on-write build caches, one-command merge.
- **git-worktree-runner** (`.gtrconfig`): copy include/exclude of files and folders, `postCreate`,
  `trust` before running repo-defined commands.
- **A private per-project skill** (~1,500 lines + tests): light/full/source-only via sparse-checkout,
  read-only dependency cache per version linked into each worktree, `writable` escape hatch, isolated
  build outputs, build slots and locks, finish with knowledge checks, drop with a bundle, reminder hook.

Taken: state detection from git metadata, consent and one-line proposal, native `EnterWorktree` to
enter, `.worktreeinclude` support, a stable port per name, copy-on-write when available, checks
before integrating, bundle on drop, never force. ai1's own: a recipe planned with the person and saved
as a project skill, mode chosen by free disk on each machine, a tree root and a shared root in hooks.
Measured on the way: `git worktree remove` without `--force` deletes ignored files silently; a
symlink over a tracked path shows it as deleted and `commit -a` removes it.

# graphify review (2026-11-09)

Popular on GitHub, little independent evaluation (HN submission: 3 points, no comments). Findings:

- **Solid part:** the deterministic tree-sitter extraction (~23 languages, no LLM).
- **Weak parts:** the LLM pass is not reproducible and overwrites AST nodes on id collision; inferred
  edges let an agent describe code paths that do not exist; the graph goes stale between rebuilds; the
  native tree-sitter binding broke the whole tool on Apple Silicon; Leiden needs Python < 3.13 and falls
  back to Louvain silently; no reproducible test suite, untagged fast-moving releases.
- **Token claims are the vendor's:** 71.5x comes from one curated 52-file corpus against "read every
  file" and excludes build cost; third-party estimates: little gain under ~100 files, 6-15x at 100-500,
  30x+ above 500.
- **Overlap with ai1:** `graph.html` ≈ [/ai1:okf-visualize-bundle](../features/okf.md), the nudge ≈
  `okf-recall`/`okf-file-context`, file → node ≈ `okf-file-map`, confidence tags ≈ OKF v0.2 trust and
  provenance.
- **Ruled out for ai1:** embedding graphify or its LLM pass; a function-level call graph built in
  ai1 (an LSP resolves it exactly); git hooks to rebuild.
- **Still open:** a zero-dependency module (import) graph in Node, as a cache like `okf-file-map`, not
  as bundle concepts. Not decided.

Sources: [Pantheon analysis](https://pantheon-org.github.io/agentic-context/analysis/graphify/),
[explainx.ai](https://explainx.ai/blog/graphify-codebase-knowledge-graph-skill-claude-code-cursor-codex-trending-2026),
[RoboRhythms](https://www.roborhythms.com/graphify-review/).

# Skills and hook packs survey (2026-11-09)

Web survey of popular skills and plugins, read from READMEs, not code. Most skills are domain skills
(documents, frameworks, marketing), out of ai1's scope; the useful part is hook packs.

- **[karanb192/claude-code-hooks](https://github.com/karanb192/claude-code-hooks)** (MIT, JS, ~580 stars):
  `protect-tests` (block deleting, renaming or disabling tests), `config-guard` (block edits to guardrail
  config and hooks), `protect-secrets` (no reads of `.env`, SSH keys, credentials), `subagent-spawn-cap`
  (warn at 20, deny at 60 per session), `dead-end-registry` (warn before retrying a reverted approach),
  `instructions-audit` (hidden directives in CLAUDE.md), `dead-rules-audit` (CLAUDE.md rule compliance).
- **[agent-guard](https://github.com/hahahahahahahahah6/agent-guard)** (MIT, Python stdlib, 0 stars,
  178 tests): test-tampering at Stop (hash snapshot at SessionStart; tests changed with no source
  changed), regex "tamper shapes" on added test text (weakened asserts, skip/only, mocking the subject,
  RNG or time patching, snapshot updates), and a **cross-tool write guard**: Bash writes (`sed -i`,
  `tee`, heredocs, `cp`/`mv`) bypass any Edit/Write hook.
- **Anthropic `security-guidance`** (official, 2026-05-27): deterministic scan of ~25 insecure code
  patterns on Edit/Write, extensible with `.claude/security-patterns.yaml`. Insecure code, not secret
  files: no overlap with a `secrets` guard. Point to it when present, as with Impeccable.
- Covered already, left out: planning-with-files and handoff skills (lanes `plan.md`, compaction
  restore, brief fork); `code-review` and `skill-creator` (official, point to them);
  [trailofbits/skills](https://github.com/trailofbits/skills) (security research domain).

Gaps found in ai1 (checked in `src/`): nothing guards `.ai1/config.json`, `.claude/settings.json` or
the hooks against the agent switching its own rules off; no test-weakening detector yet. Bash writes
are already handled: the Stop checks (`okf-upkeep`, `verify-gate`) judge by git and mtimes, and
`src/core/shell-writes.mjs` feeds `session-writes`, `lanes-gate` and the bundle-edit count; only the
PostToolUse checks matched on Read/Edit/Write (`okf-file-context`) miss a file written by Bash.
`dead-end-registry` (keyword recall of reverted approaches from a JSONL outside the repo) is covered by
OKF: Decision concepts and per-concept "ruled out" notes, the upkeep reminder's "what was ruled out",
recall by message and by file; the only miss is a short try-and-revert that leaves no diff and fewer
than 10 investigation steps. Built on 2026-11-09 (v0.21.0): config guard, test-weakening guard, repo
rules, credential deny rules and a decision log, see [harness guards](harness-guards.md). Still
candidates, not decided: a subagent cap and a systematic-debugging method skill. The short
try-and-revert gap was closed the same day by okf-upkeep's reminder for attempts undone in the session.

Checked against the code (2026-11-09; hooks.json has no PreToolUse matcher for Read, Grep, Glob, Agent or Task):

| Idea | In ai1 | Gap |
|---|---|---|
| config-guard | no (built 2026-11-09) | `danger` reads `ignore_rules` from `.ai1/config.json`, which the agent can edit; nothing guards it, `.claude/settings*.json` or `hooks/`; `verify-gate` ignores `.claude/**` and `.ai1/**`. `listShellWriteTargets` can be reused |
| protect-tests | partial (test-guard built 2026-11-09) | `verify-gate` needs a passing run, but nothing reads test content: a weakened suite passes |
| protect-secrets | no (deny rules in `ai1 init`, 2026-11-09) | needs a Read/Grep matcher and a parser of shell read targets |
| subagent cap | no | Agent/Task only mark "may write" in `session-writes` |
| instructions-audit | partial | `okf-claude-md-check` is the scanner to extend; no invisible-Unicode or `curl\|sh` checks |
| dead-rules-audit | no | `transcript-scan` could feed it, in `ai1 doctor --session` |

# Method skills survey (2026-11-09)

Read from READMEs. [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) (Every,
MIT): plan -> work -> review -> **compound**, learnings in `docs/solutions/` found by later plans - the same
loop as the OKF bundle with upkeep and recall. [Matt Pocock's skills](https://github.com/mattpocock/skills)
(MIT): `diagnosing-bugs`, `grill-with-docs` (glossary + ADRs), `handoff`, `tdd`, two-axis `code-review`,
and `retro` (environment fixes after sessions) - taken as the [retro](../features/retro.md) of the ai1 repo.
HumanLayer RPI: `research_codebase` -> `create_plan` -> `implement_plan` -> `validate_plan` (check the
implementation against the plan's criteria). Trail of Bits `differential-review` and `fp-check` (security
domain; `fp-check` is the "finding verifier" idea). Built the same day: the debugging method skill with
a fix-attempt counter hook (three sources converge on the same loop; [verify feature](../features/verify.md)).
Still a candidate, not decided: checking a deep plan against `progress.md` and the diff before `status: done`. Left out: strict TDD (3-8.5x tokens, no measured gain),
autonomous commit/push pipelines (`lfg`).

# Harness and memory projects (2026-11-09)

Read from source or READMEs by subagents; popularity from the GitHub API.

- **hookify** (official, Apache-2.0): regex rules as `.claude/hookify.<name>.local.md` (event, pattern
  or conditions, `warn|block`, body = message), re-read on each call; `/hookify` with no argument mines
  recent corrections. Idea: repo-declared block/warn rules through the `danger` engine, a skill drafting
  one from a correction after a yes.
- **ralph-loop** (official, Apache-2.0): Stop hook re-feeding the prompt until a self-declared
  `<promise>` or an iteration cap; state file keyed by session. `verify` is the deterministic version
  and already gives up after 2 blocks per situation. Nothing to take.
- **security-guidance** v2.0.18 adds an LLM diff review at Stop and an async reviewer on `git commit`,
  with environment kill switches per layer. Other official plugins overlap: `feature-dev` (deep lane),
  `claude-md-management` (`okf-tidy-claude-md`), `explanatory-output-style` (brief injection).
- **trailofbits/claude-code-config** (~2.1k stars, no license: ideas only): permission deny rules for
  credential paths and destructive commands, which bind Bash only under `/sandbox`; "hooks are
  guardrails, not walls". Idea: `/ai1:core-setup-repo` offers credential `Read`/`Edit` deny rules in
  `.claude/settings.json`, zero runtime cost.
- **Continuous-Claude v3** (MIT, ~3.9k stars, stale since 2026-01): ledgers, YAML handoffs written on
  PreCompact, Postgres + pgvector, embeddings, daemons, a headless Claude extracting learnings. Opposite
  of [principles](principles.md); lanes already restore plan progress after compaction.
- **claude-mem** (Apache-2.0, ~115k stars): every hook posts to a Bun worker whose observer LLM
  compresses activity into SQLite + Chroma, per machine; telemetry on by default; code readings report
  unbatched calls, no timeouts, shell injection. Its three-step progressive disclosure is what
  `okf-recall` already does (pointers only). Critique to answer with data: memory add-ons cost context.
- **claude-code-hooks-mastery** (~4k stars, no license): demo of all 13 hook events in `uv` Python.
  Ideas: an opt-in local JSONL log of hook decisions (module, decision, ms) for misfires and
  `/ai1:core-report-issue`; a PermissionRequest handler allowing commands already classified safe.

# Visual walkthroughs of UI changes (2026-11-09)

Reviewed from docs and posts (not code) for the planned walkthrough feature (`.ai1/work/walkthrough/plan.md`):
- **[ProofShot](https://github.com/belinwu/proofshot)**: CLI that records an agent's browser session and
  bundles screenshots, errors and video into `SUMMARY.md` + an HTML viewer for a human. Closest idea;
  aimed at proof of work, not at the user's view of a flow, and has no before/after.
- **Playwright HTML report / trace viewer**: static and shareable, but a debugging tool (actions, DOM,
  network), not a storyboard. Playwright's screencast is pitched as "agentic video receipts".
- **[Argos](https://argos-ci.com/blog/playwright-mcp-visual-testing)**: pixel diffs against baselines in
  CI; Playwright MCP itself has no baselines or diffing.
- Caveat (VISTA paper, cited by Argos): visual fidelity and functional correctness diverge, so a
  storyboard validates the flow as seen, not that it works.
- **Google Drive does not render HTML** (it downloads it or shows the source); it previews PDF and
  images, also on mobile. Anything for a file-sync destination should be a PDF.
