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
├── later/        changes not decided yet, noted down for later (committed)
└── work/         deep plans and progress (ignored by git)
```

Skills are named `/ai1:<module>-<what it does>`, e.g. `/ai1:okf-validate-bundle`.
A repo set up with the old name (`jig`: `.claude/jig.json`, `.okf/`, `docs/rfc/`, `.jig/work/`) is
moved to `.ai1/` by `/ai1:core-setup-repo`, with `git mv` so history follows.
Later renames migrate by themselves: when a new ai1 starts a session it runs its pending numbered
migrations on the repo and on your `~/.config/ai1/`, leaves the changes uncommitted and tells you what
changed (e.g. v0.32.0: `lanes` -> `sizing`, v0.33.0: `walkthrough` -> `storyboard`).

> **Status: early (v0.33.0).** Per-repo features, the `okf` feature (project knowledge) and the
> `danger` guard work, are tested and verified in real sessions. The `sizing`, `design`, `verify`,
> `later` and `worktrees` features, and the `config-guard`, `repo-rules` and `test-guard` modules,
> are new and tested, not yet tried in live sessions. Everything marked *planned* does not exist yet.

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
  "modules": {
    "danger": { "ignore_rules": [] }
  }
}
```

Without this file ai1 stays inactive (the session start only mentions `/ai1:core-setup-repo`). If the file is
invalid (wrong types), ai1 stays inactive and tells the agent why at session start. Names your ai1
version does not know yet (a feature added in a newer release) are ignored with a warning; the rest
of ai1 keeps working. The knowledge bundle is always `.ai1/okf/`; the former `knowledge` setting is
ignored (with a notice when it named another path) and `ai1 init` moves that bundle there.

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

reads the project and proposes a configuration: each feature on or off with the reason and the
evidence it found (a frontend turns design on, migrations or auth folders turn sizing on, a test
script becomes the verify command...). You adjust it, it writes `.ai1/config.json` and
`.claude/settings.json` (through the `ai1` CLI, so the result is merged and validated, not
improvised), and then offers each enabled feature's own setup: the worktree recipe, the knowledge
bundle, the design context.

| Feature | Default | What it does |
|---|---|---|
| `okf` | on | Project knowledge in an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle: loads its index at session start, points the agent to the concepts related to each message and to each file it reads or edits, asks to update it when the session changed files or saved memories after its last update, and ships the OKF toolkit (`/ai1:okf-maintain-knowledge`, `/ai1:okf-validate-bundle`, `/ai1:okf-visualize-bundle`, `/ai1:okf-backfill-from-history`), plus `/ai1:okf-tidy-claude-md` to move knowledge piled up in CLAUDE.md into the bundle |
| `danger` | on | Confirms or refuses commands that destroy work or data; asks you before the agent changes ai1's or Claude Code's configuration (so it cannot switch its own guards off); applies your repo's own rules (`rules` in `.ai1/config.json`, written with `/ai1:danger-write-rule`: "use pnpm", "never edit `generated/`"). In bypass and auto permission modes only the commands that lose work or data for good and your repo rules ask; the other asks let the call through |
| `craft` | on | Gives the agent the rules for orderly code: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed (not applied) when it sees duplication or dead code, self-explanatory names. Where things live (layout, how to add each kind of piece, reusable helpers) goes in the OKF bundle |
| `design` | off | For repos with a frontend. At session start: read the product and design-system context (OKF concepts of type `Product` / `DesignSystem`, or Impeccable's `PRODUCT.md` / `DESIGN.md`), avoid the generic AI look, keep a quality floor. After every edit to a UI file, 26 deterministic rules (overused fonts, purple gradients, glows, gradient text, low contrast, skipped headings, tiny text, placeholder images...) report what that edit introduced. Points to [Impeccable](https://github.com/pbakaus/impeccable) commands when it is installed |
| `storyboard` | off | For repos with a frontend. After a visual change the agent records the user flow as a storyboard you review without running the app: numbered steps in the user's words, desktop and mobile screenshots with what is clicked framed, before vs after (the base captured in a `<name>-before` worktree), new and removed steps marked. One self-contained `index.html` served at a local URL (`ai1 storyboard serve`, released when the worktree is finished or dropped) and a PDF (one step per page, printed with a local Chrome). Kept in `.ai1/storyboards/<slug>/`, ignored by git; link that folder wherever you like (a synced Drive folder) with your own tooling. Closing the change deletes the screenshots it left around the repo. A Stop reminder when UI files changed with no storyboard after them. Publishing (a PR, a task tracker) only through a skill customization and only after your yes. `/ai1:storyboard-record-flow`, `ai1 storyboard add\|build\|serve\|stop\|list\|clean`. Called `walkthrough` until v0.32 (migrated at session start) |
| `verify` | on | You cannot get a "done" while code changed after the last passing run of the `verify` commands (run in full: a filtered run does not count). Docs and harness config are exempt. Skipping, emptying, weakening or deleting tests, or changing the config of a check (lint, format, types), asks you first (`test-guard`); the same tool call 5 times in a row gets the agent a nudge (`tool-loop`); after 3 failed fix attempts in a row the agent is told to stop and find the root cause (`fix-loop`, `/ai1:verify-debug-systematically`). `/ai1:verify-evaluate-llm-prompts`: evaluate and improve an LLM step with evidence - start simple and stop if it is good enough; otherwise a small reference set, the cause of each failure before blaming the model, models or prompts compared as a tournament (few cases, drop losers, grow the set). `ai1 verify` runs them; `ai1 step-done` logs a deep step only when they pass; `ai1 plan-done` closes a plan |
| `sizing` | off | Sizes each task: quick ones are done directly, medium ones get a short plan the agent states and starts on (written to `.ai1/work/<slug>/plan.md`, `size: plan`, only when it has more than about 3 steps or may not finish in one go; no approval), complex or risky ones get questions and a design (`/ai1:sizing-design-before-code`) that you approve before any code is edited. Restores progress after a compaction. Called `lanes` until v0.31 (migrated at session start) |
| `later` | off | Large changes and future features, not decided yet, noted down for later in `.ai1/later/NNNN-<slug>.md` (versioned, apart from the knowledge bundle because they are not the system), each called by its number ("later 0003"). The agent notes one down only when you ask ("apúntalo para luego", "note it down for later"). When a clearly different, large subject comes up mid-task, it mentions it in one line at the end of its report with what it recommends (do it here, fork it into a new conversation, or note it down for later), without stopping to ask. "Propuesta"/"proposal" in the conversation always means the agent's own proposal, never this feature. Two sizes: a one-page *idea* and a *full* entry (criteria before options, "do nothing" always an option, assumptions, phases, how to resume). Open entries listed at session start and related ones recalled on each message; when one is accepted, a hook asks for its decisions to be recorded in the OKF bundle. `/ai1:later-write`, `ai1 later new\|set\|index\|check`. Called `rfc` until v0.17 and `proposals` until v0.24: `ai1 init` migrates `.ai1/rfc/`, `.ai1/proposals/` and the old feature ids |

With `later` on, an idea goes: `ai1 later new <slug> --idea` (next number, index updated) → it grows into
a full entry when it is about to be decided → `ai1 later set <n> accepted` and its decisions become OKF
concepts that cite it → built (with `sizing`, a deep plan with `later: <n>`) → `ai1 later set <n> implemented`.

| `worktrees` | off | Every change to the repo files is done in its own worktree, which the agent creates before the first edit, made the way your project needs. The first time, `/ai1:worktrees-plan-recipe` studies the repo (heavy folders, env files, ports, where builds write, existing worktree tools), proposes a recipe, and once you approve it saves it as the project skill `.claude/skills/worktree/` (`SKILL.md` + `recipe.json`, committed). Modes: `full`, `light` (heavy folders shared, regenerated or left out) and `auto`, which picks full when it fits on that machine's disk. Each worktree gets its env files and its own port; the agent keeps telling you which worktree it is working in. `ai1 worktree create\|list\|run\|finish\|drop` |

With `worktrees` on: `ai1 worktree create feat-x` → the agent enters it (EnterWorktree) and runs the
setup it prints → works and commits there, starting each progress report with the worktree's name →
when you say so, `ai1 worktree finish feat-x` brings in the base, runs the recipe's checks, fast-forwards
the base and removes the worktree (the `danger` guard asks you first). Shared read-only dependency
caches, build slots and a `WorktreeCreate` hook for very large repos are *planned*.

With `sizing` on, a deep task goes: questions → design in `.ai1/work/<slug>/plan.md` (git-ignored) →
you approve it with a plain "ok"/"aprobado" → step-by-step build with a progress log → `ai1 plan-done`.
The design carries 2-5 behaviour scenarios (`- S1: Given ..., when ..., then ...`, or `None - <why>`);
the test that covers one is tagged `[<slug>:S1]`, and `ai1 plan-done` closes the plan only when every
scenario has its tagged test and the verify commands pass. It checks that the test exists and the
suite is green, not that the test proves the scenario: that is your review. Until you
approve, a hook refuses code edits; if a "quick" task grows past 6 files or 300 lines, it asks you
once whether to stop for a plan (`modules.sizing-escalate.max_files` / `max_lines`).

### Customize a skill

ai1's skills come from the plugin, so you do not edit them; you add to them. When a skill loads it
prints its customization at the end, from two places:

- **this project**: `.ai1/skills/<feature>/overlay.md`, committed, for everyone on the repo
  (`<feature>` is the skill's prefix: `.ai1/skills/later/overlay.md` for `/ai1:later-write`);
- **you**: `~/.config/ai1/skills/<feature>/overlay.md` in every repo, and plugin options in `/config`
  (today **Fork opener**: where `/ai1:session-fork-conversation` opens new conversations - `auto`,
  `paseo`, `vscode`, `desktop`, `terminal`).

An overlay is a few markdown bullets. It adds to the skill but never overrides its **Fixed rules**;
where the two disagree, the project's wins over yours. When you correct how a skill works, the agent
offers once to save it; `/ai1:core-customize-skill` writes it after you approve the text, and changing
`.ai1/skills/` asks you first (`config-guard`). `ai1 skill-context --list` shows which skills can be
customized and what you have. Not customizable, with the reason in the list: the skills that protect
others or are deterministic (`core-report-issue`, `okf-validate-bundle`, `danger-write-rule`,
`core-customize-skill`) and `okf-backfill-from-history` (its subagents would not see it).

## Components

| Component | Feature | Event | Status |
|---|---|---|---|
| `brief`: tells the agent at session start which harness runs here | core | SessionStart | works |
| `okf-index`: loads the knowledge bundle index and its maintenance rules | okf | SessionStart | works |
| `okf-claude-md`: at session start, one line when the repo's CLAUDE.md drifts from the bundle (too long, sections that repeat a concept or hold knowledge no concept has, references that no longer exist), told once per set of findings; `ai1 claude-md` prints the report and `/ai1:okf-tidy-claude-md` proposes a short CLAUDE.md and the concept edits, applied after the person approves | okf | SessionStart | works |
| `okf-recall`: on every message, points the agent to the OKF concepts related to it | okf | UserPromptSubmit | works |
| `okf-file-context`: when the agent reads or edits a file, names the concept that describes it (from `resource`, `sources` and code paths in concepts) | okf | PostToolUse | works |
| `okf-upkeep`: asks to update the bundle after changes, new memories or a long run of investigation (findings, ways to validate, ways of working), and runs the OKF validator itself when the bundle changed, blocking only on errors | okf | Stop | works |
| `danger`: confirms or refuses `git reset --hard`, force push, `rm -rf`, `--no-verify`, `DROP TABLE`... | danger | PreToolUse | works |
| `config-guard`: asks you before the agent changes `.ai1/config.json`, `.claude/settings*.json`, `.claude/hooks/` or the skill overlays in `.ai1/skills/` (file tools or shell), in any worktree | danger | PreToolUse | works |
| `repo-rules` + `/ai1:danger-write-rule`: your repo's own ask/deny rules for shell commands and edits, from `rules` in `.ai1/config.json` | danger | PreToolUse | works |
| `test-guard`: asks you before tests are skipped, emptied, weakened or deleted, or an existing lint/format/type-check/test-runner config is changed (`modules.test-guard.test_paths` / `check_config_paths` / `ignore_rules`) | verify | PreToolUse | works |
| `tool-loop`: when the last 5 tool calls are the same call with the same input, tells the agent once to stop polling or retrying by hand (`modules.tool-loop.repeat_threshold`) | verify | PreToolUse | works |
| `fix-loop` + `/ai1:verify-debug-systematically`: counts failed fix attempts (a test still failing after an edit) and after 3 in a row tells the agent to stop patching, go back to the root cause and tell you; the skill is the method (cause first, one hypothesis, a failing test), customizable per project | verify | PostToolUse | works |
| `/ai1:verify-evaluate-llm-prompts`: evaluate and improve an LLM step (extraction, classification, judge) with evidence - start with a simple prompt on 10-20 real cases and stop if good enough; otherwise a small reference set and a pilot first; failures read one by one and labelled with a fixed cause list, the most frequent fixed first; models or prompts compared as a paired tournament that drops candidates while the set grows | verify | skill | works |
| Decision log + `ai1 log`: every module run logged locally (module, decision, ms, characters added, rules, error signatures; no commands or paths), off with `AI1_DECISION_LOG=0`; `ai1 log --all` for every repo on the machine | — | all | works |
| `issue-offer`: when ai1 itself fails in a repo (a module throws, the hook crashes), the agent offers once to report it with `/ai1:core-report-issue`; nothing is filed without your yes to the text, unless you chose automatic reports (`ai1 init --report-errors auto`: only versions and the error's module and plugin file:line are sent) | core | UserPromptSubmit | works |
| `craft-brief`: the code craft rules at session start | craft | SessionStart | works |
| `sizing-brief`: the sizing recipe at session start; restores deep progress after compaction | sizing | SessionStart | works |
| `sizing-approval`: records your approval of a deep design marked ready | sizing | UserPromptSubmit | works |
| `sizing-gate`: refuses code edits (tools and shell writes) while a deep design waits for approval, and closing by hand or dropping approved scenarios of a plan with behaviour scenarios | sizing | PreToolUse | works |
| `sizing-escalate`: asks once when a task without a plan outgrows a quick change | sizing | PreToolUse | works |
| `/ai1:sizing-design-before-code`: questions, design, builder check, approval, step-by-step build | sizing | — | works |
| `design-brief`: UI rules and the design context files at session start | design | SessionStart | works |
| `design-detect`: design rules on every edited UI file, findings of that edit only, once per session (`modules.design-detect.ignore_rules`) | design | PostToolUse | works |
| `storyboard-reminder`: when the session changed UI files and built no storyboard after them, asks once to record the flow or say why not (`modules.storyboard-reminder.ignore`) | storyboard | Stop | works |
| `/ai1:storyboard-record-flow` and `ai1 storyboard`: storyboard of the user flow (steps, screenshots, before/after), local URL, PDF, residual screenshots deleted on close | storyboard | — | works |
| `later-brief`: where later entries live, that they are not the system, that "propuesta" is never this feature, when to note one down, and the open ones | later | SessionStart | works |
| `later-recall`: on every message, points the agent to the related later entries, labelled with their status | later | UserPromptSubmit | works |
| `later-upkeep`: when the session touched `.ai1/later/`, checks numbering, statuses, the index and that accepted entries are cited by the bundle; asks to mark an entry implemented when its deep plan is done | later | Stop | works |
| `/ai1:later-write`: note down, resume, accept or reject a later entry and carry its decisions to the bundle | later | — | works |
| `worktree-brief`: worktree rules at session start, or a pointer to `/ai1:worktrees-plan-recipe` when the repo has no recipe; names the worktree the session is in | worktrees | SessionStart | works |
| `worktree-reminder`: the active worktrees when they change and every few prompts, marking this session's | worktrees | UserPromptSubmit | works |
| `worktree-recipe-offer`: when the repo has no recipe and the session changed files in the main checkout (shell edits too), asks once to offer `/ai1:worktrees-plan-recipe` | worktrees | Stop | works |
| `/ai1:worktrees-plan-recipe` + `ai1 worktree` (`create`, `list`, `run`, `finish`, `drop`) | worktrees | — | works |
| Shared read-only caches per dependency version, `writable`, build slots, `WorktreeCreate` hook for heavy repos | worktrees | — | planned |
| `/ai1:core-setup-repo` + `ai1` CLI (`ai1 status`, `ai1 init`, `ai1 verify`, `ai1 step-done`, `ai1 plan-done`, `ai1 later`, `ai1 worktree`, `ai1 fork`, `ai1 issue`, `ai1 claude-md`, `ai1 log`, `ai1 skill-context`) | — | — | works |
| Skill customization: project (`.ai1/skills/<feature>/overlay.md`) and personal (`~/.config/ai1/...`) overlays injected when a skill loads, Fixed rules that win, `/ai1:core-customize-skill`, `ai1 skill-context --list`; every skill is customizable or excluded with a reason (a test checks it) | — | — | works |
| `/ai1:session-fork-conversation` + `ai1 fork`: a new conversation from this one, `full` (a copy of the whole conversation) or `brief` (only a written handoff), opened natively in Paseo (an agent), VS Code (the extension URI), a terminal or Claude Desktop (the commands to open it); the **Fork opener** option in `/config` chooses where instead of detecting it. Needs no feature: works in any repo while the plugin is enabled | — | — | works |
| `/ai1:core-report-issue` + `ai1 issue`: report a problem with ai1 as an issue on this repo; gathers versions and features (`ai1 issue env`), writes a minimal reproduction without private paths, hosts, names or code, checks duplicates and creates it with `gh` (or a prefilled link, `ai1 issue url`) only after you approve the text. Needs no feature | — | — | works |
| OKF toolkit skills and agents (`skills/okf-*`, `agents/`) | okf | — | works |
| `prod`: blocks writes to production resources declared in `.ai1/config.json` | prod | PreToolUse | planned |
| Credential deny rules: `ai1 init --deny-credentials` (offered by the setup) adds Claude Code permission rules so the agent cannot read private keys and home credential stores (`.env` files are not included) | — | — | works |
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
command line tools (the ones that provide `git`); on Windows install it from python.org (ai1 tries
`python3`, `python` and `py -3`). Without Python the hooks still work: only the OKF bundle check is
off, and ai1 says so once per session.

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

It also hides from the agent the skills of the features you leave off (`skillOverrides`, set to
`user-invocable-only`): you can still call them with `/ai1:<skill>`, and the agent stops paying
context for them.

Some plugins do part of ai1's job: a standalone OKF plugin (`okf@...`, the same skills listed twice),
`jig@...` (ai1's old name, hooks twice) and Superpowers (`superpowers@...`, its session start forces
its own planning, worktree, TDD and verification skills on every task, competing with sizing,
worktrees and verify); `feature-dev@...` only gets a warning. `/ai1:core-setup-repo` lists the ones
you have enabled, says why each overlaps and asks which to disable in that repo only, in
`.claude/settings.local.json` (personal, git-ignored; `ai1 init --disable-plugins`). It disables
nothing you did not pick. While one that should be disabled stays enabled, the session start says so.

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
