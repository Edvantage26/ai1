---
name: triage-issues
description: Triage the open GitHub issues of the ai1 repo and fix them - list what is new, size each one, fix quick and plan ones each in its own worktree with "Fixes #N", take deep ones through a design first. Only for the ai1 repo. Use when the person says "hay issues nuevos", "hay un nuevo issue, míralo", "mira los issues", "revisa los issues abiertos", "arregla los issues", "new issues", "check the issues", "triage the issues".
---

# Triage ai1's issues

The issues live on the public repo `Edvantage26/ai1`. Most are filed by `/ai1:core-report-issue`
(from this or another repo, sometimes automatically), so they come with what happened, the expected
behaviour, steps and a proposal.

## 1. See what is open and new

```bash
gh issue list --repo Edvantage26/ai1 --state open --limit 30 --json number,title,createdAt,labels
gh issue view <n> --repo Edvantage26/ai1 --json number,title,body,comments
```

Read every open issue, comments included. Leave out the ones already fixed on `main` but not pushed:
`git fetch -q origin && git log --oneline origin/main..main --grep "#<n>\b"` (the `Fixes #<n>` line
is in the commit body, so a grep on the one-line log misses it). Say which those are in one line each.

## 2. Size each one, and say it

One line per issue: `#<n> <title> - size: quick|plan|deep, because ...`, following the repo's sizing
rules. A bug report with a clear cause and a proposal is usually quick. A new command, a new hook or
guard, or anything that changes a contract (config schema, a public skill's flow) is deep.

## 3. Fix them, smallest first

- **quick / plan**: one worktree per issue (`/worktree`, named after the fix, e.g. `fix-plan-write-cd`).
  Find the cause in the code before changing it. Add a test that fails without the fix and names the
  issue (`... (issue #<n>)`). Update the OKF concept the change touches. Run `npm test` in full.
  Commit in the worktree with `Fixes #<n>` on its own line in the body, then `ai1 worktree finish`.
- **deep**: `/ai1:sizing-design-before-code`. The plan's **Request** quotes the issue's title and its
  "Expected" line word for word. Its scenarios come from the issue's steps and expected behaviour.
  Show the design and wait for the person's approval before any code. Then build it the same way: own
  worktree, `Fixes #<n>`.
- The issue's proposal is input, not a decision. When the code or the bundle shows a better way
  (e.g. a core module instead of a feature that can be off), take it and say why in the plan or the report.
- When `main` moved during `finish` (another session released), run `finish` again.

## 4. Report

One line per issue: what was done (commit, tests, concept updated) or the design waiting for
approval. Pushing, tagging a release and closing the issues on GitHub are the person's call:
`Fixes #<n>` closes each one when `main` is pushed. Never push, close or comment on an issue
without the person's yes.
