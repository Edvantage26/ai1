# jig

**The jig for your coding agent: same cut, every time.**

In woodworking, a *jig* is the guide that holds the piece and leads the tool, so every cut comes out
the same no matter who makes it. `jig` does that for coding agents (Claude Code first): it holds the
repo in place with guardrails, makes the agent prove its work before calling it done, and keeps what
it learns in the repo instead of in a chat that disappears.

> **Status: early (v0.10.0).** Per-repo features, the `okf` feature (project knowledge) and the
> `danger` guard work, are tested and verified in real sessions. The `lanes`, `design`, `verify` and
> `rfc` features are new and tested, not yet tried in live sessions. Everything marked *planned* does not exist yet.

## Why

Agents are good at writing code and bad at three things:

1. **Remembering.** Every session starts from zero, so they guess, and a plausible guess is worse
   than an obvious error.
2. **Respecting rules.** A rule written in `CLAUDE.md` is a suggestion. The agent can forget it
   mid-session.
3. **Proving they are done.** "It should work now" is not evidence.

Hand-made fixes end up as a pile of loose skills, hooks and instructions with no owner. `jig` gives
that pile a fixed shape.

## The shape: four pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **Memory** | Project knowledge the agent reads before working and updates after | The repo, as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle (`.okf/`) |
| **Hands** | Tools the agent can use (CLIs, MCP servers), each with a connection test | The repo |
| **Trade** | Skills: how work is done (method) and what the domain needs (project) | Method in `jig`, domain in the repo |
| **Reflexes** | Hooks that enforce rules even when the agent forgets them | `jig` |

## Generic frame, project content

`jig` is generic because it only ships the frame. Each repo describes itself in one file,
`.claude/jig.json`, and the same hooks behave correctly everywhere:

```json
{
  "$schema": "https://raw.githubusercontent.com/Edvantage26/jig/main/schema/jig.schema.json",
  "version": 1,
  "features": { "okf": true, "danger": true },
  "trunk": "main",
  "verify": ["npm test"],
  "knowledge": ".okf",
  "modules": {
    "danger": { "ignore_rules": [] }
  }
}
```

Without this file jig stays inactive (the session start only mentions `/jig:init`). If the file is
invalid (wrong types), jig stays inactive and tells the agent why at session start. Names your jig
version does not know yet (a feature added in a newer release) are ignored with a warning; the rest
of jig keeps working.

| Level | Examples | Lives in |
|---|---|---|
| Generic as is | Destructive-command guard, no `--no-verify`, secret scan, "verify before done" | `jig` |
| Generic with config | Verification command, what counts as production, trunk branch | `jig` + `jig.json` |
| Specific | Knowledge, domain skills, MCP servers | The repo |

### Features

Each repo picks its features; you do not need to write the file by hand:

```text
/jig:init
```

asks which features to enable and writes `.claude/jig.json` and `.claude/settings.json` (it
runs the `jig` CLI, so the result is merged and validated, not improvised).

| Feature | Default | What it does |
|---|---|---|
| `okf` | on | Project knowledge in an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle: loads its index at session start, asks to update it when the session changed files or saved memories after its last update, and ships the OKF toolkit (`/jig:okf`, `/jig:validate`, `/jig:visualize`, `/jig:backfill`) |
| `danger` | on | Confirms or refuses commands that destroy work or data |
| `craft` | on | Gives the agent the rules for orderly code: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed (not applied) when it sees duplication or dead code, self-explanatory names. Where things live (layout, how to add each kind of piece, reusable helpers) goes in the OKF bundle |
| `design` | off | For repos with a frontend. At session start: read the product and design-system context (OKF concepts of type `Product` / `DesignSystem`, or Impeccable's `PRODUCT.md` / `DESIGN.md`), avoid the generic AI look, keep a quality floor. After every edit to a UI file, 26 deterministic rules (overused fonts, purple gradients, glows, gradient text, low contrast, skipped headings, tiny text, placeholder images...) report what that edit introduced. Points to [Impeccable](https://github.com/pbakaus/impeccable) commands when it is installed |
| `verify` | on | You cannot get a "done" while code changed after the last passing run of the `verify` commands (run in full: a filtered run does not count). Docs and harness config are exempt. `jig verify` runs them; `jig step-done` logs a deep-lane step only when they pass |
| `lanes` | off | Sizes each task: quick ones are done directly, medium ones get a short plan, complex or risky ones get questions and a design (`/jig:deep`) that you approve before any code is edited. Restores progress after a compaction |
| `rfc` | off | Proposals for large changes and future features, not decided yet, in `docs/rfc/NNNN-<slug>.md` (versioned, apart from the knowledge bundle because a proposal is not the system). Two sizes: a one-page *idea* and a *full* RFC (criteria before options, "do nothing" always an option, assumptions, phases, how to resume). Open RFCs listed at session start and related ones recalled on each message; when an RFC is accepted, a hook asks for its decisions to be recorded in the OKF bundle. `/jig:rfc`, `jig rfc new\|set\|index\|check` |

With `rfc` on, an idea goes: `jig rfc new <slug> --idea` (next number, index updated) → it grows into
a full RFC when it is about to be decided → `jig rfc set <n> accepted` and its decisions become OKF
concepts that cite it → built (with `lanes`, a deep plan with `rfc: <n>`) → `jig rfc set <n> implemented`.

With `lanes` on, a deep task goes: questions → design in `.jig/work/<slug>/plan.md` (git-ignored) →
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
| `/jig:deep`: questions, design, builder check, approval, step-by-step build | lanes | — | works |
| `design-brief`: UI rules and the design context files at session start | design | SessionStart | works |
| `design-detect`: design rules on every edited UI file, findings of that edit only, once per session (`modules.design-detect.ignore_rules`) | design | PostToolUse | works |
| `rfc-brief`: where RFCs live, that they are not the system, and the open ones | rfc | SessionStart | works |
| `rfc-recall`: on every message, points the agent to the related RFCs, labelled with their status | rfc | UserPromptSubmit | works |
| `rfc-upkeep`: when the session touched `docs/rfc/`, checks numbering, statuses, the index and that accepted RFCs are cited by the bundle; asks to mark an RFC implemented when its deep plan is done | rfc | Stop | works |
| `/jig:rfc`: write, resume, accept or reject an RFC and carry its decisions to the bundle | rfc | — | works |
| `/jig:init` + `jig` CLI (`jig status`, `jig init`, `jig verify`, `jig step-done`, `jig rfc`) | — | — | works |
| OKF toolkit skills and agents (from `packs/okf`) | okf | — | works |
| `prod`: blocks writes to production resources declared in `jig.json` | prod | PreToolUse | planned |
| `secrets`: refuses committing secrets | secrets | PreToolUse | planned |
| `verify-gate`: no "done" while code is newer than the last passing run of `verify` | verify | Stop | works |
| `jig doctor`, method skills (`ftd`, `review`) and a finding verifier | — | — | planned |

### How it works

Every hook event calls one entry point, `bin/jig-hook.mjs`. It loads `.claude/jig.json`, runs the
modules of the enabled features for that event, and combines their decisions (refuse > ask > allow).
A module is one file with `{ id, event, feature, run() }`; adding one does not touch the hook
wiring. Internal errors never block the agent; a matched rule does.

Requirements: **Node 18+** (hooks and the `jig` CLI) and **Python 3.9+** (the OKF toolkit scripts),
nothing else: no `uv`, no `pip install`, no network. PyYAML ships inside the plugin
(`packs/okf/vendor/`). Python 3.9+ comes with most Linux distributions and with the macOS
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
/plugin marketplace add Edvantage26/jig
/plugin install jig@jig
```

Then run `/jig:init` in each repo. It commits nothing; commit `.claude/jig.json` and
`.claude/settings.json` yourself. The project settings enable jig for everyone who opens the repo:

```json
{
  "extraKnownMarketplaces": {
    "jig": { "source": { "source": "github", "repo": "Edvantage26/jig" } }
  },
  "enabledPlugins": { "jig@jig": true }
}
```

If you already use a standalone OKF plugin (`okf@...`), `jig init` disables it for you in that repo,
in `.claude/settings.local.json` (personal, git-ignored), so the OKF skills are not listed twice.

## Credits

The design draws on ideas from [Superpowers](https://github.com/obra/superpowers) (methodology as
skills, verification before completion) and [rsc-harness](https://github.com/ericrisco/rsc-harness)
(memory/hands/trade/reflexes, work lanes, refuting reviewers). Both are MIT licensed. No code from
them is included.

The `design` feature takes its rule ids and the idea of a deterministic design detector run as a
hook from [Impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus (Apache 2.0). The
checks are written from scratch for source text; no code from it is included.

The OKF toolkit in `packs/okf/` is a git subtree of
[Edvantage26/okf-skills](https://github.com/Edvantage26/okf-skills), a fork of
[scaccogatto/okf-skills](https://github.com/scaccogatto/okf-skills) by Marco Boffo (MIT). Its
`LICENSE`, `NOTICE` and `FORK.md` are kept in that folder; the OKF specification it vendors is
(c) Google LLC under Apache 2.0.

## License

[MIT](LICENSE)
