---
type: Architecture
title: Hook runtime (dispatcher and modules)
description: One entry point per hook event that loads .ai1/config.json and runs the enabled modules.
tags: [hooks, runtime, modules]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-16T12:49:00Z'
---

# Flow

`hooks/hooks.json` wires every event to the same command:
`node "${CLAUDE_PLUGIN_ROOT}/bin/ai1-hook.mjs" <Event>`.

1. `bin/ai1-hook.mjs` reads the hook input JSON from stdin and imports only the modules of this
   event and tool (`loadModulesForEvent` in `src/core/module-index.mjs`). Always exits 0. At
   SessionStart, in every repo (active or not), it first installs the stable `ai1` launcher
   (`src/core/stable-launcher.mjs`, see [plugin layout](plugin-layout.md#the-stable-ai1-launcher)), then
   runs the pending [migrations](migrations.md), and their report reaches the agent with the other
   session-start context.
2. `src/core/hook-dispatch.mjs` (`dispatchHookEvent`) resolves two roots with `src/core/project-roots.mjs` (from the `.git`
   entries on disk, no git process): the **tree root** (`CLAUDE_PROJECT_DIR`, else input `cwd`; it
   follows `cwd` when that is a linked worktree of the same repository, because Claude Code keeps
   `CLAUDE_PROJECT_DIR` at the launch checkout after EnterWorktree) and the **shared root** (the main
   checkout, for state every worktree shares: `.ai1/work/` plans and approvals). It loads
   `.ai1/config.json` from the tree root with `src/core/config.mjs`, or from the shared root when
   the worktree has none.
   - Missing: ai1 is inactive; only a one-line note at SessionStart.
   - Invalid: inactive; SessionStart tells the agent why.
   - Missing, but a call edits a repository with ai1: only the modules that repository decides
     (`decidedByTarget`, today `foreign-repo`) run, with no config; nothing else (see
     [delegate](../features/delegate.md)).
   - **Other repositories.** A `cwd` in another repository keeps the launch root: only the launch
     `.ai1/config.json` is read. Edits of another repository with ai1 are refused and delegated to a
     session started there ([delegate](../features/delegate.md)). Submodules are part of the launch
     project: command and path modules cover them, and `listFilesChangedSinceBase` lists the files
     changed inside them (against each submodule's HEAD at session start), so verify-gate sees them;
     the protected branch and worktrees stay those of the superproject. There is no config
     inheritance (no `extends`): rules shared by several repos are copied into each.
3. It decides with the metadata of every module (`MODULE_INDEX`): the enabled ones (feature, per-repo
   module switches) are `enabledModules`; of those, plus the `decidedByTarget` ones (they check the
   edited repository's own config), the ones for the event and tool that were loaded run. `src/core/dispatcher.mjs` (`runHookEvent`) does the same with every module loaded
   (`src/core/registry.mjs`), for tests and in-process callers.
4. `src/core/hook-io.mjs` combines decisions (deny/block > ask > context > allow) and prints the
   JSON each event expects (PreToolUse `permissionDecision`, Stop `decision: block`,
   SessionStart, UserPromptSubmit, PreToolUse and PostToolUse `additionalContext`). A `notice` never competes:
   it is added as `systemMessage` (shown to the person, not the agent) to whatever was decided.
   The context texts, and the notices, of one event share a budget of 9,500 characters
   (`MAX_FIELD_CHARACTERS`, under Claude Code's 10,000 per field, see Platform limits). A module can
   return its context as parts with `contextList` lists (`src/core/context-list.mjs`: the index lines,
   concepts to check, related repositories, unfinished plans, open later entries); over the budget,
   `dropListItemsToBudget` first leaves out list items, one at a time from the longest list, and each
   list says how many it left out and where the full list is, so no rule text is cut while a list
   has items. Only then `fitTextsToBudget` cuts the longest texts first, all to the same length and at a line end, with a
   marker naming the module, so short texts (often this session's state) stay whole. A cut module
   gets a `trimmed` entry in the [decision log](decision-log.md) with the characters left out; it is not
   an internal error. Since the cut takes the end, a module puts what depends on the repo or session
   first and its fixed rules or reference lists last (`brief`, `design-brief`). Since 2026-11-15.
   In the `bypassPermissions`, `auto` and `dontAsk` permission modes (`permission_mode` of the hook
   input), an `ask` from any module other than `danger` and `repo-rules` becomes `allow`
   (`relaxAskForPermissionMode`, logged as `relaxedAsk`): the person chose not to be asked, so only
   losing work or data for good and the repo's own rules still reach them. Since 2026-11-09.

# Module contract

`{ id, event, feature, description, toolNames?, run(moduleContext) -> decision }`, where
`moduleContext` has `hookInput`, `config`, `projectRoot` (tree root), `sharedRoot`, `environment`, `homeDirectory`, `enabledModules` and `moduleOptions`
(`modules.<id>` from .ai1/config.json minus `enabled`). Decisions: `allow`, `ask`, `deny`, `block`,
`context`, `notice`. A reason always says how to carry on.

Adding a module = one file (with its `feature`) + one line in `src/core/module-index.mjs` (id, event,
feature, toolNames, path) + its entry in the schema. `test/dispatcher.test.mjs` fails if the index and
the module file disagree, `test/config.test.mjs` if the schema and the index do.

# Failure policy

A module that throws is reported on stderr (visible in verbose mode) and skipped; the others still
decide. Garbage input makes the entry point exit 0 with no output.

Every module run is timed and logged locally, metadata only: see [decision log](decision-log.md)
(`ai1 log`, off with `AI1_DECISION_LOG=0`). A thrown module and a crash of the entry point are
logged with an error signature and offered to the person as an issue ([issue report](../features/issue-report.md)).

# Current modules

| Module | Event | Feature |
|---|---|---|
| `brief` | SessionStart | core (always on) |
| `issue-offer` | UserPromptSubmit | core (always on): offers a report when ai1 itself failed, see [issue report](../features/issue-report.md) |
| `okf-index` | SessionStart | okf |
| `okf-claude-md` | SessionStart | okf |
| `okf-catch-up-start`, `okf-catch-up-prompt` | SessionStart, UserPromptSubmit | okf: merges of branches without a bundle, see [okf](../features/okf.md) |
| `okf-recall` | UserPromptSubmit | okf |
| `okf-file-context` | PostToolUse (Read, Edit, Write, MultiEdit) | okf |
| `danger` | PreToolUse (Bash) | danger |
| `config-guard`, `repo-rules` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | danger |
| `okf-upkeep` | Stop | okf |
| `craft-brief` | SessionStart | craft |
| `verify-gate` | Stop | verify |
| `test-guard` | PreToolUse (Edit, Write, MultiEdit, Bash) | verify |
| `fix-loop` | PostToolUse (Edit, Write, MultiEdit) | verify |
| `tool-loop` | PreToolUse (Bash, Edit, Write, MultiEdit, NotebookEdit) | verify |
| `sizing-brief` | SessionStart | sizing |
| `sizing-approval` | UserPromptSubmit | sizing |
| `sizing-gate`, `sizing-escalate` | PreToolUse (Edit, Write, MultiEdit, NotebookEdit, Bash) | sizing |
| `design-brief` | SessionStart | design |
| `design-detect` | PostToolUse (Edit, Write, MultiEdit) | design |
| `worktree-brief` | SessionStart | worktrees |
| `worktree-reminder` | UserPromptSubmit | worktrees |
| `later-brief` | SessionStart | later |
| `later-recall` | UserPromptSubmit | later |
| `later-upkeep` | Stop | later |

Shared helpers in `src/core/`: `shell-parse.mjs` (split commands), `shell-writes.mjs` (files a shell
command writes, with relative targets moved by an earlier `cd <dir>` in the line since 2026-11-09 - before, `cd /repo && sed -i ... .ai1/work/x/plan.md` from a worktree was refused as a worktree plan; used by okf-upkeep and sizing-gate), `session-base.mjs` (HEAD at session start, recorded
by `brief`, okf-index and sizing-brief, never throws; used by okf, sizing and verify), `transcript-scan.mjs`
(incremental transcript reader that skips Claude Code's `api-request-blob` request copies; okf-upkeep,
verify-gate), `session-writes.mjs` (whether a tool call may change files: edits, subagents and shell
commands not known to be read-only, and the session's write windows built from them; okf-upkeep and
verify-gate only count files modified inside a window), `path-glob.mjs` (globs for .ai1/config.json
paths), `session-state.mjs` (per-session state files, `readStateJson`, and `claimStopBlock`: the Stop
loop guard - the same findings block once, at most N blocks per session - of okf-upkeep and
later-upkeep), `project-paths.mjs` (tool paths relative to the project root; used by sizing and design),
`frontmatter.mjs` (the one frontmatter splitter, line by line, also used by the OKF validator; flat field reads and writes for okf, sizing and later), `git.mjs` (`runGit`,
`tryGit`, `listIgnoredPaths`, `readOriginHeadBranch`, `detectTrunkBranch`; every module and the CLI), `json-file.mjs` (`readJsonFile` throws on
invalid JSON for files about to be rewritten, `readJsonFileIfValid`, `writeJsonFile`),
`markdown-files.mjs` (recursive markdown listing), `tool-call-paths.mjs` (the files a tool call may
change, sorted as edit / shell-write / remove / move / move-target; config-guard and test-guard),
`repo-rules-config.mjs` (validation of `rules`), `decision-log.mjs` (plus `errorSignature`), `pending-errors.mjs` (ai1's own errors waiting to be offered), `legacy-layout.mjs` (detection of the old `jig`
layout, so core never imports `src/cli/`). Paths under `.ai1/` (`KNOWLEDGE_BUNDLE_PATH`,
`WORK_DIRECTORY`) are constants in `config.mjs`.
okf-upkeep is split: `okf-session-scan.mjs` (transcript, memories, shell edits of the bundle) and
`okf-validator.mjs` (runs the Node validator in-process, also used by `ai1 worktree finish`).
The bundle reader `listBundleConcepts` (`src/okf/okf-bundle.mjs`) is shared by okf-recall, design-brief
and the file map; the file map (`src/okf/okf-file-map.mjs`, which concepts describe a file) by
okf-file-context, okf-upkeep and the CLAUDE.md check (`okf-claude-md-check.mjs`, used by
okf-claude-md and `ai1 claude-md`, which also reuses `normalizeKeywords` and `readBodyCodePaths`);
the keyword scoring of okf-recall (`buildKeywordCatalog`, `rankConceptsForPrompt`) by later-recall.

See [features](features.md), [okf feature](/features/okf.md), [sizing feature](/features/sizing.md), [craft feature](/features/craft.md), [design feature](/features/design.md), [verify feature](/features/verify.md), [later feature](/features/later.md), [worktrees feature](/features/worktrees.md), [danger guard](/guards/danger.md).

# Cost

Measured 2026-11-09 on a Bash call in this repo (average of 10): about 162 ms per hook when every
module was imported on every event, about 122 ms since v0.17.0 with only the event's modules (Node
alone takes about 74 ms; a module of a feature the repo turned off is still imported for its event,
the config is read after loading). Context at SessionStart (since 2026-11-15): the `brief` names the
features in one line of ids; the briefs hold the rules and name the skill or `ai1` command that has
each procedure; `okf-index` shows the index up to 3,000 characters (12,000 until 2026-11-15) and the
lists show at most 3 items with titles cut to 60 characters. `test/session-start-budget.test.mjs`
holds it: this repo and a default repo under 8,500 characters, a generated worst case (every feature,
5 plans, 10 later entries, 12 unindexed concepts, a long index, 3 related) within the 9,500 budget with
every rule text whole. This repo went from 12,217 to about 7,800 characters; the worst case lands right at the budget, with its lists absorbing the excess. 0 to about 1 KB per message
(`okf-recall`, `later-recall`, when they match).

Measured 2026-11-15 with `ai1 log` (17,005 runs, 29 sessions): guards per tool call 3-7 ms average;
the slow one is `okf-upkeep` (332 ms average, 2.2 s max, it runs the validator); the SessionStart
output of this repo was 11.7 KB, over the platform cap below, so the agent got only a 2 KB preview.
`fix-loop`, `tool-loop` and `later-upkeep` had never intervened (all `allow`).

# Platform limits (Claude Code hooks)

From the hooks reference (code.claude.com/docs/en/hooks), checked 2026-11-15:

- `additionalContext`, `systemMessage` and plain stdout are capped at **10,000 characters per field
  and per hook command**. Over it, the text goes to a file and the agent sees the path plus a
  2,000-character preview, without being asked to read it. No setting raises it. The combined
  output of one event must stay under it, which the 9,500-character budget of `hook-io.mjs` does
  since 2026-11-15. With every feature on, the session start of this repo was 12.2 KB and that of
  a default frontend repo also went over: the budget is a safety net, the briefs themselves have to shrink.
- Stop: `decision: "block"` shows as a hook error; `hookSpecificOutput.additionalContext` continues the
  same way but shows as "Stop hook feedback". Both are bounded by `stop_hook_active` and a cap of
  8 consecutive continuations.
- Write context as facts, not imperative "system" instructions (prompt-injection defences); static
  conventions belong in CLAUDE.md, rules or skills, `additionalContext` is for dynamic state.
- Available and unused here: the `if` field (permission-rule syntax, tool events only, skips spawning
  the process), `PostToolBatch` (once per batch of tool calls), `FileChanged` (any source of a file
  change), `PostCompact`, `async` / `asyncRewake`, `InstructionsLoaded`. Newer than some installed
  Claude Code versions: check the minimum version before depending on them.

Measured 2026-11-15 while shrinking the briefs: in a worst-case repo (every feature on, 5 unfinished
plans, 10 open later entries, 12 concepts missing from the index, a long index, 3 related repos) the
fixed rule texts of the session-start modules come to about 8,000 characters and the dynamic lists
to about 7,000 more, so lists, not rules, are what grows with a repo.

Checked 2026-11-15 and not done: the `if` field of hooks.json would spare no process, because on every
Bash, Edit, Write and Read some module needs every call (`tool-loop` counts repeats, `sizing-escalate`
the size of the change, `okf-file-context` each file); merging `fix-loop` and `tool-loop` would save
nothing measurable (they already share `core/transcript-scan`, run on different events, 5 and 25 ms).
`okf-upkeep`'s 306 ms average mixed in runs from before the validator moved in-process: since
2026-11-15 its median is 60 ms (the validator itself 30-60 ms on this bundle).

To measure one repo's session start without touching the person's log: pipe
`{"hook_event_name":"SessionStart","source":"startup","session_id":"m","cwd":"<repo>"}` into
`CLAUDE_PLUGIN_DATA=$(mktemp -d) node bin/ai1-hook.mjs SessionStart`; the decision log in that
temporary `state/` directory has the characters of each module. `test/session-start-budget.test.mjs`
does the same on generated repos and prints the per-module sizes when it fails.

How to check: `ai1 log` for time and characters per module; the size of a SessionStart output shows
in the session as `<persisted-output>` when it went over the cap.

# Verified

- `npm test`: 240 Node tests plus 107 Python tests of the OKF toolkit on 2026-11-09 (94 on 2026-10-31,
  65 on 2026-10-30); Node only since 2026-11-15 (572+ tests).
- Real Claude Code sessions with `--plugin-dir` (2026-10-30): SessionStart brief injected;
  `git reset --hard` stopped by `ask` (headless = refused, work kept); `git commit --no-verify`
  refused by `deny`. Headless `claude -p` on the dev server needs the account wrapper for auth.
