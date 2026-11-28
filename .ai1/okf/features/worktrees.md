---
type: Component
title: worktrees feature
description: A worktree per change (any edit to the repo files, created before the first edit; knowledge of what is already done may go straight to the trunk), made with a per-project recipe planned once with the person and saved as the project skill .claude/skills/worktree/; engine ai1 worktree, session brief and active-worktree reminder.
tags: [worktrees, git, skills, cli, hooks]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-28T19:11:43Z'
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
  - id: worktree-trunk-docs
    resource: src/worktrees/worktree-trunk-docs.mjs
    title: knowledge edits on the trunk while the session has a worktree
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
keeps it in the repo. See [prior art](/decisions/prior-art.md#worktrees-2026-11-08). Agreed with the
person on 2026-11-08; on by default since v0.36.0 ([all features on](/decisions/all-features-on.md)).

# Knowledge of what is already done (since 2026-11-28)

Asked by the person: once a task was finished, updating CLAUDE.md or the bundle with what was learned,
or with something found out just talking, made a whole worktree (create, `finish` with the full suite)
for two lines about work already in `main`. The rule now: knowledge of what is already done or decided
(CLAUDE.md, README, `docs/`, the OKF bundle, later entries) goes **where what it describes lives**:
into the session's open worktree when it comes from that work; straight to the trunk in the main
checkout, committed at once on its own, when that work is already integrated or there is no task. Its
right place is the trunk: a worktree's branch may be changing that very behaviour. Code, tests and
skills (behaviour, though `.md`) always in a worktree. It costs no check: the verify gate already
ignores `*.md` and `.ai1/**`, and `dirty_base_paths_ok` already lets `finish` pass with `.ai1/okf/`
dirty in the main checkout.

The person's worry was knowledge leaking to the trunk while the worktree of its work is open, so a hook
holds it, not only the text: `worktree-trunk-docs` (PreToolUse, Edit/Write/MultiEdit) refuses the first
edit of a knowledge file (`KNOWLEDGE_PATHS`) in the main checkout while the session has a worktree, with
the reason (edit it there if it comes from that work; repeat the edit if it describes the trunk); the
same file again in the session passes. A session has a worktree when it works in it or created it:
`create` records `created_by_session` from `CLAUDE_CODE_SESSION_ID` (a session can create one and work
by absolute paths without entering it). Other sessions' worktrees do not count: if one changes that
behaviour, its rebase brings the trunk's edit in and its own bundle update supersedes it. Edits from the
shell are not covered.

# Basic recipe and project recipe (since v0.36.0)

A repo needs no recipe file. `loadRecipe` layers `DEFAULT_RECIPE`, the **basic recipe**
(`src/worktrees/worktree-basic-recipe.mjs`, worked out on every use, a few existence checks, so it
follows the repo) and the **project recipe** `.claude/skills/worktree/recipe.json`; each layer
replaces whole top-level fields, `finish` merges field by field. Status `basic` | `project` |
`invalid` (`project` was `overlay` before v0.38.0); a full recipe from before is a project recipe
that sets every field.

- Basic: `base: trunk`; `copy` = `.env`, `.env.*` at the root and one folder down; by root lockfile
  (first match per folder) `heavy` regenerate + `setup`: package-lock -> `node_modules`/`npm ci`, pnpm
  -> `pnpm install --frozen-lockfile`, yarn -> `yarn install --frozen-lockfile`, bun.lock(b) -> `bun
  install --frozen-lockfile`, uv.lock -> `.venv`/`uv sync`, poetry.lock -> `poetry install` (no heavy);
  `commands.pre-finish` = the `verify` commands (finish does not run verify by itself).
- Not covered: `create` lists ignored `.env*` files (root, first level) not copied and ignored
  top-level folders of 50 MB or more that are not `heavy` (size walk capped, 2 s budget shared,
  skipped when not reached), plus the hint to complete the project recipe (`RECIPE_GAP_HINT`); a failed
  `run setup`/`run pre-finish` and a failed pre-finish in `finish` print the same hint. The agent
  writes the project recipe itself and says so in one line; it proposes first when the fix shares a folder
  holding state or deletes data (the person's choice, 2026-11-13).
- First worktree of the repo (since 2026-11-17, asked by the person: be told how the recipe is made
  and have it improved): `create` prints `first worktree in this repo`, whether the recipe is the
  basic one or a project recipe and which fields that sets, what it copies, regenerates, sets up and
  runs before finish, and the project fields that repeat the basic recipe (`redundantFields` of
  `loadRecipe`, `finish` compared field by field), followed by `RECIPE_REVIEW_HINT`: tell the person,
  review the recipe against the repo, fix what falls short (same rule as gaps), or say it needs no
  change. Once per clone: the marker `.recipe-reported` next to the worktree records, so a repo that
  already had worktrees gets it once on its next `create`.

# Pieces

| Piece | Where | Role |
|---|---|---|
| `/ai1:worktrees-plan-recipe` | `skills/worktrees-plan-recipe/SKILL.md` | Complete the project recipe when the basic recipe falls short (by the agent, reported in one line); refine it with the person (ports, services, shared data); `revisar`: update it. |
| Project recipe | `<repo>/.claude/skills/worktree/recipe.json` (+ optional `SKILL.md`, `scripts/`) | Committed. Only the fields that differ from the basic recipe; prose rules when there are any. Template in `templates/worktree-skill/`. |
| Engine | `ai1 worktree create\|list\|run\|finish\|drop` (`src/worktrees/`, `src/cli/worktree-cli.mjs`) | Deterministic operations driven by `recipe.json` (schema `schema/worktree-recipe.schema.json`). |
| `worktree-brief` | SessionStart | The worktree rules (a worktree before the first edit, its name in every progress report, close it without asking, fix recipe gaps yourself) with the `ai1 worktree` commands and /ai1:worktrees-plan-recipe as pointers; the project skill `/worktree` named only when the repo has it; inside a worktree, names it. Byte-stable. |
| `worktree-reminder` | UserPromptSubmit | Active worktrees when they change and every `reminder_every` prompts, marking this session's. |
| `worktree-trunk-docs` | PreToolUse | Stops once a knowledge edit in the main checkout while the session has a worktree open (see above). |
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
bundle needs `--ack "<reason>"`; validator errors block; a validator crash fails open) -> fast-forward the base
(in the checkout that has it, which must be clean except `dirty_base_paths_ok`; `update-ref` when not
checked out) -> share links removed, worktree, branch and record removed. Never forces, never pushes.

The recipe is the base's, except `pre-finish`: when the branch changes its own `pre-finish` (in
`.claude/skills/worktree/recipe.json`), finish runs the branch's, since those commands check the
branch's code, and says so in its steps. Found on 2026-11-15: the branch that removed the Python OKF
validator could not finish, because the base's `pre-finish` still called the script it deleted. The
recipe is not behind config-guard (agents edit it through /ai1:worktrees-plan-recipe), so this opens
no new way around a check; the step line shows a weakened `pre-finish` to the person.

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
`ai1 step-done` progress). A session isolated in the worktree (EnterWorktree) keeps its plans in the
worktree's `.ai1/work/` until `finish` or `drop` moves them to the main checkout
([sizing](sizing.md)). A worktree without .ai1/config.json uses the main checkout's. See
[hook runtime](/architecture/hook-runtime.md).

A session isolated with EnterWorktree also meets a check of Claude Code itself (not of ai1): it
refuses shell commands it cannot prove keep git operations inside the worktree, which catches
commands that only name git as text (a heredoc writing `.git/config`, a `sed` program with `|`
editing `bin/ai1`). Seen seven times in one session on 2026-11-20. The worktree rules in the brief
and the project skill `/worktree` say the way round it: Edit/Write for files, a script in a file
outside the repo run with a plain command. Known upstream (anthropics/claude-code#105399 and several
duplicates, triaged as bugs with no maintainer answer as of 2026-11-20); not commented on, since it
added nothing new. Part of it is by design: a `sed` option computed with `$(...)` cannot be checked
without running it. Working with absolute paths without EnterWorktree avoids the check altogether.

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
  dispatcher, the CLI end to end; project-roots suite covers both roots and a deep plan gating edits
  from a worktree.
- Dry run on a scratch Node repo with the real CLI: auto -> full, light with share/regenerate, setup
  and dev with the worktree port, finish fast-forwarding main, drop, shared data intact.
- Not yet tried in a live Claude Code session.
