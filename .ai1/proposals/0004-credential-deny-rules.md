---
proposal: 4
title: Offer credential deny rules in the setup assistant
size: idea
status: implemented
created: 2026-11-09
updated: 2026-11-09
decided: 2026-11-09
---

# Proposal 0004: Offer credential deny rules in the setup assistant

## Problem

ai1 has no hook before Read or Grep (`hooks/hooks.json`, checked 2026-11-09), so nothing keeps the
agent from reading `.env`, SSH keys or cloud credentials into the transcript. A full `secrets` guard
(roadmap phase 3) needs a new matcher and a parser of shell read targets.

## Idea

Cheap first step, no runtime cost: `/ai1:core-setup-repo` offers to write Claude Code permission
`deny` rules for credential paths (`Read`/`Edit` of `.env*`, `~/.ssh/**`, `~/.aws/**`, `*.pem`,
`~/.npmrc`, `~/.pypirc`...) into `.claude/settings.json`, and says plainly that they bind Bash only
when `/sandbox` is on.

Alternatives: do nothing; the full PreToolUse `secrets` guard (Read, Grep and Bash read targets,
plus secrets in staged files); both, the rules now and the guard later.

Prior art: [trailofbits/claude-code-config](https://github.com/trailofbits/claude-code-config) deny
lists (no license: ideas only), `protect-secrets` (karanb192, MIT).

## Why it matters

Secrets read into a transcript leave the machine. Small change to one skill. Not urgent.

## Open questions

- Which paths by default, and which a repo needs to read (`.env.example`)?
- Committed `.claude/settings.json` or personal `settings.local.json` (home paths are personal)?
- Does it make the roadmap `secrets` guard smaller or replace part of it?

## How to resume

Survey and code check: `.ai1/okf/decisions/prior-art.md` ("Skills and hook packs survey" and "Harness and memory projects", 2026-11-09). Check Claude Code's permission-rule docs for the current deny syntax.

## Outcome

Accepted and built on 2026-11-09 (v0.21.0): `ai1 init --deny-credentials`, asked by the setup skill, appends permission deny rules for key files and home credential stores to the committed `.claude/settings.json`. The person decided to leave `.env` files out. Only `~/.ssh/id_*`, so `~/.ssh/config` stays readable. The roadmap `secrets` guard remains for staged files. Concepts: `.ai1/okf/features/init.md`, `.ai1/okf/decisions/harness-guards.md`.

## History

- 2026-11-09: created as an idea
- 2026-11-09: status accepted
- 2026-11-09: status implemented
