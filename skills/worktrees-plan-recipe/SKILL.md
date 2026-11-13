---
name: worktrees-plan-recipe
description: Worktrees — Complete, refine or revise how this repository makes git worktrees, one per change: the overlay on top of the basic recipe ai1 works out from the repo. Use when `ai1 worktree` reports something the recipe does not cover, when a worktree needed a step by hand, when the person wants worktrees made a particular way here ("cada worktree con su puerto", "comparte la carpeta de datos", "work in a worktree"), or to revise the recipe ("revisa la receta de worktrees", "/ai1:worktrees-plan-recipe revisar").
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Worktrees made the way this project needs

Every change to the repo's files gets its own worktree (a project skill may relax this). It works
from the first change with no setup: ai1 works out a **basic recipe** from the repo each time it is
used - base the trunk, ignored `.env` files at the root and one folder down copied, the install of
the lockfile (`npm ci`, `pnpm`, `yarn`, `bun`, `uv sync`, `poetry install`) as setup with its
dependency folder regenerated, the repo's `verify` commands as `pre-finish`.

What this repo does differently goes in the **overlay** `.claude/skills/worktree/recipe.json`
(committed): only the fields that differ; each one replaces the basic field whole (`finish` merges
field by field). The full format is ai1's `schema/worktree-recipe.schema.json`, with an example of
every field in `templates/worktree-skill/recipe.json`. Next to it, optionally:

- `SKILL.md`: the project's rules in prose (which changes need a worktree, modes, traps, commands),
  from `templates/worktree-skill/SKILL.md`, only when there is something specific to say.
- `scripts/`: only when a project step needs more than a one-line command.

The engine is `ai1 worktree create|list|run|finish|drop` (on the Bash PATH while ai1 is enabled).

## 0. Which path

Run `ai1 status`. The line `worktree recipe:` says `basic` (no overlay), `overlay` or `invalid`.

- `ai1 worktree` reported something not covered, or a worktree needed a step by hand: **complete**
  the overlay (step 1).
- The person wants worktrees made a particular way (ports, services, shared data, modes, closing):
  **refine** (steps 2-5).
- `invalid`, or the person asked to revise: **revise** (step 6).
- Otherwise there is nothing to do: follow the project skill (`/worktree`) when there is one.

## 1. Complete the overlay

The agent does this by itself and says it in one line ("Receta de worktrees: añado `models/` como
share."). Add to the overlay only the fields the gap needs, keeping what it already has; a field the
basic recipe also sets must keep the basic entries that still apply (e.g. `heavy` with the
`node_modules` entry plus the new one). Typical fixes:

- an ignored env or config file not copied -> `copy` (patterns; a pattern without `/` matches at any depth);
- a big ignored folder neither copied nor regenerated -> `heavy` with `regenerate` (and its command),
  `share` (read-only data: datasets, models, caches) or `exclude`;
- an install or build step done by hand -> `setup`;
- a failing `pre-finish` because the checks differ here -> `commands.pre-finish`.

**Propose first** (one line, wait for the yes) when the fix would share a folder that holds state
(a database, uploads, anything the app writes) or delete data. Then `ai1 status` must say
`worktree recipe: overlay`; tell the person to commit `.claude/skills/worktree/`.

## 2. Adopt what already exists

Look for an existing practice before designing one, and reuse its decisions: `.worktreeinclude`
(its patterns are copied too), `.config/wt.toml` (Worktrunk), `.gtrconfig` (git-worktree-runner),
`WorktreeCreate` hooks in `.claude/settings*.json`, `.worktrees/` or `worktrees/` folders, scripts
or docs mentioning worktrees, and the knowledge bundle if there is one.

## 3. Investigate before asking

Answer these from the repo itself; note the evidence for each:

- **Where builds write**: inside the tree or outside (absolute output paths, env vars, shared
  folders). Two worktrees writing the same output path collide: give each one its own with `env`
  (e.g. `"OUT_DIR": "{{repo_parent}}/out/{{name}}"`).
- **Heavy paths**: measure the biggest folders, tracked and ignored (`du -sh`, `git ls-files`,
  `git ls-files --others --ignored --exclude-standard --directory`). For each, decide a strategy:
  `copy` (default for anything not heavy), `share` (ignored, read-only use; never for tracked
  paths), `regenerate` (dependencies that may change in the branch, with their install command),
  `exclude` (not needed by most tasks; tracked paths use sparse-checkout).
- **Ports and services**: ports in `.env*`, configs, compose files; databases, queues. Default:
  each worktree gets its own app port (`port`), shared services stay shared; a task that changes
  schema, migrations or dependencies uses `full` mode and its own services.
- **Closing**: rebase or merge (merge keeps hashes when commits are already deployed or cited);
  paths another session may leave uncommitted in the base (e.g. `.ai1/okf/`) -> `finish.dirty_base_paths_ok`.
- **Subagents**: if a full checkout is large, the project skill says subagents work inside the
  conversation's worktree instead of their own (`isolation: worktree` makes a full checkout).
- **OS**: Windows needs junctions for shared folders (the engine does it) and backslash paths.

## 4. Ask only what the repo cannot answer, then propose

One question per message, the most important first, with your recommendation. Typical: which heavy
folders a usual task really needs, whether services may be shared, how they like to close. Then show
the overlay as JSON (only the fields that differ from the basic recipe) and, when there are
project rules worth writing, a summary of the project `SKILL.md`. Iterate until they approve.

## 5. Write, dry run, report

- Write `.claude/skills/worktree/recipe.json` (and `SKILL.md`, `scripts/` if needed). Keep the
  project `SKILL.md` under ~120 lines and specific: no generic advice.
- Make sure the worktrees folder (`location`, default `.claude/worktrees/`) is in `.gitignore`.
- `ai1 worktree create probe --mode auto`, `ai1 worktree list --size`, run the setup it lists if it
  is quick, then `ai1 worktree drop probe --confirm`. Report the size, the mode chosen and why, what
  it reported as not covered, and the time it took. Tell the person to commit `.claude/skills/worktree/`.

## 6. Revise

Read the current overlay and project skill, ask what changed (or detect it: new heavy folder, new
service, a failure they hit), propose the diff, and after approval update the same files. Run the
dry run again. Fields that now match the basic recipe can leave the overlay.

## Rules for every path

- `ai1 worktree create` never installs anything: run what it prints under "next".
- Inside a worktree, mention it at the start of every progress report.

## Fixed rules

- Never push unless the person asks.
- Never edit a path a worktree shares with the main checkout (`share` strategy).
- The overlay holds only what differs from the basic recipe; a fix that shares a folder holding state or deletes data is proposed first and written only after the person's yes.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context worktrees-plan-recipe` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context worktrees-plan-recipe`
