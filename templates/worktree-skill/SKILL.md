---
name: worktree
description: One worktree per development in <project>. Use before starting a significant change (several files, a build, more than a couple of edits, or the main checkout busy with another session) to PROPOSE a worktree, and ALWAYS to create, run, integrate or drop a worktree in this repo.
---

# Worktrees in <project>

**Idea:** one conversation = one development = one worktree. The whole development happens in its
worktree (edit, run, commit) without touching the main checkout; when done it is integrated into
its base. The engine is `jig worktree`; the data is `recipe.json` next to this file.

## When to propose it

At the start of a significant change: <the project's criteria, e.g. touches the API and the web,
needs a build, migrations>. Propose it **once**, in one line, with a suggested name and why; the
person decides. Not for questions, research without changes or a one-line fix.

> "This touches several files and needs a build: shall we do it in its own worktree (`feat-xxx`,
> ~<size>, without touching your checkout)?"

## Flow

1. **Create** (after the yes): `jig worktree create <name>`; mode `auto` decides by disk on this
   machine (<what full and light mean here>). Tell the person the path, size, mode and port.
2. **Enter**: EnterWorktree with the printed path. Then run what it lists under "next":
   `jig worktree run <name> setup`.
3. **Work inside**: edits and commits only in the worktree. Project steps:
   <`jig worktree run <name> dev` (port {{port}}), `jig worktree run <name> build`, ...>.
4. **Progress**: start every progress report with one line naming the worktree; if the task has a
   deep-lane plan, write the worktree name in it.
5. **Close** when the person approves: `jig worktree finish <name>` (<rebase|merge>; runs
   `pre-finish`: <checks>; then fast-forwards <base>), or `jig worktree drop <name> --confirm`.
   After finishing from inside the worktree, leave it with ExitWorktree (keep).

## Modes

| Mode | What it has | Use it for |
|---|---|---|
| full | everything | <e.g. schema changes, migrations, dependency upgrades> |
| light | <what is shared, regenerated or excluded> | <most tasks> |
| <extra> | <...> | <...> |

## Rules and traps

- <Project-specific traps found while planning: shared outputs, absolute paths, services that must
  not be shared, files never to edit from a worktree, subagents working inside this worktree...>
- Never `git worktree remove --force` by hand: `finish` / `drop` remove shared links first.
