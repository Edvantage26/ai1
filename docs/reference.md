# ai1 reference

Everything ai1 does, in detail. Start with the [README](../README.md) for what ai1 is, how to install
it and the list of skills.

- [The shape: four pieces](#the-shape-four-pieces)
- [Generic frame, project content: `.ai1/config.json`](#generic-frame-project-content-ai1configjson)
- [Features](#features)
- [Customize a skill](#customize-a-skill)
- [Hooks](#hooks)
- [How the hooks run](#how-the-hooks-run)
- [Install in detail](#install-in-detail)

## The shape: four pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **Memory** | Project knowledge the agent reads before working and updates after | The repo, as an [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle (`.ai1/okf/`) |
| **Hands** | Tools the agent can use (CLIs, MCP servers), each with a connection test | The repo |
| **Trade** | Skills: how work is done (method) and what the domain needs (project) | Method in `ai1`, domain in the repo |
| **Reflexes** | Hooks that enforce rules even when the agent forgets them | `ai1` |

## Generic frame, project content: `.ai1/config.json`

`ai1` is generic because it only ships the frame. Each repo describes itself in one file,
`.ai1/config.json`, and the same hooks behave correctly everywhere:

```json
{
  "$schema": "https://raw.githubusercontent.com/Edvantage26/ai1/main/schema/ai1.schema.json",
  "version": 2,
  "features": { "storyboard": false },
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
of ai1 keeps working. The knowledge bundle is always `.ai1/okf/`.

| Level | Examples | Lives in |
|---|---|---|
| Generic as is | Destructive-command guard, no `--no-verify`, secret scan, "verify before done" | `ai1` |
| Generic with config | Verification command, what counts as production, trunk branch | `ai1` + `.ai1/config.json` |
| Specific | Knowledge, domain skills, MCP servers | The repo |

## Features

Every feature is on unless your repo switches it off (`"features": { "<id>": false }`). Features
that need something from the repo start in a basic mode: worktrees with a recipe ai1 works out from
the repo, design quiet in a repo without a frontend. You do not need to write the file by hand:

```text
/ai1:core-setup-repo
```

reads the project, shows every feature on with what it does, and asks only which ones you want off
here (and the verify command it found, after running it once). It writes `.ai1/config.json` and
`.claude/settings.json` through the `ai1` CLI (`ai1 init --disable design,storyboard`, merged and
validated, not improvised), and then offers each feature's own setup: the knowledge bundle, the
design context.

| Feature | Default | What it does |
|---|---|---|
| `okf` | on | Project knowledge in an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle: loads its index at session start, points the agent to the concepts related to each message and to each file it reads or edits, asks to update it when the session changed files or saved memories after its last update, and ships the OKF toolkit (`/ai1:okf-maintain-knowledge`, `/ai1:okf-validate-bundle`, `/ai1:okf-visualize-bundle`; `ai1 okf file-map` shows which concept ai1 names for a file), plus `/ai1:okf-tidy-claude-md` to move knowledge piled up in CLAUDE.md into the bundle  The project context (what it is for, users, scope and what is out, constraints, stack, how it runs and ships, integrations and data, who decides) and how it is operated in production (`operations.md`: deploy, environments, logs, database, access, monitoring, alerts, with where each secret lives, never its value) lives in the bundle too: `/ai1:okf-interview-project` asks for what the repo does not say, requirements and open questions are kept with `ai1 okf project` (one `requirements/R<nnn>-<slug>.md` each: what the project must achieve and why, never how; changed only from your words, a replaced one kept as superseded; validated by the plans that list them, and with a check command `ai1 okf project verify` reopens one that regressed), and once it is started the session start names the gaps, what is out of scope and the open questions. Over time: milestones and `ai1 okf project review`, a hint when a message may change a requirement or asks for one out of scope, a hint to run a requirement's check when editing code whose concept `satisfies` it, and a review offered when enough changed. The developer's technical vision (architecture, libraries to reuse, integration, what to avoid) is asked apart and kept as decisions, not requirements (`ai1 okf project decision`); the interview proposes options with a recommendation, and a plan that names what the vision avoids is reported. A repo that wants okf without requirements switches all of it off with `"modules": { "okf-project": false }` (`ai1 init --disable-modules okf-project`).  Other repositories whose knowledge this one needs go in `related` of `.ai1/config.json` (where their bundle is, what they own): listed at session start, and offered by ai1 when the agent reads another repository with its own bundle or when setup finds repos the docs name |
| `danger` | on | Confirms or refuses commands that destroy work or data; asks you before the agent changes ai1's or Claude Code's configuration (so it cannot switch its own guards off); applies your repo's own rules (`rules` in `.ai1/config.json`, written with `/ai1:danger-write-rule`: "use pnpm", "never edit `generated/`", "ask before a heavy query through the database MCP server"; on shell commands, edits or MCP tool calls, case-insensitive with `"flags": "i"`). In bypass and auto permission modes only the commands that lose work or data for good and your repo rules ask; the other asks let the call through |
| `craft` | on | Gives the agent the rules for orderly code: the minimum change that solves the task, nothing outside it, reuse before writing, refactors proposed (not applied) when it sees duplication or dead code, self-explanatory names. Where things live (layout, how to add each kind of piece, reusable helpers) goes in the OKF bundle |
| `design` | on | For repos with a frontend (quiet in one without). At session start: read the product and design-system context (OKF concepts of type `Product` / `DesignSystem`, or Impeccable's `PRODUCT.md` / `DESIGN.md`), avoid the generic AI look, keep a quality floor. After every edit to a UI file, 35 deterministic rules (overused fonts, purple gradients, glows, gradient text, emoji as icons, low contrast, removed focus rings, animations with no reduced-motion fallback, skipped headings, tiny text, placeholder images...) report what that edit introduced; in a page [Hallmark](https://github.com/Nutlope/hallmark) built, the rules it checks itself are left to it. Points to [Impeccable](https://github.com/pbakaus/impeccable) commands when it is installed, to `/hallmark` for new pages when that is, and to the official `frontend-design` skill for the visual direction (its palette and typefaces recorded in `DesignSystem`) when that one is. Before designing a client's UI, `/ai1:design-gather-brand` gathers its brand (colours, logo, typefaces, images) from the repo, your other projects with that client (`ai1 brand find`), its website and you, and records it under `## Brand` of the `DesignSystem` concept; once recorded, the brief says to design with it. `/ai1:design-review-usability` checks a flow is intuitive for the people who use it: an agent that knows only their profile (`## Users` of the `Product` concept, asked for when missing) and the goal tries the task in the browser, every step is walked with the cognitive-walkthrough questions, and findings (P0-P3, labelled synthetic, one fix each) land on the storyboard; fixes only after your yes |
| `storyboard` | on | For repos with a frontend. After a visual change the agent records the user flow as a storyboard you review without running the app: numbered steps in the user's words, desktop and mobile screenshots with what is clicked framed, before vs after (the base captured in a `<name>-before` worktree), new and removed steps marked, grouped in sections, a short note where a step is not obvious, and the files the flow takes in or gives out (uploads, downloads, generated reports and emails) as evidence with a three-line card and a preview: spreadsheets as their first rows, emails as headers and body, text, images; `--mask` shows only the shape of personal data. One self-contained `index.html` served at a local URL (`ai1 storyboard serve`, released when the worktree is finished or dropped) and a PDF (one step per page, printed with a local Chrome). Kept in `.ai1/storyboards/<slug>/`, ignored by git; link that folder wherever you like (a synced Drive folder) with your own tooling. Closing the change deletes the screenshots it left around the repo. A Stop reminder when UI files changed with no storyboard after them. Publishing (a PR, a task tracker) only through a skill customization and only after your yes. Usability findings shown on their steps (`ai1 storyboard note`). `/ai1:storyboard-record-flow`, `ai1 storyboard add\|file\|note\|build\|serve\|stop\|list\|clean`. |
| `verify` | on | You cannot get a "done" while code changed after the last passing run of the `verify` commands (run in full: a filtered run does not count). Docs and harness config are exempt. Skipping, emptying, weakening or deleting tests, or changing the config of a check (lint, format, types), asks you first (`test-guard`); the same tool call 5 times in a row gets the agent a nudge (`tool-loop`); after 3 failed fix attempts in a row the agent is told to stop and find the root cause (`fix-loop`, `/ai1:verify-debug-systematically`). `/ai1:verify-evaluate-llm-prompts`: evaluate and improve an LLM step with evidence - start simple and stop if it is good enough; otherwise a small reference set, the cause of each failure before blaming the model, models or prompts compared as a tournament (few cases, drop losers, grow the set). `ai1 verify` runs them; `ai1 step-done` logs a deep step only when they pass; `ai1 plan-done` closes a plan |
| `sizing` | on | Sizes each task: quick ones are done directly, medium ones get a short plan the agent states and starts on (written to `.ai1/work/<slug>/plan.md`, `size: plan`, only when it has more than about 3 steps or may not finish in one go; no approval), complex or risky ones get questions and a design (`/ai1:sizing-design-before-code`) that you approve before any code is edited. Restores progress after a compaction. |
| `later` | on | Large changes and future features, not decided yet, noted down for later in `.ai1/later/NNNN-<slug>.md` (versioned, apart from the knowledge bundle because they are not the system), each called by its number ("later 0003"). Only on demand: the agent notes one down only when you ask ("apúntalo para luego", "note it down for later") and never offers it. When a clearly different, large subject comes up mid-task, it mentions it in one line at the end of its report with what it recommends (do it here or fork it into a new conversation), without stopping to ask. "Propuesta"/"proposal" in the conversation always means the agent's own proposal, never this feature. Two sizes: a one-page *idea* and a *full* entry (criteria before options, "do nothing" always an option, assumptions, phases, how to resume). Open entries listed at session start and related ones recalled on each message; when one is accepted, a hook asks for its decisions to be recorded in the OKF bundle. `/ai1:later-write`, `ai1 later new\|set\|index\|check`. |
| `reuse` | on | Work that keeps coming back in this repo becomes a reusable piece. After a task with real work (8+ tool calls) the agent judges in one line whether it will be asked again here; if it may, it searches this repo's own past sessions and its project skills, commands and MCP servers (`ai1 reuse search`) and proposes in one line to encapsulate it (rule, hook, script, skill, MCP entry) or to complete or merge an existing piece. Built only on a yes (`/ai1:reuse-encapsulate`); a no is kept in `.ai1/reuse.json` and never proposed again. Never reads other repos' sessions. `ai1 reuse search\|dismiss` |
| `delegate` | on | An edit to a file of another repository with ai1 active (a sibling clone) is refused and delegated to a session started in that repository, so its own config, hooks, CLAUDE.md and skills apply: `ai1 delegate --cwd <repo> --brief <file>` runs `claude -p` there and returns status, summary, commits and changed files. The delegated session cannot ask you, so it stops: its question (`needs-input`) or a guard of that repo that asked to confirm (`blocked`) comes back to your conversation, and `ai1 delegate --resume <id> "<answer>"` continues the same session (`--allow-once "<command>"` for a confirmed action; a refusal stays a refusal). The edited repo decides (its own `features.delegate`), also from a session launched where ai1 is inactive. Submodules are part of the project: their changed files are seen from the superproject (verify included). Only if you say the edit must be made here: `ai1 delegate allow <repo> --because "..."`. `/ai1:session-delegate-change` |
| `maintenance` | on | Maintenance tasks only for the people who maintain ai1 in the repo (the periodic ones are built-in `routines`): `maintainers` in `.ai1/config.json` (git emails; `ai1 init --role maintainer` adds you; without the list everyone maintains). They get the CLAUDE.md drift and bundle health hints and periodic checks (later entries left open for months), one line at session start at most every few days and sessions. Each person mutes a task for themselves: `ai1 maintain off|on|snooze <task>`. |
| `watches` | on | Follow what was shipped to production. After a push of the trunk or a tag, a publish or your own deploy command (`modules.watch-release-detect.deployCommands`), the agent offers to follow it: a watch in `.ai1/watches/<id>.json` (committed) checks it with a health command, a command that counts successes and failures since the release, or a prompt for the agent. You subscribe for a while (your ignored `.ai1/local/`), `ai1 watch run --due` (from your scheduler, or the agent on a yes) records results and totals ("6 ok, 2 failed since 2026-11-18"), `ai1 watch confirm <id>` records that you tried it and it works, and the session start says in one line only what changed. `/ai1:watches-follow-release`, `ai1 watch` |
| `messages` | on | `/ai1:messages-draft-message` drafts an email or message to a contact of the project: who they are from `.ai1/okf/people/contacts.md` (committed; never in a public repo), your own relation and tone with them from `.ai1/local/contacts.md` (only yours). It shows the draft and sends only through the tool your customization names. `ai1 contacts` |
| `routines` | on | Your own periodic tasks in a repo: "recuérdame lanzar /ai1:okf-validate-bundle cada semana", "cada lunes comprueba las dependencias". `ai1 routine add <id> --every 7d|12h|mon --skill "/name args"` or `--prompt "..."`, kept in your ignored `.ai1/local/routines.json`. At session start one line says which are due (once a day) and the agent offers to do it here or to launch it in a new conversation you see, with the task written (`ai1 routine launch`, through your fork opener). `snooze`, `off`, `done "<result>"`. ai1's periodic maintenance tasks are built-in routines for maintainers. `/ai1:routines-set-routine` |
| `worktrees` | on | Every change to the repo files is done in its own worktree, which the agent creates before the first edit, made the way your project needs. It works from the first change: ai1 works out a basic recipe from the repo (base the main branch, ignored `.env` files copied, the install of your lockfile, your verify commands before integrating). What your repo does differently goes in `.claude/skills/worktree/recipe.json`, committed, with only the fields that differ: when `ai1 worktree` reports something the recipe does not cover (a big ignored folder, an env file, a failing setup), the agent adds the fix there and tells you in one line; `/ai1:worktrees-plan-recipe` refines it with you (ports, services, shared data). Modes: `full`, `light` (heavy folders shared, regenerated or left out) and `auto`, which picks full when it fits on that machine's disk. Each worktree gets its env files and its own port; the agent keeps telling you which worktree it is working in. `ai1 worktree create\|list\|run\|finish\|drop` |

### How a later entry goes

With `later` on, an idea goes: `ai1 later new <slug> --idea` (next number, index updated) → it grows into
a full entry when it is about to be decided → `ai1 later set <n> accepted` and its decisions become OKF
concepts that cite it → built (with `sizing`, a deep plan with `later: <n>`) → `ai1 later set <n> implemented`.

### How a worktree goes

With `worktrees` on: `ai1 worktree create feat-x` → the agent enters it (EnterWorktree) and runs the
setup it prints → works and commits there, starting each progress report with the worktree's name →
when you say so, `ai1 worktree finish feat-x` brings in the base, runs the recipe's checks, fast-forwards
the base and removes the worktree (the `danger` guard asks you first). Shared read-only dependency
caches, build slots and a `WorktreeCreate` hook for very large repos are *planned*.

### How a deep task goes

With `sizing` on, a deep task goes: questions → design in `.ai1/work/<slug>/plan.md` (git-ignored) →
you approve it with a plain "ok"/"aprobado" → step-by-step build with a progress log → `ai1 plan-done`.
The design carries 2-5 behaviour scenarios (`- S1: Given ..., when ..., then ...`, or `None - <why>`);
the test that covers one is tagged `[<slug>:S1]`, and `ai1 plan-done` closes the plan only when every
scenario has its tagged test and the verify commands pass. It checks that the test exists and the
suite is green, not that the test proves the scenario: that is your review. Until you
approve, a hook refuses code edits; if a "quick" task grows past 6 files or 300 lines, it asks you
once whether to stop for a plan (`modules.sizing-escalate.max_files` / `max_lines`).

## Customize a skill

ai1's skills come from the plugin, so you do not edit them; you add to them. When a skill loads it
prints its customization at the end, from two places:

- **this project**: `.ai1/skills/<feature>/customization.md`, committed, for everyone on the repo
  (`<feature>` is the skill's prefix: `.ai1/skills/later/customization.md` for `/ai1:later-write`);
- **you**: `~/.config/ai1/skills/<feature>/customization.md` in every repo, and plugin options in `/config`
  (today **Fork opener**: where `/ai1:session-fork-conversation` opens new conversations - `auto`,
  `vscode`, `desktop`, `terminal`). Any other tool (an agent manager...) opens forks through your own
  command, which the fork skill helps you set up once and saves as your customization.

A customization is a few markdown bullets. It adds to the skill but never overrides its **Fixed rules**;
where the two disagree, the project's wins over yours. When you correct how a skill works, the agent
offers once to save it. The agent also keeps them up without waiting for a correction: the first time a
skill runs in a repo for you it watches for what this project needs that the skill does not say; after
a skill ran (3+ tool calls) `customization-check` has it judge silently whether a rule would have made it
go better and only then propose it in one line (`ai1 skill-context quiet <skill>` stops that for one
skill); a customization that names paths that no longer exist is flagged when it loads.
`/ai1:core-customize-skill` writes or updates it after you approve the text, and changing
`.ai1/skills/` asks you first (`config-guard`). `ai1 skill-context --list` shows which skills can be
customized and what you have. Not customizable, with the reason in the list: the skills that protect
others or are deterministic (`core-report-issue`, `okf-validate-bundle`, `danger-write-rule`,
`core-customize-skill`).

## Hooks

Every hook module, the feature that turns it on, the event it runs on, what it does and where it comes
from (same meaning as in the [Skills table of the README](../README.md#skills)). Every module listed works today.

<!-- hooks:start (generated by npm run readme-tables, do not edit) -->
| Hook | Feature | Event | What it does | Origin |
|---|---|---|---|---|
| `brief` | `core` | SessionStart | tells the agent at session start which harness runs here | Written in ai1 |
| `issue-offer` | `core` | UserPromptSubmit | when ai1 itself fails in a repo (a module throws, the hook crashes), the agent offers once to report it with `/ai1:core-report-issue`; nothing is filed without your yes to the text, unless you chose automatic reports (`ai1 init --report-errors auto`: only versions and the error's module and plugin file:line are sent) | Written in ai1 |
| `issue-guard` | `core` | PreToolUse | refuses `gh issue\|pr create\|comment\|edit` aimed at the ai1 repo, and `ai1 issue url`, while the title or body holds private data (your repo names, home paths, user name, emails, IPs, hostnames, tokens, the project's contacts and clients), listing each with its placeholder; also when the body cannot be read (`--body "$(...)"`, stdin). `modules.issue-guard: false` silences it | Written in ai1 |
| `customization-check` | `core` | Stop | after an ai1 skill you can customize ran (3+ tool calls after it loaded, by the agent or typed by you), the agent judges silently whether a customization rule would have made it go better and only then proposes it in one line; once per skill and session, `ai1 skill-context quiet <skill>` to stop it | Written in ai1 |
| `local-sync-start` | `core` | SessionStart | at session start, unseals your data in `.ai1/local/` when a newer sealed copy arrived, telling a conflict without overwriting (`ai1 local sync on\|off\|status`) | Written in ai1 |
| `local-sync-stop` | `core` | Stop | at the end of a turn, seals your data in `.ai1/local/` again when it changed | Written in ai1 |
| `okf-index` | `okf` | SessionStart | loads the knowledge bundle index and its maintenance rules | Written in ai1 |
| `okf-claude-md` | `okf` | SessionStart | at session start, one line when the repo's CLAUDE.md drifts from the bundle (too long, sections that repeat a concept or hold knowledge no concept has, sections holding a literal secret, which are never moved, references that no longer exist), told once per set of findings; `ai1 claude-md` prints the report and `/ai1:okf-tidy-claude-md` proposes a short CLAUDE.md and the concept edits, applied after the person approves | Written in ai1 |
| `okf-catch-up-start` | `okf` | SessionStart | when a branch that had no knowledge bundle was merged into the current branch (in a terminal, on a forge and pulled, or by the agent), says so once and has the agent hand the documentation of its changes to an independent background agent, in its own worktree and commit; the commit's `Knowledge-Catch-Up: <merge sha>` trailer closes it in every clone; `ai1 okf catch-up` lists what is pending and prints the brief. Squash merges are not seen | Written in ai1 |
| `okf-project` | `okf` | SessionStart | at session start, once the project context is started: the rule to ask before guessing what neither the code nor the bundle answers, its gaps in one line, what is out of scope, open questions and active must requirements (`ai1 okf project`, `/ai1:okf-interview-project`) | Written in ai1 |
| `okf-catch-up-prompt` | `okf` | UserPromptSubmit | the same catch-up check as `okf-catch-up-start`, on the next message after HEAD moves | Written in ai1 |
| `okf-recall` | `okf` | UserPromptSubmit | on every message, points the agent to the OKF concepts related to it; a message that may change a requirement in force, or names one out of scope, gets one more line (`okf-project` off: none) | Written in ai1 |
| `okf-file-context` | `okf` | PostToolUse | when the agent reads or edits a file, names the concept that describes it (from `resource`, `sources` and code paths in concepts); on an edit, a concept with `satisfies: [R004]` asks once to run that requirement's check | Written in ai1 |
| `danger` | `danger` | PreToolUse | confirms or refuses `git reset --hard`, force push, `rm -rf`, `--no-verify`, `DROP TABLE`... | Written in ai1 |
| `config-guard` | `danger` | PreToolUse | asks you before the agent changes `.ai1/config.json`, `.claude/settings*.json`, `.claude/hooks/` or the skill customizations in `.ai1/skills/` (file tools or shell), in any worktree | Based on [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) (`config-guard`) |
| `rule-offer` | `danger` | UserPromptSubmit | when you say something must never happen again ("no vuelvas a...", "never do that again"), has the agent offer to turn it into a repo rule with `/ai1:danger-write-rule` | Written in ai1 |
| `repo-rules` | `danger` | PreToolUse | your repo's own ask/deny rules for shell commands, edits and MCP calls, from `rules` in `.ai1/config.json` | Written in ai1 |
| `okf-upkeep` | `okf` | Stop | asks to update the bundle after changes, new memories or a long run of investigation (findings, ways to validate, ways of working), and runs the OKF validator itself when the bundle changed, blocking only on errors | Written in ai1 |
| `craft-brief` | `craft` | SessionStart | the code craft rules at session start | Written in ai1 |
| `sizing-brief` | `sizing` | SessionStart | the sizing recipe at session start; restores deep progress after compaction | Based on [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (ODD: when a task is small), [Superpowers](https://github.com/obra/superpowers) (the living plan document) |
| `sizing-approval` | `sizing` | UserPromptSubmit | records your approval of a deep design marked ready | Written in ai1 |
| `sizing-gate` | `sizing` | PreToolUse | refuses code edits (tools and shell writes) while a deep design waits for approval, and closing by hand or dropping approved scenarios of a plan with behaviour scenarios | Written in ai1 |
| `sizing-escalate` | `sizing` | PreToolUse | asks once when a task without a plan outgrows a quick change | Written in ai1 |
| `design-brief` | `design` | SessionStart | UI rules and the design context files at session start | Written in ai1 |
| `design-detect` | `design` | PostToolUse | design rules on every edited UI file, findings of that edit only, once per session (`modules.design-detect.ignore_rules`) | Based on [Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0; rule ids and a deterministic detector run as a hook), [Hallmark](https://github.com/Nutlope/hallmark) (MIT; nine rules from its gates) |
| `verify-gate` | `verify` | Stop | no "done" while code is newer than the last passing run of `verify` | Based on [Superpowers](https://github.com/obra/superpowers) (verification before completion, `task-done`) |
| `test-guard` | `verify` | PreToolUse | asks you before tests are skipped, emptied, weakened or deleted, or an existing lint/format/type-check/test-runner config is changed (`modules.test-guard.test_paths` / `check_config_paths` / `ignore_rules`) | Based on [claude-code-hooks](https://github.com/karanb192/claude-code-hooks) (`protect-tests`), [agent-guard](https://github.com/hahahahahahahahah6/agent-guard) (test tampering shapes), [Everything Claude Code](https://github.com/affaan-m/ECC) (`config-protection`) |
| `fix-loop` | `verify` | PostToolUse | counts failed fix attempts (a test still failing after an edit) and after 3 in a row tells the agent to stop patching, go back to the root cause with `/ai1:verify-debug-systematically` and tell you | Based on [Superpowers](https://github.com/obra/superpowers) (fix-loop counters in a hook) |
| `llm-brief` | `verify` | SessionStart | in repos that depend on an LLM SDK, points to `/ai1:verify-evaluate-llm-prompts` at session start | Written in ai1 |
| `tool-loop` | `verify` | PreToolUse | when the last 5 tool calls are the same call with the same input, tells the agent once to stop polling or retrying by hand (`modules.tool-loop.repeat_threshold`) | Based on [Everything Claude Code](https://github.com/affaan-m/ECC) (the repeated tool call nudge) |
| `worktree-brief` | `worktrees` | SessionStart | worktree rules at session start, the basic recipe and how to complete the project recipe; names the worktree the session is in | Written in ai1 |
| `worktree-reminder` | `worktrees` | UserPromptSubmit | the active worktrees when they change and every few prompts, marking this session's | Written in ai1 |
| `later-brief` | `later` | SessionStart | where later entries live, that they are not the system, that "propuesta" is never this feature, when to note one down, and the open ones | Written in ai1 |
| `later-recall` | `later` | UserPromptSubmit | on every message, points the agent to the related later entries, labelled with their status | Written in ai1 |
| `storyboard-reminder` | `storyboard` | Stop | when the session changed UI files and built no storyboard after them, asks once to record the flow or say why not (`modules.storyboard-reminder.ignore`) | Written in ai1 |
| `later-upkeep` | `later` | Stop | when the session touched `.ai1/later/`, checks numbering, statuses, the index and that accepted entries are cited by the bundle; asks to mark an entry implemented when its deep plan is done | Written in ai1 |
| `routine-notice` | `routines` | SessionStart | at session start, lists your due routines in one line, each at most once a day, and has the agent offer to run one here, in a new conversation, snooze it or turn it off | Written in ai1 |
| `watch-notice` | `watches` | SessionStart | at session start, one line only with news from the watches you follow: a failed run or a recovery, a follow-up that ended, a release you have not confirmed, checks that are due | Written in ai1 |
| `watch-release-detect` | `watches` | PostToolUse | after a release command (`git push` to the trunk or a tag, `gh release create`, `npm publish`, the repo's own deploy commands), tells the agent once to offer `/ai1:watches-follow-release` | Written in ai1 |
| `reuse-brief` | `reuse` | SessionStart | before a task done before in this repo, look up how with `ai1 reuse search`; how to propose encapsulating repeated work; only this repo | Written in ai1 |
| `reuse-check` | `reuse` | Stop | after 8+ tool calls since the last check (`modules.reuse-check.minToolCalls`), asks once to judge whether the work will recur here and to search or propose; at most twice per session | Written in ai1 |
| `foreign-repo` | `delegate` | PreToolUse | an edit of another repository with ai1 refused, pointing to `/ai1:session-delegate-change`; one line of context for a repo without ai1 (runs where the launch directory has no ai1 too) | Written in ai1 |
<!-- hooks:end -->

### Other components

| Component | Feature | Status |
|---|---|---|
| Decision log + `ai1 log`: every module run logged locally (module, decision, ms, characters added, rules, error signatures; no commands or paths), off with `AI1_DECISION_LOG=0`; `ai1 log --all` for every repo on the machine | — | works |
| `ai1` CLI behind the skills (`ai1 status`, `ai1 init`, `ai1 verify`, `ai1 step-done`, `ai1 plan-done`, `ai1 later`, `ai1 reuse`, `ai1 worktree`, `ai1 fork`, `ai1 delegate`, `ai1 issue`, `ai1 claude-md`, `ai1 maintain`, `ai1 routine`, `ai1 watch`, `ai1 contacts`, `ai1 brand find`, `ai1 storyboard`, `ai1 keys`, `ai1 local`, `ai1 log`, `ai1 skill-context`) | — | works |
| Skill customization: project (`.ai1/skills/<feature>/customization.md`) and personal (`~/.config/ai1/...`) customizations injected when a skill loads, Fixed rules that win, `/ai1:core-customize-skill`, `ai1 skill-context --list`; every skill is customizable or excluded with a reason (a test checks it) | — | works |
| `ai1 delegate` (with `/ai1:session-delegate-change`): a change made by a `claude -p` session started in the other repo, stop-ask-resume, one-time allow for a confirmed command | delegate | works |
| `ai1 fork` (with `/ai1:session-fork-conversation`): a new conversation from this one, `full` (a copy of the whole conversation) or `brief` (only a written handoff), opened natively in VS Code (the extension URI), a terminal or Claude Desktop (the commands to open it), or in any other tool through your own `--open-command` (set up with the skill's guide, kept in your personal customization); the **Fork opener** option in `/config` chooses where instead of detecting it. Needs no feature: works in any repo while the plugin is enabled | — | works |
| `ai1 issue` (with `/ai1:core-report-issue`): gathers versions and features (`ai1 issue env`), checks a reproduction has no private paths, hosts, names or code (`ai1 issue check`), creates the issue with `gh` or a prefilled link (`ai1 issue url`) only after you approve the text. Needs no feature | — | works |
| OKF background agents (`agents/`) | okf | works |
| Your own data per project in `.ai1/local/` (ignored by git, shared by worktrees): role, muted tasks, subscriptions, contacts, state; optionally sealed into `.ai1/contributors/<email>.sealed` so only your keys open it - any machine of yours with an `ssh-ed25519` key published on GitHub/GitLab opens it with no question, any other once with your password (`ai1 local seal\|unseal`, `ai1 keys published`, `ai1 local password\|unlock\|recipients`, or the ai1 key with `ai1 keys init\|import`) - or, if you choose, only compressed into `<email>.packed` (`ai1 local sync on --plain`, readable by anyone with the repo); kept in sync by `local-sync-start` and `local-sync-stop` (Node's built-in crypto only, nothing to install) | — | works |
| Credential deny rules: `ai1 init --deny-credentials` (offered by the setup) adds Claude Code permission rules so the agent cannot read private keys and home credential stores (`.env` files are not included) | — | works |
| Shared read-only caches per dependency version, `writable`, build slots, `WorktreeCreate` hook for heavy repos | worktrees | planned |
| `prod`: blocks writes to production resources declared in `.ai1/config.json` | prod | planned |
| `secrets`: refuses committing secrets | secrets | planned |
| `ai1 doctor`, method skills (`ftd`, `review`) and a finding verifier | — | planned |

## How the hooks run

Every hook event calls one entry point, `bin/ai1-hook.mjs`. It loads `.ai1/config.json`, runs the
modules of the enabled features for that event, and combines their decisions (refuse > ask > allow).
A module is one file with `{ id, event, feature, run() }`; adding one does not touch the hook
wiring. Internal errors never block the agent; a matched rule does.

Requirements: **Node 18+** (hooks, the `ai1` CLI and the OKF toolkit, `ai1 okf ...`), nothing else:
no `npm install`, no network. The one library the OKF toolkit needs, js-yaml, ships inside the plugin
(`vendor/`).

## Install in detail

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

It also hides from the agent the skills of the features you switch off (`skillOverrides`, set to
`user-invocable-only`): you can still call them with `/ai1:<skill>`, and the agent stops paying
context for them.

Some plugins do part of ai1's job: a standalone OKF plugin (`okf@...`, the same skills listed twice) and
Superpowers (`superpowers@...`, its session start forces
its own planning, worktree, TDD and verification skills on every task, competing with sizing,
worktrees and verify); `feature-dev@...` only gets a warning. `/ai1:core-setup-repo` lists the ones
you have enabled, says why each overlaps and asks which to disable in that repo only, in
`.claude/settings.local.json` (personal, git-ignored; `ai1 init --disable-plugins`). It disables
nothing you did not pick. While one that should be disabled stays enabled, the session start says so.
