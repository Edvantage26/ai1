---
type: Decision
title: Host tooling stays out of the plugin - generic options plus the person's customization
description: Why ai1 ships no code for third-party tools such as agent managers, and how a person still gets forks and delegated sessions working with theirs.
tags: [decision, fork, delegate, customization, public-repo]
status: stable
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-15T08:56:48Z'
---

# Decision

The public plugin contains no code for a particular third-party tool the person happens to use (an
agent manager, an account wrapper, a multiplexer). Where such a tool matters, ai1 offers a **generic
option** and the person's **personal skill customization** passes the value for their machine:

- `ai1 fork full|brief --open-command "<cmd>"` (or `AI1_FORK_COMMAND`): the person's command opens the
  fork in their tool ([session fork](../features/session-fork.md)).
- `--claude-command "<cmd>"` (or `AI1_CLAUDE_COMMAND`) for `ai1 delegate` and `ai1 fork full`: how to
  start Claude Code where a plain `claude` is not logged in ([delegate](../features/delegate.md)).
- The script a command names lives in the person's own config (dotfiles, config repo), never in the
  plugin nor in a project repo. The fork skill's "Open forks in another tool" guides the setup; 
  /ai1:core-customize-skill records it as personal.

Built-in hosts that stay: the terminal, VS Code, Claude Desktop and the web (Claude Code's own surfaces).

# Why

- The plugin is public and for anyone; code for one person's tool is dead weight for everyone else and
  ties ai1's releases to that tool's CLI (its flags, its JSON).
- The person decided it (2026-11-15): "Todo lo que es paseo no puede llegar al plugin oficial, es una
  customizacion del plugin".
- A CLI option plus a customization keeps everything in one place the person controls; a plugin option
  in `/config` was discarded because the agent cannot fill it in for them.

# Consequences

- The Paseo integration of `ai1 fork` (host detection, `paseo run/import`, provider launcher) was removed
  in v0.40 and moved to the author's own config as an opener script; `fork_opener=paseo` now only prints
  a note pointing to the guided setup.
- If the agent forgets to pass `--open-command`, the fork falls back to the terminal commands, visible,
  with a note on how to set it up.
