---
type: Architecture
title: Plugin layout and distribution
description: ai1 is a Claude Code plugin and its own marketplace in the same repo.
tags: [plugin, marketplace, distribution]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T10:00:39Z'
---

# Layout

```
.claude-plugin/plugin.json        manifest (name, version; skills/ found by default)
.claude-plugin/marketplace.json   marketplace "ai1" with one plugin, source "./"
hooks/hooks.json                  every event -> node bin/ai1-hook.mjs <Event>
bin/ai1-hook.mjs  bin/ai1         hook entry point and the CLI (on the Bash PATH)
src/                              core runtime and one folder per feature
skills/<module>-<action>/         every skill, OKF ones included
vendor/js-yaml/                   js-yaml for the OKF validator and viewer (`ai1 okf ...`)
schema/  templates/config.json    the per-repo contract
```

# Skill names

Every skill is `/ai1:<module>-<what it does>` so its owner and purpose read from the name
(`core-setup-repo`, `later-write`, `session-fork-conversation`); the folders under `skills/` are the
list, and each feature concept names its own skills. The OKF ones come from the OKF pack
([OKF toolkit](../packs/okf-pack.md)), except `okf-tidy-claude-md`, written in ai1. Claude Code
has no nested skill names, so the module is a prefix; it names a plugin skill by its folder, so
the folder carries the full name. Each description starts with its module.

# Which skills the agent sees

Claude Code lists every installed plugin skill (name and description) to the agent in every session,
in every repo. The description is how the agent picks a skill, and each one costs context everywhere,
so descriptions say what the skill is for and its trigger phrases; how it works lives in its body
(trimmed 2026-11-13, from about 1,400 to 1,100 words in all). The exclusion text in `later-write`
stays on purpose ([later](../features/later.md)).

In a repo with ai1, the skills of a **disabled feature** leave the agent's list but stay callable by
the person: `skillOverrides["ai1:<skill>"] = "user-invocable-only"` in the committed
`.claude/settings.json` (`src/core/skill-visibility.mjs`). Skills of an always-on feature (`core-*`)
or of no feature (`session-*`) are always listed. `ai1 init` writes it from the chosen features
([init](../features/init.md)); migration 3 does it once in repos set up before
([migrations](migrations.md)); the session `brief` says so when `features` was edited by hand and the
two no longer match. ai1 touches only `ai1:` keys, removes only its own `user-invocable-only` and
leaves a person's `off` alone. A repo without ai1 set up still lists every skill.

`skillOverrides` (read in the Claude Code 2.1.319 source on 2026-11-13, not tried in a live
session): a settings field, values `on`, `name-only` (listed without description),
`user-invocable-only` (hidden from the model, `/name` kept), `off` (hidden from both); matched against
the skill's full name (`ai1:later-write`) and its aliases.

# What ai1 writes in a repo

All under `.ai1/` (constants in `src/core/config.mjs`): `config.json` (the
[contract](harness-contract.md)), `okf/` (the bundle, a fixed path since v0.16.0), `later/` (called `rfc/` until v0.17 and `proposals/` until v0.24) and `work/`, which ignores
itself with its own `.gitignore`. `.ai1/skills/<feature>/customization.md` holds the project's skill customizations
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
- Claude Code registers a **project-scope** install by itself at session start in a repo whose committed
  settings enable the plugin, pinned to the version current at that moment, and the user install's
  `autoUpdate` does not move it. Seen on 2026-11-14: nine repos of one machine held project entries from
  0.30.2 to 0.36.0 (one for a worktree long gone) next to a user install on the latest. Cleanup that keeps
  the committed settings: back up `~/.claude/plugins/installed_plugins.json`, drop the `ai1@ai1` entries
  with `scope: project`, check `claude plugin list`; old folders under
  `~/.claude/plugins/cache/ai1/ai1/<version>/` can go once no session runs from them (a running session
  keeps executing the hooks of the version it started with). The entry comes back at the next session
  start, but on the current version.
- It keeps coming back: on 2026-11-22, eight days after that cleanup, the same machine held 22 project
  entries (0.38.0 to 0.58.0), several of them for worktrees under `.claude/worktrees/` (each worktree
  session registers its own path, and the entry outlives the worktree). Check with `claude plugin
  list` (ai1 should show only `Scope: user`); the same cleanup applies to any other plugin whose
  marketplace was removed or archived (its entry and its `cache/<marketplace>/` folder).

# The stable ai1 launcher

Claude Code fixes `${CLAUDE_PLUGIN_ROOT}` and puts the plugin's `bin/` on PATH when a session starts.
An autoupdate removes the old `~/.claude/plugins/cache/ai1/ai1/<version>/` folder even while sessions
still point at it (seen 2026-11-14, 0.36.0 -> 0.38.0, issue #1), so skill injections and every `ai1 …`
in Bash failed with "No such file" or "command not found".

At SessionStart, in every repo, `bin/ai1-hook.mjs` runs `installStableLauncher`
(`src/core/stable-launcher.mjs`):

- it writes `${CLAUDE_PLUGIN_DATA}/bin/ai1` (POSIX sh; the data folder survives updates) when its text
  changes, write then rename;
- it appends `export AI1_PLUGIN_ROOT=<root>` and `export PATH=<data>/bin:"$PATH"` once to
  `CLAUDE_ENV_FILE`, which Claude Code sources before every Bash command.

The launcher runs `node <root>/bin/ai1` with the first root that still has `bin/ai1`:
`$AI1_PLUGIN_ROOT` (this session's version), the root that wrote it (the last session started), else
the highest `X.Y.Z` folder next to it in the cache (never for a `--plugin-dir` root). With none left it
exits 127 with a message. It also exports `AI1_PLUGIN_DATA` (its own data folder) to the CLI: the
session's Bash has no `CLAUDE_PLUGIN_DATA`, and `resolveStateDirectory` (`src/core/session-state.mjs`)
falls back to that variable, so session state the CLI writes (`ai1 delegate allow`, one-time allows)
lands in `<data>/state/` where the hooks read it, not in `~/.cache/ai1` (issue #2). Skills call
`"${CLAUDE_PLUGIN_DATA}/bin/ai1"`. Hooks keep `${CLAUDE_PLUGIN_ROOT}`: Claude Code runs them and ai1
cannot redirect them. Tests: `test/stable-launcher.test.mjs`.

# Versioning

`plugin.json` and `marketplace.json` versions move together; releases are git tags. Validate with
`claude plugin validate .` before tagging.

Release steps: bump the version in `plugin.json`, `marketplace.json`, `package.json` and the
[overview](../overview.md) status (the README shows the latest tag through its release badge); `npm test`, `claude plugin validate .` and the
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
generic: a product named as an example, the retired `paseo` fork opener value (only a note), the author in
`plugin.json`/`LICENSE`. Done for v0.27.0 on 2026-11-09: clean.

After the push, check CI (`gh run list --repo Edvantage26/ai1 --limit 1`, then `gh run view <id>` for
the failing job's log): a red `main` is not seen otherwise. Seen on 2026-11-18 (v0.49.0): CI had been
red since v0.45 for two reasons unrelated to those releases - the runner had no git identity, so the
worktree tests that commit and rebase failed (now a CI step sets one), and a test used
`import.meta.dirname`, which needs Node 20.11 while the matrix runs Node 18 (use
`fileURLToPath(new URL(..., import.meta.url))`). The `test-windows` job runs only the cross-platform
test files ([principles](../decisions/principles.md)).

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
- Plugin agents, from the subagents docs (2026-11-14; not yet run, see below):
  - They keep `tools`, `disallowedTools` and `model`; `hooks`, `mcpServers` and `permissionMode` are
    ignored, so a plugin agent cannot bring its own MCP server (a browser, for instance).
  - `tools: mcp__<server>__*` allows a whole MCP server; if no entry resolves, the agent does not
    launch. MCP server names differ per install (`playwright`, `playwright-rec`,
    `plugin_playwright_playwright`...), so an allowlist cannot cover "whatever browser the person has".
  - `disallowedTools` (built-ins only: Read, Grep, Glob, Bash, Edit, Write, NotebookEdit, LSP, WebFetch,
    WebSearch, Agent, Skill) works whatever the browser server is called, but keeps every other MCP
    server of the session, and a new built-in tool gets through. Neither form removes
    `browser_evaluate` / `browser_run_code_unsafe` without naming them per server.
  - Weighed for the usability user-agent ([design](../features/design.md)): kept as a general-purpose
    subagent with its brief; a named agent only closes repo access, not page source.
  - To try an agent: agents are not hot-loaded (a file added to `~/.claude/agents/` mid-session is
    "not found"); start a new session with `claude --plugin-dir <plugin>`. A nested `claude -p` needs
    the CLI's own login and fails with "OAuth session expired" when it has lapsed.
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
