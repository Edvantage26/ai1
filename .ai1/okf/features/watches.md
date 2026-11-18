---
type: Component
title: watches feature
description: Follow what was shipped to production - the agent offers it after a release, a watch (.ai1/watches/, committed) says how it is checked (health, counts of successes and failures since the release, or an agent prompt), each person subscribes in .ai1/local/, ai1 watch run records results and totals, ai1 watch confirm records that the person tried it, and the session start says only what changed.
tags: [watches, production, release, monitoring, hooks, cli, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T08:51:46Z'
sources:
  - id: definitions
    resource: src/watches/watch-definitions.mjs
    title: Watch definitions and validation
  - id: schema
    resource: schema/watch.schema.json
    title: Watch schema
  - id: state
    resource: src/watches/watch-state.mjs
    title: Subscriptions, results, totals, confirmation
  - id: run
    resource: src/watches/watch-run.mjs
    title: Running a command watch
  - id: notice
    resource: src/watches/watch-notice.mjs
    title: SessionStart notice
  - id: detect
    resource: src/watches/watch-release-detect.mjs
    title: Release detection (PostToolUse Bash)
  - id: command
    resource: src/cli/watch-command.mjs
    title: ai1 watch
  - id: skill
    resource: skills/watches-follow-release/SKILL.md
    title: /ai1:watches-follow-release
  - id: tests
    resource: test/watches.test.mjs
    title: Tests
---

Built 2026-11-18 ([decision](../decisions/person-in-project.md)). The goal, in the person's words: when
something goes to production and apparently works, "que el sistema confirme que así ha sido y que está
funcionando, que el usuario lo ha probado y le está funcionando", and for something that happens again
and again, "cuántas veces ha funcionado de manera exitosa y si hay alguna que ha fallado". It is a
follow-up after a release, not the project's monitoring: a check that must run forever belongs there.

# Pieces

- **Release detection** (`watch-release-detect`, PostToolUse Bash): `git push` naming the trunk, a tag
  or `--tags`; `gh release create`; `npm|pnpm|yarn publish`; plus the repo's own deploy commands as
  regexes in `modules.watch-release-detect.deployCommands`. One line, once per session, telling the
  agent to offer /ai1:watches-follow-release. It never creates anything.
- **Watch** (`.ai1/watches/<id>.json`, committed, schema `schema/watch.schema.json`): `title`,
  `check` (`kind: command` with `run` as an argument list - no shell, same on every platform - or a
  command line run by the platform's shell; or `kind: agent` with a `prompt`), `expect` (`{ exitCode }`
  health, or `"counts"`), `every` (default `1d`), `suggestedFor` (default `14d`), `createdBy`. No
  secrets: the command reads them as the repo already does. config-guard asks before an edit there.
- **Subscription** (`.ai1/local/subscriptions.json`, the person's): `since`, `until`, optional `every`,
  `paused`. A new subscription starts the totals from zero.
- **Results** (`.ai1/local/state.json` `watches`): `lastRun`, `lastResult` (`ok` / `fail` / `error`),
  the last 20 runs, counts per result, `totals` for counts watches, the last problem output (500
  characters), `confirmedAt`, `lastNotified`.

# Running checks

`ai1 watch run [<id>] [--due]` - from the person's scheduler, or by the agent on a yes - runs command
watches with a timeout (`timeoutSeconds`, 30) and `AI1_WATCH_SINCE` (the last run, else the
subscription start) in the environment. Health: the expected exit code is ok, any other or a timeout
fail, a command that cannot start error. Counts: the last output line is `{"succeeded": n, "failed":
m}` for events since that date; ai1 adds them to the totals ("6 ok, 2 failed since 2026-11-18") and a
run with failures is `fail`. Agent watches are listed with their prompt; the agent follows it and runs
`ai1 watch record <id> ok|fail "<note>"`. A hook never runs a check.

# What the person hears

`watch-notice` (SessionStart, not on resume or compact) writes one line only with news: a run that was
not ok or a recovery since the last notice (with the totals), a follow-up whose `until` passed (the
subscription is removed, the definition stays), a release the person has not confirmed (asked at most
once a day until `ai1 watch confirm <id> ["note"]`), and the checks that are due. It records
`lastNotified`.

`ai1 watch list [--json]` shows every watch: followed until when, due, results or totals, confirmed.
Other commands: `add` (writes the definition and subscribes the author; `--no-subscribe`), `subscribe
[--for] [--every]`, `unsubscribe`, `pause`, `resume`.

# Validate

`node --test test/watches.test.mjs`: definitions and schema agree; health, error, timeout and counts
runs; two counts runs add up; record, confirm, pause; the notice tells a failure once and records it,
ends a follow-up, asks for confirmation once a day, lists due checks; release detection by built-in and
custom patterns, once per session. Run on Windows by the `test-windows` CI job.
