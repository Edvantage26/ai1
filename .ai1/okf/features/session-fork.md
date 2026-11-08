---
type: Feature
title: Session fork (/ai1:session-fork-conversation, ai1 fork)
description: Fork the current conversation into a new one - full copy or a scoped brief - opened the native way on Paseo, VS Code, terminal or Claude Desktop.
tags: [session, fork, paseo, vscode, desktop, handoff]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:54:41Z'
sources:
  - id: cli-sessions
    resource: https://code.claude.com/docs/en/sessions
    title: Claude Code sessions (--fork-session, transcripts, what a fork does not carry)
  - id: vscode
    resource: https://code.claude.com/docs/en/vs-code
    title: VS Code extension (URI handler, fork from a message)
  - id: desktop
    resource: https://code.claude.com/docs/en/desktop
    title: Desktop Code tab (claude --desktop --resume, claude:// deep links)
---

Module `session`: a skill and a CLI command, no hooks and no entry in `.ai1/config.json`, so it works
in any repo while the plugin is enabled (ai1 is installed at user scope). Code in `src/session/`
(`fork-host.mjs`, `fork-session.mjs`) and `src/cli/fork-command.mjs`; tests in `test/fork.test.mjs`.

# Modes

- **full** - `claude -p --resume $CLAUDE_CODE_SESSION_ID --fork-session --session-id <new uuid>
  --tools "" "<seed>"` (no tools in that turn) copies the whole conversation into a new session (one short turn; the
  original is untouched). Forks lose "allow for this session" grants and plan mode. Refused on the
  web, without `CLAUDE_CODE_SESSION_ID`, and on a non-Claude Paseo agent.
- **brief** - a clean conversation whose first message is a handoff file the skill writes
  (task, needed context with sources, files, limits, done when, report back), in
  `.ai1/work/handoffs/<slug>.md` (`ai1 fork brief-path <slug>`) or the temp dir in repos without `.ai1/`.

# Hosts

| Host | Detected by | full | brief |
|---|---|---|---|
| Paseo | `PASEO_AGENT_ID` | `paseo import <id>` with labels `ai1=fork`, `fork_mode`, `forked_from`, renamed; `--task` sent with `paseo send --no-wait` | `paseo run -d` with the current provider/model/mode, then `paseo agent detach` |
| VS Code | `CLAUDE_CODE_ENTRYPOINT=claude-vscode` or `TERM_PROGRAM=vscode` | `code --open-url vscode://anthropic.claude-code/open?session=<id>` | same with `?prompt=` |
| Terminal / JetBrains / SDK / Desktop | default (Desktop has no signal) | prints `claude --resume <id>` (+ `claude --desktop --resume` on macOS/Windows) | prints `claude "$(cat <file>)"` (+ `claude://code/new?q=`) |
| Web | `CLAUDE_CODE_REMOTE=true` | refused: brief or `/branch` | paste the brief |

`CLAUDE_CODE_ENTRYPOINT` values are observed, not documented, so detection falls back to terminal and
every way to open the result is always printed. Native alternatives the skill mentions: `/branch`,
`/fork` (CLI) and "Fork conversation from here" (VS Code).
