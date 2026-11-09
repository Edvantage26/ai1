---
type: Architecture
title: Hook runtime (dispatcher and modules)
description: One entry point per hook event that loads .ai1/config.json and runs the enabled modules.
tags: [hooks, runtime, modules]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T07:54:49Z'
---

# Flow

`hooks/hooks.json` wires every event to the same command:
`node "${CLAUDE_PLUGIN_ROOT}/bin/ai1-hook.mjs" <Event>`.

1. `bin/ai1-hook.mjs` reads the hook input JSON from stdin and imports only the modules of this
   event and tool (`loadModulesForEvent` in `src/core/module-index.mjs`). Always exits 0.
2. `src/core/hook-dispatch.mjs` (`dispatchHookEvent`) resolves two roots with `src/core/project-roots.mjs` (from the `.git`
   entries on disk, no git process): the **tree root** (`CLAUDE_PROJECT_DIR`, else input `cwd`; it
   follows `cwd` when that is a linked worktree of the same repository, because Claude Code keeps
   `CLAUDE_PROJECT_DIR` at the launch checkout after EnterWorktree) and the **shared root** (the main
   checkout, for state every worktree shares: `.ai1/work/` plans and approvals). It loads
   `.ai1/config.json` from the tree root with `src/core/config.mjs`, or from the shared root when
   the worktree has none.
   - Missing: ai1 is inactive; only a one-line note at SessionStart.
   - Invalid: inactive; SessionStart tells the agent why.
3. It decides with the metadata of every module (`MODULE_INDEX`): the enabled ones (feature, per-repo
   module switches) are `enabledModules`; of those, the ones for the event and tool that were loaded
   run. `src/core/dispatcher.mjs` (`runHookEvent`) does the same with every module loaded
   (`src/core/registry.mjs`), for tests and in-process callers.
4. `src/core/hook-io.mjs` combines decisions (deny/block > ask > context > allow) and prints the
   JSON each event expects (PreToolUse `permissionDecision`, Stop `decision: block`,
   SessionStart, UserPromptSubmit and PostToolUse `additionalContext`).

# Module contract

`{ id, event, feature, description, toolNames?, run(moduleContext) -> decision }`, where
`moduleContext` has `hookInput`, `config`, `projectRoot` (tree root), `sharedRoot`, `environment`, `homeDirectory`, `enabledModules` and `moduleOptions`
(`modules.<id>` from .ai1/config.json minus `enabled`). Decisions: `allow`, `ask`, `deny`, `block`,
`context`. A reason always says how to carry on.

Adding a module = one file (with its `feature`) + one line in `src/core/module-index.mjs` (id, event,
feature, toolNames, path) + its entry in the schema. `test/dispatcher.test.mjs` fails if the index and
the module file disagree, `test/config.test.mjs` if the schema and the index do.

# Failure policy

A module that throws is reported on stderr (visible in verbose mode) and skipped; the others still
decide. Garbage input makes the entry point exit 0 with no output.

# Current modules

| Module | Event | Feature |
|---|---|---|
| `brief` | SessionStart | core (always on) |
| `okf-index` | SessionStart | okf |
| `okf-claude-md` | SessionStart | okf |
| `okf-recall` | UserPromptSubmit | okf |
| `okf-file-context` | PostToolUse (Read, Edit, Write, MultiEdit) | okf |
| `danger` | PreToolUse (Bash) | danger |
| `okf-upkeep` | Stop | okf |
| `craft-brief` | SessionStart | craft |
| `verify-gate` | Stop | verify |
| `lanes-brief` | SessionStart | lanes |
| `lanes-approval` | UserPromptSubmit | lanes |
| `lanes-gate`, `lanes-escalate` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | lanes |
| `design-brief` | SessionStart | design |
| `design-detect` | PostToolUse (Edit, Write, MultiEdit) | design |
| `worktree-brief` | SessionStart | worktrees |
| `worktree-reminder` | UserPromptSubmit | worktrees |
| `proposals-brief` | SessionStart | proposals |
| `proposals-recall` | UserPromptSubmit | proposals |
| `proposals-upkeep` | Stop | proposals |

Shared helpers in `src/core/`: `shell-parse.mjs` (split commands), `shell-writes.mjs` (files a shell
command writes; used by okf-upkeep and lanes-gate), `session-base.mjs` (HEAD at session start, recorded
by `brief`, okf-index and lanes-brief, never throws; used by okf, lanes and verify), `transcript-scan.mjs`
(incremental transcript reader; okf-upkeep, verify-gate), `session-writes.mjs` (whether a tool call
may change files: edits, subagents and shell commands not known to be read-only; okf-upkeep and
verify-gate skip a session that only read), `path-glob.mjs` (globs for .ai1/config.json
paths), `session-state.mjs` (per-session state files, `readStateJson`, and `claimStopBlock`: the Stop
loop guard - the same findings block once, at most N blocks per session - of okf-upkeep and
proposals-upkeep), `project-paths.mjs` (tool paths relative to the project root; used by lanes and design),
`frontmatter.mjs` (read and write flat YAML frontmatter; okf, lanes and proposals), `git.mjs` (`runGit`,
`tryGit`, `listIgnoredPaths`; every module and the CLI), `json-file.mjs` (`readJsonFile` throws on
invalid JSON for files about to be rewritten, `readJsonFileIfValid`, `writeJsonFile`),
`markdown-files.mjs` (recursive markdown listing), `legacy-layout.mjs` (detection of the old `jig`
layout, so core never imports `src/cli/`). Paths under `.ai1/` (`KNOWLEDGE_BUNDLE_PATH`,
`WORK_DIRECTORY`) are constants in `config.mjs`.
okf-upkeep is split: `okf-session-scan.mjs` (transcript, memories, shell edits of the bundle) and
`okf-validator.mjs` (the Python validator, also used by `ai1 worktree finish`).
The bundle reader `listBundleConcepts` (`src/okf/okf-bundle.mjs`) is shared by okf-recall, design-brief
and the file map; the file map (`src/okf/okf-file-map.mjs`, which concepts describe a file) by
okf-file-context, okf-upkeep and the CLAUDE.md check (`okf-claude-md-check.mjs`, used by
okf-claude-md and `ai1 claude-md`, which also reuses `normalizeKeywords` and `readBodyCodePaths`);
the keyword scoring of okf-recall (`buildKeywordCatalog`, `rankConceptsForPrompt`) by proposals-recall.

See [features](features.md), [okf feature](/features/okf.md), [lanes feature](/features/lanes.md), [craft feature](/features/craft.md), [design feature](/features/design.md), [verify feature](/features/verify.md), [proposals feature](/features/proposals.md), [worktrees feature](/features/worktrees.md), [danger guard](/guards/danger.md).

# Cost

Measured 2026-11-09 on a Bash call in this repo (average of 10): about 162 ms per hook when every
module was imported on every event, about 122 ms since v0.17.0 with only the event's modules (Node
alone takes about 74 ms; a module of a feature the repo turned off is still imported for its event,
the config is read after loading). Context at SessionStart: the `brief` gives a feature with its own
session-start text only its title (about 1.1 KB less here); `okf-index` grows with the bundle index,
capped at 12,000 characters; 0 to about 1 KB per message (`okf-recall`, `proposals-recall`, when they match).

# Verified

- `npm test`: 240 Node tests plus 107 Python tests of the OKF toolkit on 2026-11-09 (94 on 2026-10-31,
  65 on 2026-10-30).
- Real Claude Code sessions with `--plugin-dir` (2026-10-30): SessionStart brief injected;
  `git reset --hard` stopped by `ask` (headless = refused, work kept); `git commit --no-verify`
  refused by `deny`. Headless `claude -p` on the dev server needs the account wrapper for auth.
