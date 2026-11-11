---
type: Architecture
title: Skill customization - project and user overlays
description: How a repo or a person adds rules to an ai1 skill without touching the plugin - overlays injected when the skill loads (ai1 skill-context), the customization index and its test, Fixed rules, the fork_opener plugin option and /ai1:core-customize-skill.
tags: [skills, customization, overlay, userConfig, cli]
resource: src/core/skill-customization.mjs
sources:
  - id: customization-index
    resource: src/core/skill-customization-index.mjs
    title: which skills are customizable, at which scopes, or why not
  - id: skill-context-command
    resource: src/cli/skill-context-command.mjs
    title: ai1 skill-context <skill> | --list
  - id: coherence-test
    resource: test/skill-customization.test.mjs
    title: loader tests and the index/SKILL.md coherence test
  - id: customize-skill
    resource: skills/core-customize-skill/SKILL.md
    title: /ai1:core-customize-skill
  - id: fork-opener
    resource: src/session/fork-host.mjs
    title: applyForkOpener
  - id: proposal-0001
    resource: .ai1/later/0001-skill-customization.md
    title: Later 0001
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T09:16:28Z'
---

Built 2026-11-09 from later 0001 (phases 0-2); decision in
[skill customization decision](../decisions/skill-customization.md). A plugin skill runs from the
user's cache and a project cannot replace or extend it (see
[plugin layout](plugin-layout.md#what-a-project-can-change-in-a-plugin-skill)), so ai1 injects the
customization itself.

# Two scopes

| Scope | Where | For |
|---|---|---|
| Project | `.ai1/skills/<feature>/overlay.md`, committed | rules of this repo, for everyone |
| Person (prose) | `~/.config/ai1/skills/<feature>/overlay.md` (`$XDG_CONFIG_HOME/ai1/...`) | habits, in every repo |
| Person (values) | plugin `userConfig` in `/config` (today: `fork_opener`) | tools of the person |

`<feature>` is the skill folder prefix (`session-fork-conversation` -> `session`); the okf skills share
`okf`. Not `${CLAUDE_PLUGIN_DATA}`: it is deleted on uninstall. There is no per-feature
`settings.json`: project data stays in `.ai1/config.json` `modules.*` and the worktree recipe.

# How it reaches the model

Each customizable `SKILL.md` ends with `## Fixed rules`, a `## Customization` paragraph and, as its
last line, `` !`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context <skill>` ``. When the skill is invoked,
Claude Code runs it in the session's directory and puts its output in place of the line, so the model
gets one block: procedure, fixed rules, then `## ai1 customization` with the project overlay (the
worktree's own first, else the main checkout's), the person's, and a footer: offer once to save a
correction with /ai1:core-customize-skill, and the precedence (fixed rules > project > person).
Nothing is loaded before the skill runs.

- `allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)` in the frontmatter: without
  it a clean (non-bypass) session refuses the command and the skill does not load.
- The plugin's own `bin/ai1`, not `ai1` from PATH: another ai1 earlier on PATH (an older install, a
  parent session) answered with its usage and exit 1, which broke the skill load (seen in the
  end-to-end test).
- `ai1 skill-context` never fails: excluded or unknown skill prints nothing; an unreadable overlay is
  a note; an overlay over 8 KB is cut with a note; any other error prints nothing; exit 0 always.
- `ai1 skill-context --list [--json]`: every skill, customizable (scopes) or why not, and the
  overlays found.

# Which skills

`src/core/skill-customization-index.mjs` has one entry per skill folder; the coherence test fails
when a folder has no entry, an entry has no folder, a customizable skill lacks the permission, a
`## Fixed rules` bullet or the injection as last line, or an excluded one has them. Customizable:
worktrees-plan-recipe, session-fork-conversation, later-write, sizing-design-before-code,
okf-maintain-knowledge, okf-tidy-claude-md, okf-visualize-bundle, verify-debug-systematically,
verify-evaluate-llm-prompts,
storyboard-record-flow (project and person) and
core-setup-repo (person only). Excluded, with the reason in the index: okf-backfill-from-history,
core-report-issue, okf-validate-bundle, danger-write-rule, core-customize-skill.

# Around it

- `/ai1:core-customize-skill` writes overlays after the person approves the exact text; points data
  to its place (`/config`, `modules.*`, the recipe) and "never do X" to /ai1:danger-write-rule.
- [config-guard](../guards/config-guard.md) asks before any change under `.ai1/skills/`.
- `fork_opener` (`auto|paseo|vscode|desktop|terminal`, default auto): the fork skill passes
  `--opener '${user_config.fork_opener}'` to `ai1 fork` (single quotes: unset, the literal reaches
  the CLI and means auto). See [session fork](../features/session-fork.md).
- `/ai1:core-setup-repo` closes with one line on customization.

# Limits

- The precedence is told to the model, not enforced: an overlay can still contradict a fixed rule.
- A skill's `description` cannot be customized: it loads before any injection, so an overlay changes
  how a skill works, not when it triggers.
- `CLAUDE_PLUGIN_OPTION_*` reaches hooks only; the CLI gets user values from the skill text.
- Other `ai1 …` commands in skills still use `ai1` from PATH (same stale-PATH risk, outside this work).
- Planned (later 0001 phases 3-4): the worktree recipe into `.ai1/skills/worktrees/`, and opening
  core-report-issue once its privacy check is in code.

# Verified

- 2026-11-09, Claude Code 2.1.319: `claude -p --plugin-dir <worktree>` in a scratch repo with a clean
  `CLAUDE_CONFIG_DIR` (no bypass), a project overlay, a person overlay through `XDG_CONFIG_HOME` and a
  saved `fork_opener`: proposals-write received both overlays in order with the footer;
  session-fork-conversation showed `ai1 fork host --opener 'paseo'` and the person overlay;
  core-report-issue received no customization section. `npm test` green.
