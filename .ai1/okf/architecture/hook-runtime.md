---
type: Architecture
title: Hook runtime (dispatcher and modules)
description: One entry point per hook event that loads .ai1/config.json and runs the enabled modules.
tags: [hooks, runtime, modules]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T04:00:04Z'
---

# Flow

`hooks/hooks.json` wires every event to the same command:
`node "${CLAUDE_PLUGIN_ROOT}/bin/ai1-hook.mjs" <Event>`.

1. `bin/ai1-hook.mjs` reads the hook input JSON from stdin. Always exits 0.
2. `src/core/dispatcher.mjs` resolves two roots with `src/core/project-roots.mjs` (from the `.git`
   entries on disk, no git process): the **tree root** (`CLAUDE_PROJECT_DIR`, else input `cwd`; it
   follows `cwd` when that is a linked worktree of the same repository, because Claude Code keeps
   `CLAUDE_PROJECT_DIR` at the launch checkout after EnterWorktree) and the **shared root** (the main
   checkout, for state every worktree shares: `.ai1/work/` plans and approvals). It loads
   `.ai1/config.json` from the tree root with `src/core/config.mjs`, or from the shared root when
   the worktree has none.
   - Missing: ai1 is inactive; only a one-line note at SessionStart.
   - Invalid: inactive; SessionStart tells the agent why.
3. It picks the modules for the event (`src/core/registry.mjs`), filtered by feature, per-repo
   module switches and `toolNames`, and runs each one.
4. `src/core/hook-io.mjs` combines decisions (deny/block > ask > context > allow) and prints the
   JSON each event expects (PreToolUse `permissionDecision`, Stop `decision: block`,
   SessionStart, UserPromptSubmit and PostToolUse `additionalContext`).

# Module contract

`{ id, event, feature, description, toolNames?, run(moduleContext) -> decision }`, where
`moduleContext` has `hookInput`, `config`, `projectRoot` (tree root), `sharedRoot`, `environment`, `homeDirectory`, `enabledModules` and `moduleOptions`
(`modules.<id>` from .ai1/config.json minus `enabled`). Decisions: `allow`, `ask`, `deny`, `block`,
`context`. A reason always says how to carry on.

Adding a module = one file (with its `feature`) + one line in the registry + its entry in the schema
(`test/config.test.mjs` fails if the schema and the registry disagree).

# Failure policy

A module that throws is reported on stderr (visible in verbose mode) and skipped; the others still
decide. Garbage input makes the entry point exit 0 with no output.

# Current modules

| Module | Event | Feature |
|---|---|---|
| `brief` | SessionStart | core (always on) |
| `okf-index` | SessionStart | okf |
| `okf-recall` | UserPromptSubmit | okf |
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
| `rfc-brief` | SessionStart | rfc |
| `rfc-recall` | UserPromptSubmit | rfc |
| `rfc-upkeep` | Stop | rfc |

Shared helpers in `src/core/`: `shell-parse.mjs` (split commands), `shell-writes.mjs` (files a shell
command writes; used by okf-upkeep and lanes-gate), `session-base.mjs` (HEAD at session start, recorded
by `brief`; used by okf, lanes and verify), `transcript-scan.mjs` (incremental transcript reader;
okf-upkeep, verify-gate), `path-glob.mjs` (globs for .ai1/config.json paths), `session-state.mjs` (per-session
state files), `project-paths.mjs` (tool paths relative to the project root; used by lanes and design),
`frontmatter.mjs` (read and write flat YAML frontmatter; okf, lanes and rfc).
The bundle reader `listBundleConcepts` (`src/okf/okf-bundle.mjs`) is shared by okf-recall and design-brief;
the keyword scoring of okf-recall (`buildKeywordCatalog`, `rankConceptsForPrompt`) by rfc-recall.

See [features](features.md), [okf feature](/features/okf.md), [lanes feature](/features/lanes.md), [craft feature](/features/craft.md), [design feature](/features/design.md), [verify feature](/features/verify.md), [rfc feature](/features/rfc.md), [worktrees feature](/features/worktrees.md), [danger guard](/guards/danger.md).

# Verified

- `npm test`: 240 Node tests plus 107 Python tests of the OKF toolkit on 2026-11-09 (94 on 2026-10-31,
  65 on 2026-10-30).
- Real Claude Code sessions with `--plugin-dir` (2026-10-30): SessionStart brief injected;
  `git reset --hard` stopped by `ask` (headless = refused, work kept); `git commit --no-verify`
  refused by `deny`. Headless `claude -p` on the dev server needs the account wrapper for auth.
