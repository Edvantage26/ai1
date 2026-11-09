---
name: worktrees-plan-recipe
description: Worktrees — Plan, follow or revise how this repository makes git worktrees, one per change. Use when the person wants changes done in worktrees ("trabaja en un worktree", "un worktree por desarrollo", "work in a worktree"), when a session says the worktrees feature has no recipe yet, before the first change to files in a repo with the worktrees feature, or to revise the recipe ("revisa la receta de worktrees", "/ai1:worktrees-plan-recipe revisar").
allowed-tools: Bash(ai1 skill-context *)
---

# Worktrees made the way this project needs

Every change to the repo's files gets its own worktree (the project skill may relax this). **How** to make one is project-specific (heavy
folders, ports, env files, build outputs, closing rules), so it is planned once with the person
and saved as the **project skill** `.claude/skills/worktree/` (committed):

- `SKILL.md`: the project's rules in prose (which changes need a worktree, modes, traps, commands).
- `recipe.json`: the data the engine reads (schema: `schema/worktree-recipe.schema.json` of ai1).
- `scripts/`: only when a project step needs more than a one-line command.

The engine is `ai1 worktree create|list|run|finish|drop` (on the Bash PATH while ai1 is enabled).

## 0. Which path

Run `ai1 status`. The line `worktree recipe:` decides:

- `ok` and the person did not ask to revise it: **follow** the project skill (`/worktree`, or read
  `.claude/skills/worktree/SKILL.md`). Its rules win over this file. Stop here.
- `missing`: **plan** a recipe (steps 1-6).
- `invalid`, or the person asked to revise: **revise** (step 7).

## 1. Adopt what already exists

Look for an existing practice before designing one, and reuse its decisions: `.worktreeinclude`
(its patterns become `copy`), `.config/wt.toml` (Worktrunk), `.gtrconfig` (git-worktree-runner),
`WorktreeCreate` hooks in `.claude/settings*.json`, `.worktrees/` or `worktrees/` folders, scripts
or docs mentioning worktrees, and the knowledge bundle if there is one.

## 2. Investigate before asking

Answer these from the repo itself; note the evidence for each:

- **Stack and build**: languages, package managers, build system, how the app starts.
- **Where builds write**: inside the tree or outside (absolute output paths, env vars, shared
  folders). Two worktrees writing the same output path collide: give each one its own with `env`
  (e.g. `"OUT_DIR": "{{repo_parent}}/out/{{name}}"`).
- **Heavy paths**: measure the biggest folders, tracked and ignored (`du -sh`, `git ls-files`,
  `git ls-files --others --ignored --exclude-standard --directory`). For each, decide a strategy:
  `copy` (default for anything not heavy), `share` (ignored, read-only use: datasets, models,
  caches; never for tracked paths), `regenerate` (dependencies that may change in the branch, with
  their install command), `exclude` (not needed by most tasks; tracked paths use sparse-checkout).
- **Env and secrets**: gitignored files the app needs to run (`.env*`, local configs) -> `copy`.
- **Ports and services**: ports in `.env*`, configs, compose files; databases, queues. Default:
  each worktree gets its own app port (`port`), shared services stay shared; a task that changes
  schema, migrations or dependencies uses `full` mode and its own services.
- **Checks**: the tests or linters to run before integrating -> `commands.pre-finish`.
- **Closing**: rebase or merge (merge keeps hashes when commits are already deployed or cited);
  paths another session may leave uncommitted in the base (e.g. `.ai1/okf/`) -> `finish.dirty_base_paths_ok`.
- **Subagents**: if a full checkout is large, the project skill says subagents work inside the
  conversation's worktree instead of their own (`isolation: worktree` makes a full checkout).
- **OS**: Windows needs junctions for shared folders (the engine does it) and backslash paths.

## 3. Ask only what the repo cannot answer

One question per message, the most important first, with your recommendation. Typical: which heavy
folders a usual task really needs, whether services may be shared, how they like to close.
Practical first: trim only what would really fill the disk; `auto` mode decides on each machine.

## 4. Propose

Show the person, in one message: the recipe as JSON (start from ai1's
`templates/worktree-skill/recipe.json`, drop what does not apply) and a summary of the project
`SKILL.md` (from `templates/worktree-skill/SKILL.md`): which changes need a worktree, the modes and
what each trims, the commands, the traps you found. Iterate until they approve.

## 5. Write and switch on

- Write `.claude/skills/worktree/recipe.json` and `.claude/skills/worktree/SKILL.md` (and
  `scripts/` if needed). Keep the project `SKILL.md` under ~120 lines and specific: no generic advice.
- Make sure the worktrees folder (`location`, default `.claude/worktrees/`) is in `.gitignore`.
- Enable the feature: `ai1 status --json` gives the features on now; run
  `ai1 init --features <those ids>,worktrees` (it keeps verify, trunk and knowledge).
- `ai1 status` must say `worktree recipe: ok`.

## 6. Dry run, then report

`ai1 worktree create probe --mode auto`, `ai1 worktree list --size`, run the setup it lists if it is
quick, then `ai1 worktree drop probe --confirm`. Report the size, the mode chosen and why, and the
time it took. Tell the person to commit `.claude/skills/worktree/` and `.ai1/config.json`.

## 7. Revise

Read the current recipe and project skill, ask what changed (or detect it: new heavy folder, new
service, a failure they hit), propose the diff, and after approval update the same files. Run the
dry run again. Never start from scratch when a recipe exists.

## Rules for every path

- Integrating (`ai1 worktree finish`) and abandoning (`ai1 worktree drop`) are the person's call;
  the danger guard asks them. Never push unless they ask for it.
- `ai1 worktree create` never installs anything: run what it prints under "next".
- Inside a worktree, mention it at the start of every progress report.

## Fixed rules

- Integrating (`ai1 worktree finish`) and abandoning (`ai1 worktree drop`) are the person's call; never push unless they ask.
- Never edit a path a worktree shares with the main checkout (`share` strategy).
- Never start a recipe from scratch when one exists: revise it, and only after the person approves the diff.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `ai1 skill-context worktrees-plan-recipe` and apply what it prints.

!`ai1 skill-context worktrees-plan-recipe`
