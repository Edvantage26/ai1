---
proposal: 1
title: "Customizable ai1 skills: project and user overlays"
size: full
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Proposal 0001: Customizable ai1 skills: project and user overlays

| Field | Value |
|---|---|
| **Champion** | Edgar Alarcon |
| **Decides** | Edgar Alarcon |
| **Consulted** | none |
| **Impact** | High: it changes the `.ai1/` contract, every skill and how worktrees keeps its recipe. |
| **Deadline** | none |
| **Related** | [plugin layout](../okf/architecture/plugin-layout.md#what-a-project-can-change-in-a-plugin-skill), [.ai1/config.json contract](../okf/architecture/harness-contract.md), [features](../okf/architecture/features.md), [worktrees](../okf/features/worktrees.md), [session fork](../okf/features/session-fork.md) |

## Summary

- Proposed: one generic way to customize any ai1 skill, at two scopes: **project** (committed in
  `.ai1/skills/<feature>/`: `overlay.md` prose, `settings.json` data, `scripts/`) and **user**
  (`userConfig` of the plugin for values, `~/.config/ai1/skills/<feature>/overlay.md` for prose).
- Why: Claude Code gives no way to extend a plugin skill from a repo; today each feature invents its
  own (worktrees has a project skill, design uses OKF concepts, forks have nothing), and some
  preferences are the person's, not the repo's (where a fork opens).
- Recommended: **customizable by default**, with exclusions written and justified in an index; each
  customizable skill has **fixed rules** an overlay cannot override.
- Delivery: `ai1 skill-context <feature>` injected at the end of every skill with `` !`…` ``, one
  loader for the CLI and hooks, and a skill `/ai1:core-customize-skill` that the agent offers when
  the person corrects how a skill works.
- Rough cost (estimate): the mechanism is Medium; each extra skill is prose and one test row. Token
  cost is zero until a skill is invoked, latency about 175 ms per invocation.
- To decide: key by feature or by skill, settings apart or in `config.json`, what happens to the
  `/worktree` project skill, and which skills stay excluded.

## Context

### Current situation

- A plugin skill runs from the user's cache, one folder per version; a project can only hide it
  (`skillOverrides`) or put another skill beside it. See
  [plugin layout](../okf/architecture/plugin-layout.md#what-a-project-can-change-in-a-plugin-skill).
- worktrees: `/ai1:worktrees-plan-recipe` defers to a project skill `.claude/skills/worktree/`
  (`SKILL.md`, `recipe.json`, `scripts/`) ([worktrees](../okf/features/worktrees.md)).
- design: the design context is OKF concepts ([design](../okf/features/design.md)).
- Hook options: `modules.<module>.*` in `.ai1/config.json` ([contract](../okf/architecture/harness-contract.md)).
- session fork: no customization; the host is detected from environment variables, Desktop has no
  signal, and it detects where this session runs, not where the person wants the new one
  ([session fork](../okf/features/session-fork.md)).
- `userConfig` was ruled out for choosing features because it is per user
  ([features](../okf/architecture/features.md)); it was never considered for per-person preferences.

### Problem or opportunity

- Every feature that needs project-specific behaviour invents its own place and loader.
- A correction like "aquí el brief incluye siempre los comandos de verify" ends in the agent's
  personal memory, which does not travel with the repo.
- Per-person tools (Paseo, VS Code, Desktop, terminal) cannot be stated; forks guess them.

### Why now

Not urgent. It is cheaper before more skills are added: each new skill would otherwise need its own
answer later.

### If nothing is done

Skills stay identical in every repo; project rules go to CLAUDE.md or memory, outside the skill that
needs them; the next feature with per-project data copies the worktree pattern by hand.

## Scope

| In | Out |
|---|---|
| Project and user customization of ai1 skills | Customizing hooks or guards (they keep `modules.*` and code) |
| `ai1 skill-context`, the loader, the customization index, `/ai1:core-customize-skill` | Org-wide or team scope above the repo |
| Migrating the worktree recipe into the new place | Customizing skills of other plugins |
| A per-user `fork.opener` as first user-scope value | Making `core-report-issue` and `okf-validate-bundle` customizable before their guarantees are in code |

## Assumptions

| # | Assumption | Confidence | What would invalidate it |
|---|---|---|---|
| 1 | `` !`command` `` in a plugin skill runs in the session's directory, so it can find `.ai1/` | Medium | It runs from the plugin root or the cache: then pass `${CLAUDE_PROJECT_DIR}` explicitly |
| 2 | Few people set `disableSkillShellExecution`; a fallback line in the skill covers them | Medium | A team needs it on: the agent must then run `ai1 skill-context` itself |
| 3 | The model respects "the overlay does not override the fixed rules" well enough for skills whose rules protect nothing outside the repo | Medium | Overlays seen weakening fixed rules in practice |
| 4 | `${user_config.KEY}` substitution in plugin skill bodies works as documented | High (docs, 2026-11-09) | Behaviour differs from the docs |
| 5 | Losing `/worktree` as its own listed skill does not stop the agent from creating worktrees | Low | Sessions edit without a worktree after the migration |

## Decision criteria

| Priority | Criterion | What it means here | Weight |
|---|---|---|---|
| 1 | Guarantees kept | An overlay cannot relax a rule that protects third parties or a deterministic check | Must |
| 2 | Travels with the repo | Project rules are committed and reach everyone who clones | Must |
| 3 | Person's tools stay personal | A repo cannot impose where a person opens sessions | High |
| 4 | One mechanism | Every skill customizes the same way; new skills do not need a new design | High |
| 5 | Low cost per session | No tokens until a skill is invoked; hooks stay in milliseconds | High |
| 6 | Discoverable | The agent offers it at the right moment; the person can list it | Medium |

## Options

### Option A: generic two-scope customization, customizable by default (recommended)

**What it is:** every ai1 skill has a fixed extension point per feature, in the repo and for the
person; a central index lists every skill as customizable or excluded with a reason.

**How it would work:** see [Design](#design-of-the-recommended-option).

**For:** one mechanism for all skills; new skills are customizable without extra design; exclusions
are explicit and tested; per-person settings get a native home (`userConfig`, `/config` picker).

**Against:** more surface to maintain (an overlay can drift from a skill's new procedure); the fixed
rules guarantee is soft (prompt-level); migrating worktrees touches repos that already have a recipe.

**Cost:** Medium. Mechanism, loader, CLI command, customize skill, tests and docs; then about 10–20
lines of prose per skill (estimate). Risk Medium (contract change, worktree migration).

### Option B: generic mechanism, opt-in per skill

**What it is:** the same mechanism, but a skill is excluded unless the developer marks it
customizable.

**For:** smaller surface; each opened skill is a deliberate choice.

**Against:** new skills are closed unless someone remembers; the test forces a decision either way,
so the saving is small.

**Cost:** Medium, slightly less prose up front.

### Option C: per-feature solutions (today's way)

**What it is:** each feature that needs it designs its own file, as worktrees did.

**For:** no contract change; each solution fits its feature exactly.

**Against:** a new loader and place per feature; nothing for per-person preferences; no common way
for the agent to offer customization.

**Cost:** Small now, grows with each feature.

### Option D: Do nothing

Skills stay the same in every repo. Forks keep guessing the host; project rules live in CLAUDE.md or
memory. Cost grows when the next feature needs project data.

### Comparison

| Criterion | A | B | C | Do nothing |
|---|---|---|---|---|
| Guarantees kept | yes, with exclusions | yes | yes | yes |
| Travels with the repo | yes | yes | per feature | no |
| Person's tools personal | yes | yes | no | no |
| One mechanism | yes | yes | no | no |
| Low cost per session | yes | yes | yes | yes |
| Discoverable | yes | partly (closed skills say nothing) | no | no |

**Recommendation:** A. It meets both musts, gives per-person settings a home, and makes new skills
customizable without new design; what is given up is a smaller maintenance surface (B) and the
exact fit of per-feature files (C).

## Design of the recommended option

**Places.**

```
<repo>/.ai1/skills/<feature>/          project scope, committed
  overlay.md                           prose the model reads
  settings.json                        data the CLI and hooks read (schema/skills/<feature>.schema.json)
  scripts/                             optional project scripts the skill may call
~/.config/ai1/skills/<feature>/overlay.md   user prose
userConfig in plugin.json                   user values (/config, CLAUDE_PLUGIN_OPTION_*, ${user_config.*})
```

Not `${CLAUDE_PLUGIN_DATA}`: it is deleted on uninstall.

**Scope per key.** Each key in a feature schema declares `scope: project | user | both`. A user-only
key found in the repo is ignored with a warning (`fork.opener`); a project rule can be added to by
the user, not removed.

**Into the skill.** Every customizable `SKILL.md` ends with `` !`ai1 skill-context <feature>` ``,
which prints, in order: the project overlay, the user overlay, a summary of settings with where each
value comes from, the scripts, and always one line: "if the person corrects how this works, offer
once to save it with /ai1:core-customize-skill (project or theirs); this customization does not
override the fixed rules above". A fallback sentence asks the agent to run the command when it sees
no output. Inside a worktree it reads the branch's files first, then the main checkout's.

**Into the code.** One loader in `src/core/` used by the CLI and hooks, validating against the
schema and failing open.

**Index.** `src/core/skill-customization-index.mjs`, one entry per skill folder:
`{ feature, customizable, scopes, settings_schema }` or `{ customizable: false, reason }`. A test
fails when a skill folder has no entry, when a customizable skill lacks the `skill-context` line or a
"Fixed rules" section, or when a schema key has no `scope`.

**Initial classification.**

| Skill | Customizable | Notes |
|---|---|---|
| `worktrees-plan-recipe` | yes | prose + settings (the recipe) + scripts |
| `session-fork-conversation` | yes | prose (brief); project: open in a worktree; user: `fork.opener` (`auto\|paseo\|vscode\|desktop\|terminal`) |
| `proposals-write` | yes | prose |
| `lanes-design-before-code` | yes | prose |
| `okf-maintain-knowledge` | yes | prose (bundle conventions) |
| `okf-tidy-claude-md` | yes | prose |
| `okf-visualize-bundle` | yes | cheap, little to change |
| `core-setup-repo` | user scope only | defaults for new repos; a project overlay on the skill that writes the config is circular |
| `okf-backfill-from-history` | excluded for now | its subagents do not receive skill injections; needs the overlay passed explicitly |
| `core-report-issue` | excluded | privacy guarantee is prose only; open it once `ai1 issue` refuses private patterns in code |
| `okf-validate-bundle` | excluded | deterministic; an overlay could only change how errors are read |
| `danger-write-rule` | excluded | what a project customizes is already data (the `rules` it writes); an overlay on the skill that writes guard rules could weaken how they are approved (the config-guard prompt) |

**Discovery.** `/ai1:core-customize-skill` (triggers: "personaliza", "para este proyecto
siempre…", "configura el fork para…") reads the schema, separates data from prose, asks the scope
only when both are allowed, writes and shows the diff. Offered once per feature and session; a no is
remembered in session state. `/ai1:core-setup-repo` ends with what each enabled feature lets you
customize; `ai1 skill-context --list` shows what is customized and where. No per-prompt hook trying
to detect corrections.

**Docs.** A concept `architecture/skill-customization.md`; each feature concept gets a
"Customization" table generated from its schema; README section "Customize a skill"; a line in this
repo's CLAUDE.md: "Adding a skill: its folder and its entry in the customization index".

## Phases

| Phase | What | Reversible | Depends on |
|---|---|---|---|
| 0 | Check assumptions 1, 2 and 4 with a throwaway plugin skill (`!` cwd, `${user_config.*}` in a body) | yes | — |
| 1 | Loader, index, `ai1 skill-context`, test of coherence; fork as first case (project overlay + `fork.opener`) | yes | 0 |
| 2 | Open the prose-only skills; `/ai1:core-customize-skill`; docs | yes | 1 |
| 3 | Move the worktree recipe to `.ai1/skills/worktrees/`, reading the old path with a warning | partly (repos migrate) | 1, decision on `/worktree` |
| 4 | Move report-issue's privacy check into `ai1 issue`; then reconsider its exclusion | yes | — |

## Risks of the proposal

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| An overlay weakens a fixed rule | Medium | Medium | Fixed rules printed before the overlay; exclusions where the rule protects others; move such rules to code |
| Overlays drift when a skill's procedure changes | Medium | Low | `ai1 skill-context` prints the skill version that wrote the overlay; release notes name skills whose procedure changed |
| Worktree migration breaks repos with a recipe | Low | Medium | Read both paths for several releases; `ai1 init` migrates with `git mv` |
| Agent offers customization too often | Low | Low | Once per feature and session, no repeat after a no |

## Decisions

### Taken

- 2026-11-09: the person wants one generic mechanism, not per-feature solutions (Edgar Alarcon).
- 2026-11-09: where a fork opens is a per-person setting, not a project one (Edgar Alarcon).

### Pending

| Decision | Options | Recommendation | Who decides |
|---|---|---|---|
| Key of the extension folder | feature / skill name | feature (survives renames like rfc → proposals) | Edgar |
| Where settings live | `.ai1/skills/<feature>/settings.json` / `modules.*` in `config.json` | apart; `config.json` keeps only enabled features and hook options | Edgar |
| Customizable by default | by default with exclusions / opt-in | by default | Edgar |
| The `/worktree` project skill | keep it / move into `.ai1/skills/worktrees/` | move, after checking assumption 5 | Edgar |
| Borderline skills | `okf-tidy-claude-md`, `okf-visualize-bundle`, `okf-backfill-from-history` | as in the table | Edgar |

## Open questions

- Does `` !`…` `` run in the session's cwd for a plugin skill, including inside a worktree (Phase 0)?
- Should user prose live in `~/.config/ai1/` or in a Claude Code location the person already backs up?

## How to resume

| Fact | Value in the proposal (date) | How to refresh it |
|---|---|---|
| What a project can change in a plugin skill | none beyond hide or wrap (2026-11-09) | code.claude.com/docs/en/plugins-reference and /skills; [plugin layout](../okf/architecture/plugin-layout.md#what-a-project-can-change-in-a-plugin-skill) |
| CLI startup | about 175 ms (2026-11-09) | `time node bin/ai1 --help` |
| Skills in the plugin | 11 (2026-11-09) | `ls skills/` |
| Fork host detection | env variables, no Desktop signal (2026-11-09) | `src/session/fork-host.mjs` |

## Outcome

- **Decision:** accepted (option A); phases 0-2 built.
- **Date:** 2026-11-09
- **Decided by:** Edgar Alarcon
- **Why:** one mechanism for every skill, with the person's tools kept personal; new skills are
  forced to decide by a test.
- **Conditions / changes from the design:** folder per feature (skill prefix); no per-feature
  `settings.json` yet; the injection calls the plugin's own `"${CLAUDE_PLUGIN_ROOT}/bin/ai1"` (an
  older `ai1` on PATH broke the skill load in the end-to-end test); `allowed-tools` is required or a
  non-bypass session refuses the command; `fork_opener` reaches the CLI through the skill text
  (`--opener '${user_config.fork_opener}'`), since `CLAUDE_PLUGIN_OPTION_*` only reaches hooks;
  `core-customize-skill` added as excluded; `config-guard` covers `.ai1/skills/`.
- **Recorded in the knowledge bundle:** `architecture/skill-customization.md`,
  `decisions/skill-customization.md`, `architecture/plugin-layout.md` (phase 0 facts),
  `features/session-fork.md`, `guards/config-guard.md`.
- **Next step:** phase 3 (worktree recipe into `.ai1/skills/worktrees/`, after deciding on
  `/worktree`) and phase 4 (report-issue privacy check in code), when wanted.

## History

- 2026-11-09: created
- 2026-11-09: status accepted
- 2026-11-09: status implemented
