---
type: Architecture
title: Plugin layout and distribution
description: ai1 is a Claude Code plugin and its own marketplace in the same repo.
tags: [plugin, marketplace, distribution]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T04:16:07Z'
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
`core-setup-repo`, `lanes-design-before-code`, `rfc-write-proposal`, `worktrees-plan-recipe`,
`session-fork-conversation` ([session fork](../features/session-fork.md)), and
from the OKF pack `okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle`,
`okf-backfill-from-history` (see [OKF toolkit](../packs/okf-pack.md)). Claude Code
has no nested skill names, so the module is a prefix; it names a plugin skill by its folder, so
the folder carries the full name. Each description starts with its module.

# What ai1 writes in a repo

All under `.ai1/` (constants in `src/core/config.mjs`): `config.json` (the
[contract](harness-contract.md)), `okf/` (default bundle path), `rfc/` and `work/`, which ignores
itself with its own `.gitignore`. Outside it only `.claude/settings.json` (Claude Code reads it
there), the worktree recipe `.claude/skills/worktree/` (must be a project skill) and session state
in `${CLAUDE_PLUGIN_DATA}` or `~/.cache/ai1`.

`ai1 init` first migrates the layout of the former name `jig` (`.claude/jig.json`, `.okf/`,
`docs/rfc/` when the rfc feature was on, `.jig/work/`, `jig@jig` in settings) with `git mv`,
rewriting links inside the moved bundle and RFCs; it refuses if a target exists
(`src/cli/legacy-migration.mjs`). A session in an old layout is told to run `/ai1:core-setup-repo`.

`CLAUDE.md` at the root is for developing ai1; Claude Code does not load it as plugin context
(`claude plugin validate .` warns about it, which is expected).

# Install

- Per user: `/plugin marketplace add Edvantage26/ai1` then `/plugin install ai1@ai1`.
- Per project (offered to whoever clones): commit `extraKnownMarketplaces` (github source
  `Edvantage26/ai1`) and `enabledPlugins: {"ai1@ai1": true}` in the project's `.claude/settings.json`.

# Versioning

`plugin.json` and `marketplace.json` versions move together; releases are git tags. Validate with
`claude plugin validate .` before tagging.

Release steps: bump the version in `plugin.json`, `marketplace.json`, `package.json`, the README
status line and the [overview](../overview.md) status; `npm test`, `claude plugin validate .` and the
OKF validator; commit, annotated tag `vX.Y.Z`, push `main` and the tag. Then
`claude plugin marketplace update ai1` and `claude plugin update ai1@ai1 --scope user` (and
`--scope project` per repo that installs it), and restart Claude Code: a running session keeps the
hooks it started with.

# Dogfooding

This repo enables ai1 like any other repo (`.ai1/config.json` + `.claude/settings.json`), so its
sessions run the **published** version from `~/.claude/plugins/cache/ai1/ai1/<version>/`, not the
working tree: a change here is not active until it is released and the plugin updated. To try
unreleased hooks or skills, start a session with `claude --plugin-dir <path to this repo>`.
