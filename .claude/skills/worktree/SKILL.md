---
name: worktree
description: One worktree per change in ai1. Use ALWAYS before changing any file of this repo (code, skills, tests, docs, the OKF bundle) when the session is not in a worktree yet, and to create, run, integrate or drop a worktree here.
---

# Worktrees in ai1

**Idea:** every change to this repo happens in its own worktree, never in the main checkout:
several sessions often work on ai1 at once, and two of them committing and releasing on the same
`main` step on each other. The engine is `ai1 worktree`; the data is `recipe.json` next to this file.

## When

- **Any change to files** (code, skills, tests, README, `.ai1/okf/`, `.ai1/later/`): in a worktree. If
  the session is not in one, create it before the first edit and tell the person its name in one
  line ("Trabajo en el worktree `fix-brief-text`."). No need to ask first.
- Questions, reviews and research without edits: fine in the main checkout.

## Flow

1. **Create**: `ai1 worktree create <short-name>` (from `main`; mode auto, always full here: the repo
   is ~2 MB, nothing to install, no ports).
2. **Enter**: EnterWorktree with the printed path. No setup step.
3. **Work inside**: edits and commits only in the worktree. Checks:
   `ai1 worktree run <name> test` (`npm test`), `ai1 worktree run <name> okf` (OKF validator
   --strict), `ai1 worktree run <name> validate` (`claude plugin validate .`).
4. **Progress**: start every progress report with one line naming the worktree; a deep plan
   records the worktree name too. A session entered with EnterWorktree cannot write the main
   checkout, so it writes its plan in the worktree's `.ai1/work/`; ai1 reads it there and finish or
   drop moves it to the main checkout's `.ai1/work/`.
5. **Close** once the work is done and verified, without asking: commit in the branch and run `ai1 worktree finish <name>` (rebase onto `main`, runs
   `npm test` and the OKF validator, then fast-forwards `main`), or `ai1 worktree drop <name> --confirm`.
   After finishing from inside, leave with ExitWorktree.

## Releases

Version bump, tag, push and `claude plugin update` happen **after** `finish`, from the main
checkout, and by one session only (check `git log origin/main` and `git tag` first: another session
may have released already). Never tag or push from a worktree.

## Rules and traps

- The hooks a session runs are those of the installed plugin, not of this worktree: to try changed
  hooks or skills, start a session with `claude --plugin-dir <worktree path>`.
- `.ai1/okf/` left uncommitted in the main checkout by another session does not block `finish`
  (`dirty_base_paths_ok`); anything else there does: ask the person.
- Never `git worktree remove --force` by hand: `finish` / `drop` clean up.
