---
number: 7
title: A companion orchestrator on the Claude Agent SDK for delegated sessions
size: idea
status: draft
created: 2026-11-15
updated: 2026-11-15
---

# Later 0007: A companion orchestrator on the Claude Agent SDK for delegated sessions

## Problem

When the agent needs to change another repository, the robust way is to delegate the change to a
session started in that repository, so its own ai1 config, hooks, CLAUDE.md, MCP servers and skills
apply (the limits of one session across repositories are in
[hook runtime](../okf/architecture/hook-runtime.md), "Nested repositories"). The delegation planned
inside ai1 runs `claude -p` in the other repository: a delegated session cannot ask the person
anything, so it stops and returns the question or the blocked confirmation, the calling agent asks the
person, and the delegated session is resumed with the answer (`claude -p --resume <id>`). That loop
works but is coarse: every question ends the delegated session's turn, and the person only hears about
it when the calling agent's turn reaches them.

## Idea

A separate tool, **not part of the plugin**, built on the Claude Agent SDK (Claude Code as a library):

- starts a session in the other repository (`cwd`) loading that repository's settings, CLAUDE.md and
  plugins (the SDK's setting sources; by default it may load none, so ai1 would not run);
- handles permission requests while they happen with the SDK's permission callback instead of ending
  the session, and keeps the session open for several turns with streaming input;
- reaches the person through a channel outside the conversation (a chat bot, a web app, push
  notifications) while the delegated session waits, then passes the answer back.

Alternatives: keep only the `claude -p` stop-ask-resume loop in ai1 (the current plan; zero
dependencies); route permissions with the CLI's `--permission-prompt-tool` to an MCP server that
forwards them; do nothing and open a session in the other repository by hand
(`ai1 fork brief --cwd <dir>`).

## Why it matters

People who delegate long or interactive changes across several repositories would get live questions
instead of a stop-and-resume loop. Not urgent: the `claude -p` loop covers short, bounded changes. It
is outside ai1 because the SDK is a heavy npm dependency and the plugin keeps hooks and scripts
dependency-free (see [principles](../okf/decisions/principles.md)).

## Open questions

- Does the Agent SDK authenticate with a Claude Code subscription login or only with an API key? Check
  the SDK docs (code.claude.com/docs/en/agent-sdk).
- Exact setting-source names and defaults, so the delegated session runs with the other repository's
  ai1 and hooks.
- Which channel reaches the person, and how an answer finds its waiting session.
- Whether the `claude -p` loop in ai1 is enough in practice: decide after using it.

## How to resume

- CLI flags for the loop: `claude --help | grep -E -- "--resume|--session-id|--output-format|--permission-prompt-tool"` (checked 2026-11-15).
- SDK options: the Agent SDK docs above; this entry was written without checking them.

## Outcome

Not decided.

## History

- 2026-11-15: created as an idea
