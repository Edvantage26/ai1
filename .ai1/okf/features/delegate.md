---
type: Feature
title: delegate feature (foreign-repo, ai1 delegate, /ai1:session-delegate-change)
description: An edit to a file of another repository with ai1 active is delegated to a claude -p session started there, so its own rules apply, unless that repository allows small hot edits or the person says to do it here, and then its guards and verify apply from this session; the delegated session knows it is delegated, stops and returns its questions, and is resumed with the person's answer.
tags: [delegate, foreign-repo, cross-repo, claude-p, submodules, hot-edits]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-28T11:38:02Z'
---

# What it does

- **Detection (module `foreign-repo`, PreToolUse on Edit/Write/MultiEdit/NotebookEdit/Bash).** For each
  path a call changes (file tools; for Bash, what the command line tells: redirections, `sed -i`,
  cp/mv/rm targets; inline scripts are not read), the owning repository is found from the `.git` entries
  on disk (`src/core/owning-repo.mjs`): `launch` (the launch repo or one of its linked worktrees),
  `submodule` (of the launch repo, nested too) or `foreign`.
  - Foreign with ai1 and `features.delegate` on **in that repo**: **deny** (kept in bypass mode), naming
    the repo and `ai1 delegate --cwd <repo> ...`, unless that repo allows hot edits or the person allowed
    it here (below). Reading is never refused.
  - Foreign without ai1: one line of context per repo and session (read its CLAUDE.md).
  - Submodule of a launch repo with ai1, or the launch repo: nothing.
- **The edited repository decides** (`decidedByTarget` in `src/core/module-index.mjs`): the dispatcher runs
  the module whatever the launch repo enables, and also where the launch directory has no ai1 at all
  (`runTargetDecidedModules` in `src/core/hook-dispatch.mjs`; every other module stays off there, as
  before). With no launch project, a submodule that has its own ai1 counts as foreign. Needs the plugin
  enabled for the person (user settings), not only in the launch repo.
- **"Do it here".** Only when the person says so: `ai1 delegate allow <repo> --because "<their words>"`
  allows edits to that repo for the rest of the session (state keyed by the session id; written through
  the stable launcher, so it lands in the plugin data folder the hook reads). Since 2026-11-28 the allow
  covers the repo's main checkout and all its worktrees, and that repo's guards apply (below); before,
  an allowed repo got none of its own rules, the least safe route of all.
- **Its guards from here** (`src/delegate/target-guards.mjs`), for an allowed or hot-edited repo: its
  `repo-rules`, its `config-guard` and, when the launch folder does not run `danger`, its `danger` with
  its `ignore_rules`, all read from its **main checkout's** config (a branch cannot loosen them). They
  apply to the files a call changes there and to the commands it runs there (the call's cwd, a `cd <dir>`,
  `git -C <dir>`): its bash rules (pnpm, migrations, `--no-verify`) matter most for commands. Their asks
  carry `keptUnattended`, so `relaxAskForPermissionMode` keeps them in bypass/auto like danger's.

# Hot edits

A repo opts in with `modules["foreign-repo"].hot_max_files: <n>` (main checkout; 0 or missing: off).
`ai1 init` writes 3 in a new config; existing configs keep their choice (decided by the person on
2026-11-28: new repos on, nothing changes in a repo without it). Then, from a session launched elsewhere:
- An edit there goes through under its guards, without delegating. The first one per repo and session
  adds one line: read its CLAUDE.md and `.ai1/okf/index.md`; its skills, plugins, MCP servers and
  session-start rules do not apply here (delegate if the change needs them); run `ai1 verify --cwd <tree>`
  before finishing. A context line, not a deny-once: a deny cannot prove the read.
- **Cap**: distinct files changed there this session (state `delegate-hot`, keyed by main checkout, no
  git in PreToolUse), not counting its `.ai1/okf/` files: the knowledge follows the change. One more than `hot_max_files` is refused with the files already changed and
  `/ai1:session-delegate-change`. A hook cannot judge task size; it can count.
- **Worktrees**: if that repo has the `worktrees` feature, its main checkout is refused with how to create
  a worktree there (`cd <repo> && ai1 worktree create <name>`, commit, `ai1 worktree finish` from there).
- **Its knowledge** (since 2026-11-28): `foreign-repo-context` (PostToolUse Read/Edit/Write/MultiEdit,
  `decidedByTarget`) names, for a file of any other repo with ai1 and a bundle, the concept of that repo
  that describes it (its own file map, `src/delegate/target-knowledge.mjs`), once per concept; on an
  edit it asks to update it. It complements `okf-file-context`, which names only that repo's bundle.
- **At stop** (module `foreign-repo-upkeep`, Stop, `decidedByTarget`, so also where the launch folder
  has no ai1, verify or okf), for files changed there from this session (hot or allowed), each asked once:
  a changed file (not of its bundle) newer than the last passing `ai1 verify --cwd <its working tree>` in
  the transcript; its bundle changed and the OKF validator reports ERRORS (`runBundleValidator`, as
  okf-upkeep does for the launch bundle); a changed file described by a concept there that was not changed. `ai1 verify --cwd <dir>` runs the verify
  commands of `<dir>`'s repo; `verify-gate` does not count it as a run of the launch repo.
- A person's `ask` for a hot edit records its files even if the person declines (minor, not handled).

# ai1 delegate (src/delegate/delegate-session.mjs, src/cli/delegate-command.mjs)

- `ai1 delegate --cwd <repo> (--brief <file> | "<task>")` runs `claude -p --output-format json
  --session-id <uuid>` in that repository, with the brief plus a fixed protocol (follow that repo's
  rules, do not push, end with `AI1-DELEGATE: done` or `AI1-DELEGATE: needs-input: <question>`). Since
  2026-11-15 it also says: check early that you can write and run what the task needs and stop at the
  first denied tool (a run without permissions read the spec and the plan before stopping, ~1 USD
  each); `.ai1/work/` is local and not committed (a brief asked to commit a file there); and the last
  message is the whole report, never "my earlier report" (`claude -p` returns only the last message,
  and a resumed run once answered with a pointer to an earlier one, losing the report). A resume
  repeats that last rule.
  `CLAUDE_PROJECT_DIR` is set to the repo so its hooks resolve there, and `AI1_DELEGATION=<session id>`
  tells that repo's ai1 it runs a delegated session (since 2026-11-28): modules marked `personOnly` in
  `src/core/module-index.mjs` (issue-offer, rule-offer, customization-check, config-sync-start,
  storyboard-reminder, routine-notice, watch-notice, reuse-check) stay silent there, nobody is watching;
  and `delegate-report` (Stop) writes `delegations/<id>.report.json`: `verify` (`passed`, `failed`,
  `not-run`, `none`, from the transcript) and `open_plans` (this session's unfinished plans).
  `ai1 delegate` deletes that file before each run and merges it into the record after (a separate file,
  so the child and the CLI never overwrite each other). Claude Code is started with
  `claude`, or the command given with `--claude-command` / `AI1_CLAUDE_COMMAND` (a resume reuses it). A
  plain `claude` launched from a tool call may not be logged in (seen 2026-11-15: "OAuth session
  expired"); the command a machine needs (a wrapper that logs in its account) goes in the person's skill
  customization, never in the plugin ([host tooling stays out](../decisions/host-tooling-out-of-plugin.md)).
- The permission mode is inherited from the calling session (recorded by `foreign-repo` from the hook
  input), `--permission-mode` overrides it. Hooks run in every mode, so the repo's guards always apply.
  The mode and the "do it here" allows are keyed by the **session id only**: the CLI runs from a Bash
  call, where `CLAUDE_PROJECT_DIR` is not set and the folder may differ from the launch root the hook saw.
  Keyed by launch root (v0.40-v0.41) the CLI never found the mode, and a delegated run started without
  permissions and stopped asking for them (seen 2026-11-15, 1.07 USD for nothing). Without any recorded
  mode a `claude -p` run uses the default mode, where tools outside the repo's allow list are denied.
  Such a run carries a `warning` in its result; `--resume ... --permission-mode <mode>` resumes it with a
  mode (before v0.42.2 the option was ignored on resume, another blocked run).
- **Status:** `done` / `needs-input` from the status line; `blocked` when `permission_denials` is not
  empty and the agent did not finish (in `claude -p` a hook `ask` counts as a denial in every mode,
  checked 2026-11-15); `failed` for a crash, `is_error`, no JSON or no status line.
- **Design sessions** (since 2026-11-28): `--design --joint <joint plan.md>` replaces the change
  protocol with a design-only one (`buildDesignProtocol`): read that repo's CLAUDE.md and bundle, write
  its part as a sub-plan in its main checkout (`size: plan`, `status: ready`, `parent`, `contract`
  hash), change no code, stop if that folder exists, report objections to the contract and impacts on
  other repos. The record gets `design_for`; `delegate-report` adds `parent` and `contract` to
  `open_plans`. See [joint plans](sizing.md#joint-plans-across-repositories-since-2026-11-28).
- **Result:** JSON on stdout and saved in ai1's state directory (`delegations/<session>.json`), so
  `--resume` and `show` work from any folder: status, question, summary, session_id, commits (any branch, since the run started),
  changed_files (commits plus uncommitted, worktrees included), new_worktrees, verify, open_plans, denied, cost.
- **Resume:** `ai1 delegate --resume <id> "<answer>"` continues the same session (`claude -p --resume`).
  `--allow-once "<command>"` grants a one-time allow that `danger` and `repo-rules` honour once in that
  session for that exact command or file; it lifts an **ask** only, never a deny.
- Skill `/ai1:session-delegate-change`: write the brief, run in the background, relay questions word
  for word, `--allow-once` and `allow` only after the person's explicit yes.

# Submodules (superprojects with one config)

`listFilesChangedSinceBase` (`src/core/session-base.mjs`) lists a changed submodule by its own changed
files, with the path from the top repo, nested submodules too (depth 3), against each submodule's HEAD
at session start (recorded with the session base from `git submodule status --recursive`, only where
`.gitmodules` exists). So verify-gate, storyboard-reminder, later-upkeep and okf-upkeep see changes
inside submodules. Fallbacks: no record, the commit the parent recorded; base commit missing locally,
the submodule path; not initialized, skipped. A repo without submodules gets the plain git lists.
Untracked files not ignored in a submodule (an un-ignored `venv/`) are listed and slow the Stop hook.

# Validate

- `node --test test/owning-repo.test.mjs test/foreign-repo.test.mjs test/delegate.test.mjs test/submodule-changes.test.mjs`
  (tags `[foreign-repo-hot-edits:S1-S5]` for target guards, hot edits, worktree and verify, delegated sessions).
- `ai1 verify --cwd <a repo with ai1>` prints `verify green (...) in <repo>` (checked 2026-11-28).
- End to end: `ai1 delegate --cwd <temp repo> "<task that commits a file>"` returns `done` with the commit
  (done 2026-11-15, about 0.4 USD).

# Not covered

- Shell edits the command line does not show (inline scripts, `cd ../x && ...` resolved later).
- Live questions while the delegated session waits: see the Agent SDK idea (not built).
- Each delegated change is a new session: one-line edits pay the same.
- In the delegated session, a guard's ask still ends `blocked` (in `claude -p` an ask is a denial) and
  the status still comes from the model's text line; `delegate-report` only adds facts beside it.
- Hot edits do not bring the target's skills, plugins, MCP servers, sizing or session-start rules: those
  need a session started there.
- Knowledge of the target in hot edits: its concept per file, validation and pending concepts are
  covered (`foreign-repo-context`, `foreign-repo-upkeep`); its overview/index structure checks and
  memories (okf-upkeep 3 and 1) are not: a delegated session gets them.
- Not used yet, available in Claude Code 2.1.319 (`claude --help`, 2026-11-28): `--bg` with
  `claude agents --json` / `attach` / `logs` / `stop` (background sessions a person can attach to),
  `--json-schema` (structured result), `--permission-prompts host` with `--permission-prompt-tool`
  (live permission relay; whether hook asks go through it is untested), `--max-budget-usd`,
  `--output-format stream-json`.

See [hook runtime](../architecture/hook-runtime.md), [session fork](session-fork.md), [verify](verify.md).
