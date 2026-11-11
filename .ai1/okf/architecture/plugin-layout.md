---
type: Architecture
title: Plugin layout and distribution
description: ai1 is a Claude Code plugin and its own marketplace in the same repo.
tags: [plugin, marketplace, distribution]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-11T09:16:28Z'
---

# Layout

```
.claude-plugin/plugin.json        manifest (name, version; skills/ and agents/ found by default)
.claude-plugin/marketplace.json   marketplace "ai1" with one plugin, source "./"
hooks/hooks.json                  every event -> node bin/ai1-hook.mjs <Event>
bin/ai1-hook.mjs  bin/ai1         hook entry point and the CLI (on the Bash PATH)
src/                              core runtime and one folder per feature
skills/<module>-<action>/         every skill, OKF ones included
agents/                           bundle-weaver, event-analyzer (OKF backfill)
vendor/yaml/                      PyYAML for the OKF scripts
schema/  templates/config.json    the per-repo contract
```

# Skill names

Every skill is `/ai1:<module>-<what it does>` so its owner and purpose read from the name:
`core-setup-repo`, `core-report-issue` ([issue report](../features/issue-report.md)), `sizing-design-before-code`, `later-write`, `worktrees-plan-recipe`,
`session-fork-conversation` ([session fork](../features/session-fork.md)), `storyboard-record-flow`
([storyboard](../features/storyboard.md)), `core-customize-skill`
([skill customization](skill-customization.md)), and
from the OKF pack `okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle`,
`okf-backfill-from-history` (see [OKF toolkit](../packs/okf-pack.md)), plus `okf-tidy-claude-md`
written in ai1 ([okf feature](../features/okf.md)). Claude Code
has no nested skill names, so the module is a prefix; it names a plugin skill by its folder, so
the folder carries the full name. Each description starts with its module.

# What ai1 writes in a repo

All under `.ai1/` (constants in `src/core/config.mjs`): `config.json` (the
[contract](harness-contract.md)), `okf/` (the bundle, a fixed path since v0.16.0), `later/` (called `rfc/` until v0.17 and `proposals/` until v0.24) and `work/`, which ignores
itself with its own `.gitignore`. `.ai1/skills/<feature>/overlay.md` holds the project's skill customizations
([skill customization](skill-customization.md)). Outside it only `.claude/settings.json` (Claude Code reads it
there), the worktree recipe `.claude/skills/worktree/` (must be a project skill) and session state
in `${CLAUDE_PLUGIN_DATA}` or `~/.cache/ai1`.

`ai1 init` first migrates the layout of the former name `jig` (`.claude/jig.json`, `.okf/`,
`docs/rfc/` when the rfc feature was on, `.jig/work/`, `jig@jig` in settings), and a bundle at the
path of the retired `knowledge` setting, with `git mv`,
and `.ai1/rfc/` of ai1 before v0.18.0 or `.ai1/proposals/` before v0.25.0 (renamed to later, see the
[later feature](../features/later.md)), rewriting links inside the moved bundle and later entries; it refuses if a target exists
(`src/cli/legacy-migration.mjs`). A session in an old layout is told to run `/ai1:core-setup-repo`.

`CLAUDE.md` at the root is for developing ai1; Claude Code does not load it as plugin context
(`claude plugin validate .` warns about it, which is expected).

# Install

- Per user: `/plugin marketplace add Edvantage26/ai1` then `/plugin install ai1@ai1`.
- Per project (offered to whoever clones): commit `extraKnownMarketplaces` (github source
  `Edvantage26/ai1`) and `enabledPlugins: {"ai1@ai1": true}` in the project's `.claude/settings.json`.
- One install per machine is enough: a user-scope install serves every repo whose committed settings
  enable the plugin; a project-scope install next to it is a second copy that can fall behind.
- Updates are not automatic for a third-party marketplace: `autoUpdate: true` under
  `extraKnownMarketplaces.ai1` works only in **user** settings (Claude Code ignores it in project or local
  settings and copies it to `known_marketplaces.json` at session start); otherwise `claude plugin update`.
- `claude plugin uninstall ai1@ai1 --scope project` also empties `enabledPlugins` in the repo's committed
  `.claude/settings.json`: restore that file (`git checkout -- .claude/settings.json`) afterwards.

# Versioning

`plugin.json` and `marketplace.json` versions move together; releases are git tags. Validate with
`claude plugin validate .` before tagging.

Release steps: bump the version in `plugin.json`, `marketplace.json`, `package.json`, the README
status line and the [overview](../overview.md) status; `npm test`, `claude plugin validate .` and the
OKF validator; commit, annotated tag `vX.Y.Z`, push `main` and the tag. Then
`claude plugin marketplace update ai1` and `claude plugin update ai1@ai1 --scope user` (and
`--scope project` per repo that installs it), and restart Claude Code: a running session keeps the
hooks it started with.
Run from inside this repo, `claude plugin update ai1@ai1` without `--scope` updates only the project
install of this repo; the user install, used by every other repo, stays on the old version (seen on
2026-11-09 with v0.26.0). Check with `claude plugin list`.

Before tagging, check that nothing private reached the public repo (rule in CLAUDE.md): `git grep -n -i -E`
over machine paths (`/home/`), personal tooling (sync mounts, password managers, task trackers), internal
hostnames, IPs and client names, plus a read of every hit outside `THIRD-PARTY.md`. Expected hits are
generic: a product named as an example, Paseo as a fork host detected by `PASEO_AGENT_ID`, the author in
`plugin.json`/`LICENSE`. Done for v0.27.0 on 2026-11-09: clean.

To check a release end to end, run a fresh session on a throwaway clone with its remote removed
(`git clone` into `/tmp`, `git remote remove origin`): a Paseo agent in the mode to test, with a task
that used to trigger the behaviour, then read its transcript and its entries in the decision log
(`ai1 log --all`, or the session's lines in the state `decisions-*.jsonl`). `claude -p` works too
while its OAuth session is valid.

# What a project can change in a plugin skill

Checked against the Claude Code docs (plugins reference, skills) on 2026-11-09:

- A plugin skill runs from the user's cache (`~/.claude/plugins/cache/ai1/ai1/<version>/`, one
  folder per version, replaced on update; `installed_plugins.json` records which version each scope
  uses). Edits there are lost, and nothing in it is per repo.
- A project cannot replace or extend a plugin skill: a project skill with the same name loads beside
  it (the plugin one is namespaced), and `skillOverrides` in settings only changes visibility
  (`off`, `name-only`, `user-invocable-only`).
- `userConfig` values are per user (`pluginConfigs` in settings, sensitive ones in the keychain).
  They reach skill and agent bodies as `${user_config.KEY}` (non-sensitive only), exec-form hook
  `args`, MCP and LSP config, and every hook as `CLAUDE_PLUGIN_OPTION_<KEY>`; a `string` with
  `options` shows as a picker in `/config`.
- A skill body can inject a command's output at load time with `` !`command` `` (or a ```` ```! ````
  block), run once; `disableSkillShellExecution` turns it off. `${CLAUDE_PROJECT_DIR}`,
  `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_DATA}` are substituted in the
  body; none of them reaches subagents a skill dispatches.
- `${CLAUDE_PLUGIN_DATA}` (`~/.claude/plugins/data/<id>/`) survives updates but is deleted on
  uninstall, so it does not suit user preferences.
- Measured: starting `node bin/ai1` takes about 175 ms.
- Tested on Claude Code 2.1.319 with a throwaway plugin (2026-11-09):
  - `` !`…` `` in a plugin skill runs in the session's directory (the project); `${CLAUDE_PROJECT_DIR}`
    and `${CLAUDE_SKILL_DIR}` are substituted in the body but are not environment variables of the
    command. The plugin's `bin/` is on its PATH.
  - Without bypass permissions, a plugin `bin/` command in `!` needs approval and the whole skill
    fails to load ("requires approval"); `allowed-tools: Bash(<command> *)` in the skill frontmatter
    pre-approves it. `pwd` and `cat` ran without it.
  - `${user_config.KEY}` is substituted only when a value is saved; the manifest `default` is not
    applied and the literal `${user_config.KEY}` stays. Saved values live at
    `pluginConfigs["<plugin>@<marketplace>"].options.<key>` (the docs omit `.options`), read from user,
    `--settings` or managed settings; a `--plugin-dir` plugin is `<plugin>@inline`.
  - `CLAUDE_PLUGIN_OPTION_<KEY>` reaches hooks only, not commands run through the Bash tool.
  - How to redo it: a plugin folder with `.claude-plugin/plugin.json` (a `userConfig` field) and one
    skill whose body echoes `` !`pwd` ``, `${CLAUDE_PROJECT_DIR}`, `${user_config.KEY}` and a `bin/`
    command; run `claude -p --plugin-dir <plugin> "/<plugin>:<skill>" < /dev/null` from a scratch
    repo with `CLAUDE_CONFIG_DIR` pointing to a clean folder whose `settings.json` holds
    `pluginConfigs` (authenticate with a token in the environment, since that folder has no login).

So per-repo behaviour has to live in the repo (`.ai1/`, or a project skill as the worktree recipe
does) and be read by the plugin skill or the CLI; per-person behaviour fits `userConfig`. ai1 does
both: see [skill customization](skill-customization.md).

# Dogfooding

This repo enables ai1 like any other repo (`.ai1/config.json` + `.claude/settings.json`), so its
sessions run the **published** version from `~/.claude/plugins/cache/ai1/ai1/<version>/`, not the
working tree: a change here is not active until it is released and the plugin updated. To try
unreleased hooks or skills, start a session with `claude --plugin-dir <path to this repo>`.
