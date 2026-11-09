# ai1

**All in one for your coding agent: guardrails, verification and project memory, set up per repo.**

`ai1` (*all in one*) gives coding agents (Claude Code first) one harness instead of a pile of loose
skills and hooks: it holds the repo in place with guardrails, makes the agent prove its work before
calling it done, and keeps what it learns in the repo instead of in a chat that disappears.
Everything it writes in a repo lives in one folder, `.ai1/`:

```
.ai1/
├── config.json   features and contract of the repo (committed)
├── okf/          project knowledge, an OKF bundle (committed)
├── rfc/          proposals not decided yet (committed)
└── work/         deep-lane plans and progress (ignored by git)
```

Skills are named `/ai1:<module>-<what it does>`, e.g. `/ai1:okf-validate-bundle`.
A repo set up with the old name (`jig`: `.claude/jig.json`, `.okf/`, `docs/rfc/`, `.jig/work/`) is
moved to `.ai1/` by `/ai1:core-setup-repo`, with `git mv` so history follows.

> **Status: early (v0.14.2).** Per-repo features, the `okf` feature (project knowledge) and the
> `danger` guard work, are tested and verified in real sessions. The `lanes`, `design`, `verify`,
> `rfc` and `worktrees` features are new and tested, not yet tried in live sessions. Everything marked *planned* does not exist yet.

## Why

Agents are good at writing code and bad at three things:

1. **Remembering.** Every session starts from zero, so they guess, and a plausible guess is worse
   than an obvious error.
2. **Respecting rules.** A rule written in `CLAUDE.md` is a suggestion. The agent can forget it
   mid-session.
3. **Proving they are done.** "It should work now" is not evidence.

Hand-made fixes end up as a pile of loose skills, hooks and instructions with no owner. `ai1` gives
that pile a fixed shape.

## The shape: four pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **Memory** | Project knowledge the agent reads before working and updates after | The repo, as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle (`.ai1/okf/`) |
| **Hands** | Tools the agent can use (CLIs, MCP servers), each with a connection test | The repo |
| **Trade** | Skills: how work is done (method) and what the domain needs (project) | Method in `ai1`, domain in the repo |
| **Reflexes** | Hooks that enforce rules even when the agent forgets them | `ai1` |

## Generic frame, project content

`ai1` is generic because it only ships the frame. Each repo describes itself in one file,
`.ai1/config.json`, and the same hooks behave correctly everywhere:

```json
{
  "$schema": "https://raw.githubusercontent.com/Edvantage26/ai1/main/schema/ai1.schema.json",
  "version": 1,
  "features": { "okf": true, "danger": true },
  "trunk": "main",
  "verify": ["npm test"],
  "knowledge": ".ai1/okf",
  "modules": {
    "danger": { "ignore_rules": [] }
  }
}
```

Without this file ai1 stays inactive (the session start only mentions `/ai1:core-setup-repo`). If the file is
invalid (wrong types), ai1 stays inactive and tells the agent why at session start. Names your ai1
version does not know yet (a feature added in a newer release) are ignored with a warning; the rest
of ai1 keeps working.

| Level | Examples | Lives in |
|---|---|---|
| Generic as is | Destructive-command guard, no `--no-verify`, secret scan, "verify before done" | `ai1` |
| Generic with config | Verification command, what counts as production, trunk branch | `ai1` + `.ai1/config.json` |
| Specific | Knowledge, domain skills, MCP servers | The repo |

### Features

Each repo picks its features; you do not need to write the file by hand:

```text
/ai1:core-setup-repo
```

asks which features to enable and writes `.ai1/config.json` and `.claude/settings.json` (it
runs the `ai1` CLI, so the result is merged and validated, not improvised).

| Feature | Default | What it does |
|---|---|---|
| `okf` | on | Project knowledge in an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle: loads its index at session start, asks to update it when the session changed files or saved memories after its last update, and ships the OKF toolkit (`/ai1:okf-maintain-knowledge`, `/ai1:okf-validate-bundle`, `/ai1:okf-visualize-bundle`, `/ai1:okf-backfill-from-history`) |
| `danger` | on | Confirms or refuses commands that destroy work or data |
| `craft` | on | Gives the agent the rules for orderly code: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed (not applied) when it sees duplication or dead code, self-explanatory names. Where things live (layout, how to add each kind of piece, reusable helpers) goes in the OKF bundle |
| `design` | off | For repos with a frontend. At session start: read the product and design-system context (OKF concepts of type `Product` / `DesignSystem`, or Impeccable's `PRODUCT.md` / `DESIGN.md`), avoid the generic AI look, keep a quality floor. After every edit to a UI file, 26 deterministic rules (overused fonts, purple gradients, glows, gradient text, low contrast, skipped headings, tiny text, placeholder images...) report what that edit introduced. Points to [Impeccable](https://github.com/pbakaus/impeccable) commands when it is installed |
| `verify` | on | You cannot get a "done" while code changed after the last passing run of the `verify` commands (run in full: a filtered run does not count). Docs and harness config are exempt. `ai1 verify` runs them; `ai1 step-done` logs a deep-lane step only when they pass |
| `lanes` | off | Sizes each task: quick ones are done directly, medium ones get a short plan, complex or risky ones get questions and a design (`/ai1:lanes-design-before-code`) that you approve before any code is edited. Restores progress after a compaction |
| `rfc` | off | Proposals for large changes and future features, not decided yet, in `.ai1/rfc/NNNN-<slug>.md` (versioned, apart from the knowledge bundle because a proposal is not the system). Two sizes: a one-page *idea* and a *full* RFC (criteria before options, "do nothing" always an option, assumptions, phases, how to resume). Open RFCs listed at session start and related ones recalled on each message; when an RFC is accepted, a hook asks for its decisions to be recorded in the OKF bundle. `/ai1:rfc-write-proposal`, `ai1 rfc new\|set\|index\|check` |

With `rfc` on, an idea goes: `ai1 rfc new <slug> --idea` (next number, index updated) → it grows into
a full RFC when it is about to be decided → `ai1 rfc set <n> accepted` and its decisions become OKF
concepts that cite it → built (with `lanes`, a deep plan with `rfc: <n>`) → `ai1 rfc set <n> implemented`.

| `worktrees` | off | Each significant change is done in its own git worktree, made the way your project needs. The first time, `/ai1:worktrees-plan-recipe` studies the repo (heavy folders, env files, ports, where builds write, existing worktree tools), proposes a recipe, and once you approve it saves it as the project skill `.claude/skills/worktree/` (`SKILL.md` + `recipe.json`, committed). Modes: `full`, `light` (heavy folders shared, regenerated or left out) and `auto`, which picks full when it fits on that machine's disk. Each worktree gets its env files and its own port; the agent keeps telling you which worktree it is working in. `ai1 worktree create\|list\|run\|finish\|drop` |

With `worktrees` on: `ai1 worktree create feat-x` → the agent enters it (EnterWorktree) and runs the
setup it prints → works and commits there, starting each progress report with the worktree's name →
when you say so, `ai1 worktree finish feat-x` brings in the base, runs the recipe's checks, fast-forwards
the base and removes the worktree (the `danger` guard asks you first). Shared read-only dependency
caches, build slots and a `WorktreeCreate` hook for very large repos are *planned*.

With `lanes` on, a deep task goes: questions → design in `.ai1/work/<slug>/plan.md` (git-ignored) →
you approve it with a plain "ok"/"aprobado" → step-by-step build with a progress log. Until you
approve, a hook refuses code edits; if a "quick" task grows past 6 files or 300 lines, it asks you
once whether to stop for a plan (`modules.lanes-escalate.max_files` / `max_lines`).

## Components

| Component | Feature | Event | Status |
|---|---|---|---|
| `brief`: tells the agent at session start which harness runs here | core | SessionStart | works |
| `okf-index`: loads the knowledge bundle index and its maintenance rules | okf | SessionStart | works |
| `okf-recall`: on every message, points the agent to the OKF concepts related to it | okf | UserPromptSubmit | works |
| `okf-upkeep`: asks to update the bundle after changes, new memories or a long run of investigation (findings, ways to validate, ways of working), and runs the OKF validator itself when the bundle changed, blocking only on errors | okf | Stop | works |
| `danger`: confirms or refuses `git reset --hard`, force push, `rm -rf`, `--no-verify`, `DROP TABLE`... | danger | PreToolUse | works |
| `craft-brief`: the code craft rules at session start | craft | SessionStart | works |
| `lanes-brief`: the lane recipe at session start; restores deep-lane progress after compaction | lanes | SessionStart | works |
| `lanes-approval`: records your approval of a deep-lane design marked ready | lanes | UserPromptSubmit | works |
| `lanes-gate`: refuses code edits (tools and shell writes) while a deep design waits for approval | lanes | PreToolUse | works |
| `lanes-escalate`: asks once when a task without a plan outgrows a quick change | lanes | PreToolUse | works |
| `/ai1:lanes-design-before-code`: questions, design, builder check, approval, step-by-step build | lanes | — | works |
| `design-brief`: UI rules and the design context files at session start | design | SessionStart | works |
| `design-detect`: design rules on every edited UI file, findings of that edit only, once per session (`modules.design-detect.ignore_rules`) | design | PostToolUse | works |
| `rfc-brief`: where RFCs live, that they are not the system, and the open ones | rfc | SessionStart | works |
| `rfc-recall`: on every message, points the agent to the related RFCs, labelled with their status | rfc | UserPromptSubmit | works |
| `rfc-upkeep`: when the session touched `.ai1/rfc/`, checks numbering, statuses, the index and that accepted RFCs are cited by the bundle; asks to mark an RFC implemented when its deep plan is done | rfc | Stop | works |
| `/ai1:rfc-write-proposal`: write, resume, accept or reject an RFC and carry its decisions to the bundle | rfc | — | works |
| `worktree-brief`: worktree rules at session start, or a pointer to `/ai1:worktrees-plan-recipe` when the repo has no recipe; names the worktree the session is in | worktrees | SessionStart | works |
| `worktree-reminder`: the active worktrees when they change and every few prompts, marking this session's | worktrees | UserPromptSubmit | works |
| `/ai1:worktrees-plan-recipe` + `ai1 worktree` (`create`, `list`, `run`, `finish`, `drop`) | worktrees | — | works |
| Shared read-only caches per dependency version, `writable`, build slots, `WorktreeCreate` hook for heavy repos | worktrees | — | planned |
| `/ai1:core-setup-repo` + `ai1` CLI (`ai1 status`, `ai1 init`, `ai1 verify`, `ai1 step-done`, `ai1 rfc`, `ai1 worktree`, `ai1 fork`) | — | — | works |
| `/ai1:session-fork-conversation` + `ai1 fork`: a new conversation from this one, `full` (a copy of the whole conversation) or `brief` (only a written handoff), opened natively in Paseo (an agent), VS Code (the extension URI), a terminal or Claude Desktop (the commands to open it). Needs no feature: works in any repo while the plugin is enabled | — | — | works |
| OKF toolkit skills and agents (`skills/okf-*`, `agents/`) | okf | — | works |
| `prod`: blocks writes to production resources declared in `.ai1/config.json` | prod | PreToolUse | planned |
| `secrets`: refuses committing secrets | secrets | PreToolUse | planned |
| `verify-gate`: no "done" while code is newer than the last passing run of `verify` | verify | Stop | works |
| `ai1 doctor`, method skills (`ftd`, `review`) and a finding verifier | — | — | planned |

### How it works

Every hook event calls one entry point, `bin/ai1-hook.mjs`. It loads `.ai1/config.json`, runs the
modules of the enabled features for that event, and combines their decisions (refuse > ask > allow).
A module is one file with `{ id, event, feature, run() }`; adding one does not touch the hook
wiring. Internal errors never block the agent; a matched rule does.

Requirements: **Node 18+** (hooks and the `ai1` CLI) and **Python 3.9+** (the OKF toolkit scripts),
nothing else: no `uv`, no `pip install`, no network. PyYAML ships inside the plugin
(`vendor/`). Python 3.9+ comes with most Linux distributions and with the macOS
command line tools (the ones that provide `git`).

## Development

```bash
npm test                                  # node:test, no dependencies
claude --plugin-dir . -p "..."            # try the plugin in a real session without installing it
claude plugin validate .
```

## Principles

- **Mechanisms over prompts.** If a rule matters, a hook enforces it.
- **Friction proportional to risk.** Silence for the trivial, ceremony only where failure is
  expensive.
- **Evidence before claims.** Work is done when a command shows it, not when the agent says so.
- **No surprises on your machine.** Hooks are plain, readable scripts. No network calls, no
  auto-update, and no permission to commit or push on your behalf.

## Install

```text
/plugin marketplace add Edvantage26/ai1
/plugin install ai1@ai1
```

Then run `/ai1:core-setup-repo` in each repo. It commits nothing; commit `.ai1/config.json` and
`.claude/settings.json` yourself. The project settings enable ai1 for everyone who opens the repo:

```json
{
  "extraKnownMarketplaces": {
    "ai1": { "source": { "source": "github", "repo": "Edvantage26/ai1" } }
  },
  "enabledPlugins": { "ai1@ai1": true }
}
```

If you already use a standalone OKF plugin (`okf@...`), `ai1 init` disables it for you in that repo,
in `.claude/settings.local.json` (personal, git-ignored), so the OKF skills are not listed twice.

## Credits

The design draws on ideas from [Superpowers](https://github.com/obra/superpowers) (methodology as
skills, verification before completion) and [rsc-harness](https://github.com/ericrisco/rsc-harness)
(memory/hands/trade/reflexes, work lanes, refuting reviewers). Both are MIT licensed. No code from
them is included.

The `design` feature takes its rule ids and the idea of a deterministic design detector run as a
hook from [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (Apache 2.0). The
checks are written from scratch for source text; no code from it is included.

The OKF toolkit (`skills/okf-*`, `agents/`) comes from
[scaccogatto/okf-skills](https://github.com/scaccogatto/okf-skills) by Marco Boffo (MIT) and is
maintained in this repo; the OKF specification it includes is (c) Google LLC under Apache 2.0.
Licenses and notices: [THIRD-PARTY.md](THIRD-PARTY.md).

## License

[MIT](LICENSE)
