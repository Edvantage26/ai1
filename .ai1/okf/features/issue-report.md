---
type: Feature
title: Issue report (/ai1:core-report-issue, ai1 issue)
description: Report a problem with ai1 as an issue on the public Edvantage26/ai1 repo - facts gathered, private data removed, created only after the person approves the text.
tags: [core, issues, feedback, github]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T06:53:04Z'
---

Module `core`: a skill and a CLI command, no hooks and no entry in `.ai1/config.json`, so any person
using ai1 can report a problem from whatever repo they are in. Code in `src/cli/issue-command.mjs`;
tests in `test/issue.test.mjs`.

# Flow

1. `ai1 issue env` prints ai1, Claude Code and Node versions, OS, host (`detectForkHost` of the
   [session fork](session-fork.md)) and the repo's enabled and unknown features. No paths, so it can
   be pasted as is. Unknown config entries usually mean an outdated plugin: update before reporting.
2. Duplicates are searched with `gh issue list -R Edvantage26/ai1`; a match gets a comment instead.
3. The draft (`.ai1/work/issue-<slug>.md`) is a minimal reproduction: what happened, expected, steps,
   environment. Paths, hostnames, private services, client names, secrets and the person's code are
   removed or made generic before the person sees it.
4. The person approves the exact text: the repo is public.
5. `gh issue create` (label `bug` or `enhancement`, retried without it if refused); without `gh`,
   `ai1 issue url` prints a prefilled `issues/new` link (title only past 8000 characters, the body
   is then pasted from the file).

# Decisions

- The agent never publishes without approval of the exact text, and the skill only reports ai1's own
  problems, not the person's code or Claude Code.
- Hooks do not suggest the skill when they fail open (possible later).
