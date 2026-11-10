---
type: Component
title: worktrees feature
description: A worktree per change (any edit to the repo files, created before the first edit), made with a per-project recipe planned once with the person and saved as the project skill .claude/skills/worktree/; engine ai1 worktree, session brief and active-worktree reminder.
tags: [worktrees, git, skills, cli, hooks]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-10T15:37:00Z'
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
    resource: skills/worktrees-plan-recipe/SKILL.md
    title: /ai1:worktrees-plan-recipe procedure
---

# Why

The person wants every change in its own worktree, and the agent to keep saying which one it works
in. Until 2026-11-09 the rule was "each significant change, proposed once, the person decides"; the
person changed it to **any change to the repo's files**, created by the agent before the first edit
without asking (questions and research without edits need none), after two sessions committing and
releasing on the same `main` of this repo stepped on each other. A project skill may relax it. This
repo has the feature on since that day (recipe `.claude/skills/worktree/`: base `main`, nothing heavy,
`pre-finish` runs `npm test` and the OKF validator, rebase, releases only after `finish` from the main
checkout by one session). How to make a worktree is project-specific (heavy folders, ports, env files, build
outputs, closing rules); a hand-written per-project skill (a private reference of ~1,500 lines of
Python) showed the level needed. Claude Code's native worktrees and the community tools (Worktrunk,
git-worktree-runner, Superpowers) each cover part of it; none plans a recipe with the person and
keeps it in the repo. See [prior art](/decisions/prior-art.md#worktrees-2026-11-08). Opt-in
(`features.worktrees`, default off). Agreed with the person on 2026-11-08.

# Pieces

| Piece | Where | Role |
|---|---|---|
| `/ai1:worktrees-plan-recipe` | `skills/worktrees-plan-recipe/SKILL.md` | No recipe: adopt existing practice, investigate, ask, propose, write the project skill, dry run. Recipe present: defer to it. `revisar`: update it. |
| Project skill | `<repo>/.claude/skills/worktree/{SKILL.md, recipe.json, scripts/}` | Committed. Prose rules + data. Template in `templates/worktree-skill/`. |
| Engine | `ai1 worktree create\|list\|run\|finish\|drop` (`src/worktrees/`, `src/cli/worktree-cli.mjs`) | Deterministic operations driven by `recipe.json` (schema `schema/worktree-recipe.schema.json`). |
| `worktree-brief` | SessionStart | No recipe: points to `/ai1:worktrees-plan-recipe`. Recipe: the worktree rules; inside a worktree, names it. Byte-stable. |
| `worktree-reminder` | UserPromptSubmit | Active worktrees when they change and every `reminder_every` prompts, marking this session's. |
| `worktree-recipe-offer` | Stop | No recipe and the session changed files in the main checkout (read from git since the session base, so shell edits count): asks once per session to offer `/ai1:worktrees-plan-recipe` in one line. Added 2026-11-10: in a real repo the agent read the SessionStart pointer, promised to offer the recipe before the first change, and an hour later edited `main` without offering it. |
| `danger` rules | PreToolUse | `git worktree remove --force` asks; plain remove asks when it would delete ignored files; `ai1 worktree drop --discard-uncommitted` asks; `finish` and a plain `drop` do not (since 2026-11-09: the agent commits in the branch and finishes once the work is verified, nothing is pushed, and drop keeps the commits in a bundle). |

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
`<git-common-dir>/ai1-worktrees/<name>.json`. Links it makes are added to `info/exclude` when a
directory pattern (`data/`) does not cover a symlink.

# The base

`base` in the recipe: `current` (the main checkout's branch), `trunk` or a branch name. `trunk` is the
repo's main branch whatever its name: `trunk` of `.ai1/config.json` when the repo sets it, else
detected like `ai1 init` does (`detectTrunkBranch` in `src/core/git.mjs`: origin/HEAD, else main or
master, else the current branch); no branch name is written in the code (decided by the person on
2026-11-09: integrate into the local main branch, whatever it is called). `create` refuses a base that
does not exist locally (naming origin/HEAD when it differs) and warns when a configured trunk differs
from origin/HEAD (a main branch renamed on the remote). Each worktree records its base; `finish`
integrates into that one. `current` is not the default: a main checkout left on a feature branch would
receive the work.

# finish

Clean worktree required -> base brought in (rebase, or `--merge` to keep hashes) -> recipe
`pre-finish` -> OKF checks when the branch's .ai1/config.json enables okf (code changed without touching the
bundle needs `--ack "<reason>"`; validator errors block; no python fails open) -> fast-forward the base
(in the checkout that has it, which must be clean except `dirty_base_paths_ok`; `update-ref` when not
checked out) -> share links removed, worktree, branch and record removed. Never forces, never pushes.

The fast-forward gives the files it writes into a checked-out base fresh modification times, so the
Stop hooks of any session open there would take them for unchecked changes. `finish` records them in
`<git-common-dir>/ai1-integrations.json` (`src/worktrees/worktree-integrations.mjs`, last 20): checkout,
path and modification time of each file, `verified` (pre-finish ran every `verify` command of
.ai1/config.json) and `knowledge_checked` (the OKF checks passed). [verify-gate](verify.md) and
okf-upkeep ([okf](okf.md)) skip a file only while its path and time still match a record with their
check; a later edit counts again. A fast-forward made by hand leaves no record, so the hooks ask as before.

# Two roots

Inside a worktree Claude Code keeps `CLAUDE_PROJECT_DIR` at the launch checkout and passes the
worktree in `cwd`. Hooks now resolve a **tree root** (the worktree: files, its branch's .ai1/config.json,
verify, okf, design, guards) and a **shared root** (the main checkout: `.ai1/work/` plans and approvals,
`ai1 step-done` progress). A worktree without .ai1/config.json uses the main checkout's. See
[hook runtime](/architecture/hook-runtime.md).

# Limits

- Phase 2 (planned): shared read-only caches per dependency version (`caches`), `writable`, build
  slots and locks (`slots`), and a `WorktreeCreate`/`WorktreeRemove` hook pair so `EnterWorktree`,
  `claude -w` and subagent worktrees get the recipe's light worktree on heavy repos.
- `finish` stops (does not auto-commit) when the base checkout has uncommitted docs the branch also changes.
- `share` gives no read-only protection yet; the project skill must say not to edit shared paths.
- Lifecycle points: only `pre-finish` runs project commands inside an operation. There is no
  `pre-create` (to refuse a base that lacks something the build needs), `post-create` or `pre-drop`,
  and a project script cannot record state that `list` or `finish` read (such as "last build OK at
  this commit", needed to require a build before integrating). Found on 2026-11-09 checking the
  private reference skill against the engine; everything else it does maps to the recipe, `commands`
  and project scripts.
- Windows: `share` links are junctions (`worktree-disk.mjs`); no ACLs, and the suite does not run on Windows.

# Verified

- `npm test` (2026-11-08): 212 tests; worktrees suite covers recipe validation, every mode, the auto
  decision with injected disk space, ports, env merge, list/run/drop/finish (rebase onto a moved base,
  conflicts, dirty base, pre-finish, base not checked out, OKF ack), brief and reminder through the
  dispatcher, the CLI end to end; project-roots suite covers both roots and a lanes plan gating edits
  from a worktree.
- Dry run on a scratch Node repo with the real CLI: auto -> full, light with share/regenerate, setup
  and dev with the worktree port, finish fast-forwarding main, drop, shared data intact.
- Not yet tried in a live Claude Code session.
