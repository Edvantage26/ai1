---
name: worktree
description: One worktree per change in <project>. Use ALWAYS before changing files of this repo when the session is not in a worktree yet, and to create, run, integrate or drop a worktree here.
---

# Worktrees in <project>

**Idea:** one conversation = one development = one worktree. The whole development happens in its
worktree (edit, run, commit) without touching the main checkout; when done it is integrated into
its base. The engine is `ai1 worktree`; the data is `recipe.json` next to this file.

## When

Any change to the files of this repo: if the session is not in a worktree, create one before the
first edit and tell the person its name in one line ("Trabajo en el worktree `feat-xxx`."). Questions
and research without edits need none. <Relax it here if this project wants worktrees only for some
changes, e.g. "one-line fixes to docs go straight to main".>

## Flow

1. **Create**: `ai1 worktree create <name>`; mode `auto` decides by disk on this
   machine (<what full and light mean here>). Tell the person the path, size, mode and port.
2. **Enter**: EnterWorktree with the printed path. Then run what it lists under "next":
   `ai1 worktree run <name> setup`.
3. **Work inside**: edits and commits only in the worktree. Project steps:
   <`ai1 worktree run <name> dev` (port {{port}}), `ai1 worktree run <name> build`, ...>.
4. **Progress**: start every progress report with one line naming the worktree; if the task has a
   deep-lane plan, write the worktree name in it.
5. **Close** when the person approves: `ai1 worktree finish <name>` (<rebase|merge>; runs
   `pre-finish`: <checks>; then fast-forwards <base>), or `ai1 worktree drop <name> --confirm`.
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
