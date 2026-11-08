---
type: Component
title: worktrees feature
description: A worktree per significant change, made with a per-project recipe planned once with the person and saved as the project skill .claude/skills/worktree/; engine jig worktree, session brief and active-worktree reminder.
tags: [worktrees, git, skills, cli, hooks]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T18:37:37Z'
sources:
  - id: worktree-create
    resource: src/worktrees/worktree-create.mjs
    title: create, modes and the auto decision
  - id: worktree-ops
    resource: src/worktrees/worktree-ops.mjs
    title: list, run, drop
  - id: worktree-finish
    resource: src/worktrees/worktree-finish.mjs
    title: finish
  - id: worktree-recipe
    resource: src/worktrees/worktree-recipe.mjs
    title: recipe loader and validator
  - id: project-roots
    resource: src/core/project-roots.mjs
    title: tree root and shared root
  - id: worktree-skill
    resource: skills/worktree/SKILL.md
    title: /jig:worktree procedure
---

# Why

The person wants every significant change in its own worktree, and the agent to keep saying which
one it works in. How to make a worktree is project-specific (heavy folders, ports, env files, build
outputs, closing rules); a hand-written per-project skill (a private reference of ~1,500 lines of
Python) showed the level needed. Claude Code's native worktrees and the community tools (Worktrunk,
git-worktree-runner, Superpowers) each cover part of it; none plans a recipe with the person and
keeps it in the repo. See [prior art](/decisions/prior-art.md#worktrees-2026-11-08). Opt-in
(`features.worktrees`, default off). Agreed with the person on 2026-11-08.

# Pieces

| Piece | Where | Role |
|---|---|---|
| `/jig:worktree` | `skills/worktree/SKILL.md` | No recipe: adopt existing practice, investigate, ask, propose, write the project skill, dry run. Recipe present: defer to it. `revisar`: update it. |
| Project skill | `<repo>/.claude/skills/worktree/{SKILL.md, recipe.json, scripts/}` | Committed. Prose rules + data. Template in `templates/worktree-skill/`. |
| Engine | `jig worktree create\|list\|run\|finish\|drop` (`src/worktrees/`, `src/cli/worktree-cli.mjs`) | Deterministic operations driven by `recipe.json` (schema `schema/worktree-recipe.schema.json`). |
| `worktree-brief` | SessionStart | No recipe: points to `/jig:worktree`. Recipe: the worktree rules; inside a worktree, names it. Byte-stable. |
| `worktree-reminder` | UserPromptSubmit | Active worktrees when they change and every `reminder_every` prompts, marking this session's. |
| `danger` rules | PreToolUse | `git worktree remove --force` asks; plain remove asks when it would delete ignored files; `jig worktree finish` and `drop` ask (integration and abandoning are the person's call). |

# Modes and the auto decision

- `full`: nothing trimmed (ignored heavy paths are copied, copy-on-write when the filesystem can).
- `light`: each `heavy` entry gets its strategy: `share` (link to the main checkout's copy; ignored
  paths only, a link over a tracked path breaks git), `regenerate` (command listed for the agent),
  `exclude` (sparse-checkout for tracked paths, skipped for ignored ones), `copy`.
- extra modes: light plus their own `sparse_exclude`, optional `skip_setup`.
- `auto` (default): full when the filesystem shares blocks, or when tracked blobs + ignored heavy +
  copies leave `disk_margin_percent` of the volume free (`fs.statfsSync`); else trims the
  space-saving entries (share, exclude) largest first until it fits. Unknown free space -> light.

`create` copies gitignored files matching `copy` and `.worktreeinclude`, writes the port (stable hash
of the name in `port.range`, skipping other worktrees' ports and listening ports from `/proc/net/tcp`)
into `port.env_file` keeping other lines, never installs anything, and records state in
`<git-common-dir>/jig-worktrees/<name>.json`. Links it makes are added to `info/exclude` when a
directory pattern (`data/`) does not cover a symlink.

# finish

Clean worktree required -> base brought in (rebase, or `--merge` to keep hashes) -> recipe
`pre-finish` -> OKF checks when the branch's jig.json enables okf (code changed without touching the
bundle needs `--ack "<reason>"`; validator errors block; no python fails open) -> fast-forward the base
(in the checkout that has it, which must be clean except `dirty_base_paths_ok`; `update-ref` when not
checked out) -> share links removed, worktree, branch and record removed. Never forces, never pushes.

# Two roots

Inside a worktree Claude Code keeps `CLAUDE_PROJECT_DIR` at the launch checkout and passes the
worktree in `cwd`. Hooks now resolve a **tree root** (the worktree: files, its branch's jig.json,
verify, okf, design, guards) and a **shared root** (the main checkout: `.jig/` plans and approvals,
`jig step-done` progress). A worktree without jig.json uses the main checkout's. See
[hook runtime](/architecture/hook-runtime.md).

# Limits

- Phase 2 (planned): shared read-only caches per dependency version (`caches`), `writable`, build
  slots and locks (`slots`), and a `WorktreeCreate`/`WorktreeRemove` hook pair so `EnterWorktree`,
  `claude -w` and subagent worktrees get the recipe's light worktree on heavy repos.
- `finish` stops (does not auto-commit) when the base checkout has uncommitted docs the branch also changes.
- `share` gives no read-only protection yet; the project skill must say not to edit shared paths.

# Verified

- `npm test` (2026-11-08): 212 tests; worktrees suite covers recipe validation, every mode, the auto
  decision with injected disk space, ports, env merge, list/run/drop/finish (rebase onto a moved base,
  conflicts, dirty base, pre-finish, base not checked out, OKF ack), brief and reminder through the
  dispatcher, the CLI end to end; project-roots suite covers both roots and a lanes plan gating edits
  from a worktree.
- Dry run on a scratch Node repo with the real CLI: auto -> full, light with share/regenerate, setup
  and dev with the worktree port, finish fast-forwarding main, drop, shared data intact.
- Not yet tried in a live Claude Code session.
