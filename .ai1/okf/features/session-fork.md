---
type: Feature
title: Session fork (/ai1:session-fork-conversation, ai1 fork)
description: Fork the current conversation into a new one - full copy or a scoped brief - opened the native way in VS Code, terminal or Claude Desktop, or in any other tool through the person's own opener command.
tags: [session, fork, vscode, desktop, handoff, open-command]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-28T19:13:20Z'
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
(`fork-host.mjs`, `fork-session.mjs`, `claude-command.mjs`) and `src/cli/fork-command.mjs`; tests in `test/fork.test.mjs`.

# Modes

- **full** - `claude -p "<seed>" --resume $CLAUDE_CODE_SESSION_ID --fork-session --session-id <new uuid>
  --tools ""` (no tools in that turn) copies the whole conversation into a new session (one short turn; the
  original is untouched), started with `claude` or `--claude-command` / `AI1_CLAUDE_COMMAND`. Forks lose
  "allow for this session" grants and plan mode. Refused on the web and without `CLAUDE_CODE_SESSION_ID`.
- **brief** - a clean conversation whose first message is a handoff file the skill writes
  (task, needed context with sources, files, limits, done when, report back), in
  `.ai1/work/handoffs/<slug>.md` (`ai1 fork brief-path <slug>`) or the temp dir in repos without `.ai1/`;
  it writes `.ai1/work/.gitignore` first, so handoffs stay out of git even without the sizing feature.
  `ai1 fork brief --cwd <dir>` starts the new conversation in another directory (default: the repo
  root), for when the task moves or removes this repo's folder.

# How the Claude Code CLI behaves (checked on 2.1.319)

- `--tools` takes every value after it, the prompt included: `--tools "" "<seed>"` leaves no prompt and
  the resume fails with "No deferred tool marker found". The seed goes right after `-p`.
- `--resume-session-at <assistant message uuid>` (undocumented, print mode only) with `--fork-session`
  creates the copy cut at that message; the original is untouched. Checked by forking an old transcript
  of `~/.claude/projects/<cwd slug>/<id>.jsonl` and counting its `"type":"user"` lines (128 of 408).
  Message uuids are in that transcript (`uuid`, `parentUuid`; skip `isSidechain` entries).

# Hosts

| Host | Detected by | full | brief |
|---|---|---|---|
| VS Code | `CLAUDE_CODE_ENTRYPOINT=claude-vscode` or `TERM_PROGRAM=vscode` | `code --open-url vscode://anthropic.claude-code/open?session=<id>` | same with `?prompt=` |
| Terminal / JetBrains / SDK / Desktop | default (Desktop has no signal) | prints `claude --resume <id>` (+ `claude --desktop --resume` on macOS/Windows) | prints `claude "$(cat <file>)"` (+ `claude://code/new?q=`) |
| Web | `CLAUDE_CODE_REMOTE=true` | refused: brief or `/branch` | paste the brief |

The person can override detection with the plugin option `fork_opener` (`/config`: `auto`, `vscode`,
`desktop`, `terminal`), which the skill passes as `--opener '${user_config.fork_opener}'`
(`applyForkOpener` in `fork-host.mjs`): unset, `auto` or a literal `${…}` keep detection; an unknown
value keeps it with a note; the web ignores it; `desktop` where Desktop cannot open (Linux) keeps
detection with a note; `desktop` lists the Desktop command first. `paseo`, built in until v0.39, keeps
detection with a note pointing to the guided setup below. See
[skill customization](/architecture/skill-customization.md).

# Any other tool: the person's opener command

No agent manager or other third-party tool is built in (decision:
[host tooling stays out](/decisions/host-tooling-out-of-plugin.md)). `ai1 fork full|brief --open-command
"<cmd>"` (or `AI1_FORK_COMMAND`; the option wins) replaces the built-in opening (not on the web, where it
is ignored with a note): placeholders `{mode}` `{cwd}` `{title}` `{brief_file}` `{task_file}`
`{original_session_id}` `{session_id}` filled shell-quoted (unused ones empty), run with `sh -c` in
`{cwd}` with this session's environment, 180 s at most; stdout is shown (`opened: "command"`), a non-zero
exit is an error with its last lines (a brief also prints the built-in ways). In a full fork the command
creates the session itself (`claude -p --resume <orig> --fork-session --session-id <new>`), so it can use
the person's launcher and model. When a fork is only given as commands, the CLI adds a note pointing to
the skill's "Open forks in another tool": the guided setup (ask the tool, write a script in the person's
own config, try it once, save a personal customization that passes `--open-command`).

`CLAUDE_CODE_ENTRYPOINT` values are observed, not documented, so detection falls back to terminal and
every way to open the result is always printed. Native alternatives the skill mentions: `/branch`,
`/fork` (CLI) and "Fork conversation from here" (VS Code).
