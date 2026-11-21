<div align="center">

# ai1

**All in one for your coding agent: guardrails, verification and project memory, set up per repo.**

[![Release](https://img.shields.io/github/v/tag/Edvantage26/ai1?label=release&color=black)](https://github.com/Edvantage26/ai1/tags)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-black.svg)](https://docs.claude.com/en/docs/claude-code/plugins)

</div>

ai1 is a Claude Code plugin that gives your agent one harness instead of a pile of loose skills and
hooks. It **guards** the repo (no destroyed work, no switched-off checks), makes the agent **prove**
its work before it says "done", and **remembers** what it learns in the repo, not in a chat that
disappears. You turn it on per repo, and each repo describes itself in one file, `.ai1/config.json`.

## Install

```text
/plugin marketplace add Edvantage26/ai1
/plugin install ai1@ai1
```

Requires **Node 18+**. Nothing else: no `npm install`, no network calls from the hooks.

## Try it

Open a repo and run:

```text
/ai1:core-setup-repo
```

It reads the project, finds your test command, shows every feature (all on by default) and asks
which ones you want off here. It writes `.ai1/config.json` and `.claude/settings.json`, so ai1 is on
for everyone who opens the repo. It commits nothing: review and commit those two files yourself.

From then on, just work as usual. You will notice ai1 when it matters:

```text
You:    the export button breaks with empty lists, fix it
Agent:  Size: quick, because it is one clear bug.            ← sizing
        Working in the worktree fix-empty-export.             ← worktrees
        ...edits, runs npm test...
        (tries to say "done" before the tests pass)
ai1:    code changed after the last passing `npm test`.       ← verify
Agent:  ...fixes the test, npm test green...
ai1:    you changed src/export.ts; update its concept.        ← okf (project memory)
Agent:  Done: fixed, tested, knowledge updated, merged.
```

## Why

Agents are good at writing code and bad at three things:

1. **Remembering.** Every session starts from zero, so they guess, and a plausible guess is worse
   than an obvious error.
2. **Respecting rules.** A rule written in `CLAUDE.md` is a suggestion; the agent can forget it
   mid-session.
3. **Proving they are done.** "It should work now" is not evidence.

ai1 turns the rules that matter into hooks that run every time, and keeps the project's knowledge
in the repo where the next session reads it.

## What you get

Every feature is on unless your repo switches it off (`"features": { "storyboard": false }`).

| Feature | What it does for you |
|---|---|
| `okf` | **Project memory.** Knowledge lives in the repo as an [OKF](https://github.com/GoogleCloudPlatform/knowledge-catalog/tree/main/okf) bundle (`.ai1/okf/`); the agent is pointed to the right concept for each message and file, and asked to update it after changing things. It also keeps what the project is for, its scope, requirements and open questions, asking you only what the repo does not say. |
| `verify` | **No "done" without proof.** The agent cannot finish while code changed after the last passing test run; weakening or deleting tests asks you first. |
| `danger` | **Guardrails.** Confirms or refuses `rm -rf`, force pushes, `DROP TABLE`...; the agent cannot switch its own guards off; your repo's own rules ("use pnpm", "never edit `generated/`"). |
| `sizing` | **The right amount of process.** Each task is sized quick, plan or deep; deep work gets a design you approve before any code. |
| `worktrees` | **One worktree per change**, made the way your repo needs (env files, install, ports), merged when the checks pass. |
| `craft` | **Orderly code.** The minimum change, reuse before writing, refactors proposed instead of sneaked in. |
| `design` | **No generic AI look.** 35 design checks on every edited UI file, your client's brand gathered before designing, usability reviews as your users would try it. |
| `storyboard` | **See a UI change without running it.** Steps and screenshots of the flow, before vs after, as a page and a PDF. |
| `later` | **Ideas parked, not lost.** Large changes not decided yet, noted down when you ask and recalled when they come up. |
| `reuse` | **Work that repeats becomes a tool.** Repeated work in a repo is proposed as a rule, script or skill. |
| `delegate` | **Each repo keeps its rules.** An edit to another repo is made by a session started there. |
| `watches` | **Follow a release.** After a deploy, checks that it is up and counts failures since then. |
| `routines` | **Your periodic tasks**, reminded at session start ("every Monday check the dependencies"). |
| `messages` | **Messages to the project's contacts**, with who they are and your tone with each one. |
| `maintenance` | **Upkeep for maintainers only**: knowledge bundle health, stale entries, CLAUDE.md drift. |

Every feature in detail, with its commands and options: [docs/reference.md](docs/reference.md#features).

## Skills

ai1's skills are named `/ai1:<feature>-<what it does>`. The agent offers each one when it applies;
you can also call them yourself. Where each one comes from: written in ai1, imported from another
project (licenses in [THIRD-PARTY.md](THIRD-PARTY.md)) or based on another project's ideas or method
(no code copied). The hooks behind the features, with their origin too: [docs/reference.md](docs/reference.md#hooks).

<!-- skills:start (generated by npm run readme-tables, do not edit) -->
| Skill | Feature | What it does | Origin |
|---|---|---|---|
| `/ai1:core-customize-skill` | `core` | Customize how an ai1 skill works for this project or only for the person. | Written in ai1 |
| `/ai1:core-report-issue` | `core` | Report a problem with ai1 itself (a hook that blocks or misfires, a skill or `ai1` command that fails, a missing feature) as an issue on the public Edvantage26/ai1 repository. | Written in ai1 |
| `/ai1:core-setup-repo` | `core` | Set up ai1 in the current repository, or switch ai1 features off or back on. | Written in ai1 |
| `/ai1:danger-write-rule` | `danger` | Turn a project rule into a guard rule that asks about or refuses a command or edit breaking it. | Written in ai1 |
| `/ai1:design-gather-brand` | `design` | Gather a client's brand (colours, logo, typefaces, images) before designing its UI: from this repo, the person's other projects with that client, the client's website, then the person; record it under `## Brand` of the design-system context so every design uses it. | Written in ai1 |
| `/ai1:design-review-usability` | `design` | Check that a UI flow is intuitive for the profile of user who will use it, not only that it works: an agent that knows only the profile and the goal tries the task in the browser, then every step is walked with the cognitive-walkthrough questions; findings by severity, on the storyboard. | Imported from [Impeccable](https://github.com/pbakaus/impeccable) (Apache 2.0; the cognitive load checklist of its critique rubric); based on [UXAgent](https://github.com/neuhai/UXAgent) (an agent playing the user) |
| `/ai1:later-write` | `later` | Note down for later large changes and future features that are NOT decided yet, in .ai1/later/ (called by number, "later 0003"). | Written in ai1 |
| `/ai1:messages-draft-message` | `messages` | Draft an email or message to one of the project's contacts (a client, a teammate, a provider) with who they are in the project and the person's own relation and tone with them. | Written in ai1 |
| `/ai1:okf-interview-project` | `okf` | Interview the person about the project (purpose, users, scope, constraints, how it runs and ships, who decides), inferring first from the repo and asking only what is left, and keep the answers, requirements and open questions in the knowledge bundle. | Based on [Spec Kit](https://github.com/github/spec-kit) (`/speckit.clarify`: coverage per category, questions ranked by impact x uncertainty, capped, each with a recommended answer), [GSD](https://github.com/glittercowboy/get-shit-done) (`/gsd:new-project`: open questioning and requirements active / validated / out of scope with reason), [Kiro](https://kiro.dev/docs/steering/) (steering files inferred from the codebase) |
| `/ai1:okf-maintain-knowledge` | `okf` | Author, maintain, and consume Open Knowledge Format (OKF) knowledge bundles. | Imported from [okf-skills](https://github.com/scaccogatto/okf-skills) (MIT; the skill, with the OKF v0.2 spec by Google LLC, Apache 2.0) |
| `/ai1:okf-tidy-claude-md` | `okf` | Tidy the repo's CLAUDE.md against its OKF bundle: keep only what the agent needs every session and move the rest of its knowledge into concepts. | Written in ai1 |
| `/ai1:okf-validate-bundle` | `okf` | Check that an Open Knowledge Format (OKF) bundle is conformant with the v0.2 spec (§11). | Imported from [okf-skills](https://github.com/scaccogatto/okf-skills) (MIT; the skill; its validator rewritten in Node) |
| `/ai1:okf-visualize-bundle` | `okf` | Render an Open Knowledge Format (OKF) bundle as a single self-contained, interactive HTML graph (viz.html) of its concepts and links. | Imported from [okf-skills](https://github.com/scaccogatto/okf-skills) (MIT; the skill and its viewer page) |
| `/ai1:reuse-encapsulate` | `reuse` | Turn work that keeps coming back in this repo into a reusable piece (rule, hook, script, skill, MCP entry) or complete or merge one the project already has, after the person says yes to the one-line proposal. | Written in ai1 |
| `/ai1:routines-set-routine` | `routines` | Set, run, launch or stop the person's own periodic tasks in this repo (run a skill, check something), reminded at session start. | Written in ai1 |
| `/ai1:session-delegate-change` | `session` | Have a change to another repository made by a session started in that repository, with its own rules, and relay its questions to the person. | Written in ai1 |
| `/ai1:session-fork-conversation` | `session` | Fork the current conversation into a new one, either a full copy or a clean one with a written handoff. | Written in ai1 |
| `/ai1:sizing-design-before-code` | `sizing` | Design a task with the person and get the design approved before any code. | Based on [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) (ODD: sizing by risk, the plan starting with the request word for word) |
| `/ai1:storyboard-record-flow` | `storyboard` | Record the user flow of a visual change as a storyboard (steps and screenshots, before vs after, the files it takes in and gives out) the person reviews without running the app. | Written in ai1 |
| `/ai1:verify-debug-systematically` | `verify` | Find the root cause of a bug, a failing test or unexpected behaviour before changing code, and stop after repeated failed fixes. | Based on [Superpowers](https://github.com/obra/superpowers) (`systematic-debugging`), [Matt Pocock's skills](https://github.com/mattpocock/skills) (`diagnosing-bugs`), [Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin) (`ce-debug`) |
| `/ai1:verify-evaluate-llm-prompts` | `verify` | Evaluate and improve an LLM step (extraction, classification, judge, verifier) with evidence before blaming the model. | Based on [Hamel Husain and Shreya Shankar](https://hamel.dev/blog/posts/evals-faq/) (error analysis of LLM evals) |
| `/ai1:watches-follow-release` | `watches` | Follow something just shipped to production with a watch: a check that it is up or the count of successes and failures since the release, plus the person's confirmation that they tried it. | Written in ai1 |
| `/ai1:worktrees-plan-recipe` | `worktrees` | Complete, refine or revise how this repository makes git worktrees, one per change: the project recipe on top of the basic recipe ai1 works out from the repo. | Written in ai1 |
<!-- skills:end -->

You do not edit a skill to adapt it; you add rules to it, for the whole project
(`.ai1/skills/<feature>/customization.md`) or only for you (`~/.config/ai1/...`). The agent offers to
save a rule when you correct how a skill works. [More](docs/reference.md#customize-a-skill).

## Configuration

Everything ai1 writes in a repo lives in `.ai1/`:

```text
.ai1/
├── config.json   features and settings of the repo (committed)
├── okf/          project knowledge, an OKF bundle (committed)
├── later/        changes not decided yet (committed)
├── reuse.json    repeated work you chose not to turn into a tool (committed)
└── work/         plans and progress (ignored by git)
```

`config.json` is small; `/ai1:core-setup-repo` writes it for you:

```json
{
  "$schema": "https://raw.githubusercontent.com/Edvantage26/ai1/main/schema/ai1.schema.json",
  "version": 2,
  "features": { "storyboard": false },
  "trunk": "main",
  "verify": ["npm test"]
}
```

Without it ai1 stays inactive in that repo. Every field: [docs/reference.md](docs/reference.md#generic-frame-project-content-ai1configjson)
and the [schema](schema/ai1.schema.json).

## Principles

- **Mechanisms over prompts.** If a rule matters, a hook enforces it.
- **Friction proportional to risk.** Silence for the trivial, ceremony only where failure is expensive.
- **Evidence before claims.** Work is done when a command shows it, not when the agent says so.
- **No surprises on your machine.** Hooks are plain, readable scripts. No network calls, no
  auto-update, and no permission to commit or push on your behalf.

## FAQ

**Does ai1 commit or push for me?** No. It never grants the agent git permissions; you decide.

**What if a hook gets in my way?** Switch its feature off in `.ai1/config.json` or run
`/ai1:core-setup-repo` again. If ai1 itself fails, it never blocks the agent; the agent offers to
report it with `/ai1:core-report-issue`.

**Does it work with Superpowers or other plugins?** Some plugins do the same job (Superpowers forces
its own planning, worktree and verification skills on every task). The setup lists the ones you have
enabled, says why each overlaps and asks which to disable in that repo only. [Details](docs/reference.md#install-in-detail).

**Is it stable?** Early (see the release badge). The `okf` and `danger` features are verified in real
sessions; the rest is tested and newer. Anything not built yet is marked *planned* in the reference.

**How do I try a change to ai1 itself?**

```bash
npm test                                  # node:test, no dependencies
claude --plugin-dir . -p "..."            # a real session with this checkout, without installing it
claude plugin validate .
```

## Credits

The design draws on [Superpowers](https://github.com/obra/superpowers) (methodology as skills,
verification before completion) and [rsc-harness](https://github.com/ericrisco/rsc-harness)
(memory/hands/trade/reflexes, work lanes, refuting reviewers). The design checks take ideas from
[Impeccable](https://github.com/pbakaus/impeccable) and [Hallmark](https://github.com/Nutlope/hallmark),
written from scratch. The OKF toolkit comes from [okf-skills](https://github.com/scaccogatto/okf-skills)
by Marco Boffo; the OKF specification is (c) Google LLC. What each skill and hook takes from where is
in the [Skills](#skills) and [Hooks](docs/reference.md#hooks) tables; licenses and notices in
[THIRD-PARTY.md](THIRD-PARTY.md).

## License

[MIT](LICENSE)
