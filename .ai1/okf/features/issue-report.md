---
type: Feature
title: Issue report (/ai1:core-report-issue, ai1 issue)
description: Report a problem with ai1 as an issue on the public Edvantage26/ai1 repo - facts gathered, private data removed, created only after the person approves the text.
tags: [core, issues, feedback, github]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T12:14:40Z'
---

Module `core`: a skill, a CLI command and the `issue-offer` hook, no entry needed in `.ai1/config.json`,
so any person using ai1 can report a problem from whatever repo they are in. Code in
`src/cli/issue-command.mjs` and `src/core/issue-offer.mjs`; tests in `test/issue.test.mjs` and
`test/issue-offer.test.mjs`.

# Offered when ai1 itself fails (since 2026-11-09)

When a module throws or the hook entry point crashes, the [decision log](../architecture/decision-log.md)
records an error signature (error class + first plugin file:line, nothing private) and
`src/core/pending-errors.mjs` keeps it in `errors-<hash>.json` (count, first, last). On the next
message the `issue-offer` hook (UserPromptSubmit, feature `core`, `modules.issue-offer: false` to
silence it) asks the agent to offer, in one line, a report with this skill - once per error and
plugin version (`offeredVersion`), so a crash an update did not fix comes back once. In the ai1 repo
itself it offers to fix it here instead. Only real errors: judgement calls (asks the person keeps
approving, slow modules) are never shown in other repos; they go to the [retro](retro.md) of the ai1 repo.
`ai1 issue env` lists the pending errors ("ai1 errors in this repo") for the reproduction.

# Report mode per person: `AI1_REPORT_ERRORS`

How each person wants ai1's own errors reported, in their `~/.claude/settings.json` `env` (Claude
Code passes it to hooks; never in a repo): `ask` (default, the one-line offer), `auto` or `off`
(silent; errors are still logged). `/ai1:core-setup-repo` asks it once per person and writes it with
`ai1 init --report-errors ask|auto|off`; `ai1 status` shows it.

**Auto mode** files the report without asking, which is safe only because the content is fixed:
`ai1 issue auto-body` builds the title (`ai1 error: <module> - <signature>`) and the body from
`ai1 issue env` - versions, OS, host, features and the errors' module, class and plugin file:line -
with nothing from the session, the repo or its code, and the skill adds nothing to it. A duplicate
gets a "seen again on <version>" comment; the agent tells the person the link. Any report that needs
a description (a misfire, steps) still goes through the person's yes to the exact text. ai1's
author runs with `auto` (decided 2026-11-09). An unknown value means `ask`.

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

- The agent never publishes without approval of the exact text, except the fixed-facts auto report
  a person opted into, and the skill only reports ai1's own problems, not the person's code or Claude Code.
- Hooks suggest the skill only for ai1's own errors, never for misfires (those need judgement).
