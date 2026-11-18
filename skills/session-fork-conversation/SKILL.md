---
name: session-fork-conversation
description: Session — Fork the current conversation into a new one, either a full copy or a clean one with a written handoff. Use when the person says "haz un fork", "forkea la conversación", "bifurca", "abre otra conversación para...", "lanza otro agente con...", "pásale esto a una sesión nueva", "fork this", "branch this conversation", "start a new session for X with only the context it needs". Not for a change in another repository (that is /ai1:session-delegate-change).
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Fork the conversation

Two modes. The `ai1` CLI (on the Bash PATH while the plugin is enabled) detects the host and opens
the new conversation the native way; you decide the mode, write the brief and confirm.

| Mode | What the new conversation gets | Use when |
|---|---|---|
| `full` | the whole conversation, copied (`claude --resume <id> --fork-session`); the original is untouched | the person wants to try another line of the *same* work and needs everything said so far |
| `brief` | only a handoff you write: task, needed facts and decisions, files, limits, how to verify | the new work is scoped (a subtask, a side investigation, a fix elsewhere) and does not need this history |

A change to another repository is not a fork: a session started there must make it, with that
repository's own rules (/ai1:session-delegate-change).

If the person did not say which, propose one in a line with the reason and let them correct it.
Prefer `brief` when this conversation is long and the new task is narrow: it starts focused and
cheaper. A `full` fork runs one short turn over the whole context to create the copy.

## 1. Check the host

```bash
ai1 fork host --opener '${user_config.fork_opener}'
```

The person chooses where forks open with the plugin option **Fork opener** (`/config` -> ai1:
`auto`, `vscode`, `desktop`, `terminal`); pass `--opener '${user_config.fork_opener}'` exactly as written to every
`ai1 fork` command (unset, it means auto). If they say where they want it, point them to that option.
Any other tool (an agent manager, a multiplexer) opens forks through the person's own command: see
[Open forks in another tool](#open-forks-in-another-tool); their customization below says whether they
have one (pass its `--open-command` to `ai1 fork full` and `ai1 fork brief`).
- `desktop` (chosen, macOS and Windows): the Claude Desktop command or link comes first.
- `vscode`: the extension is opened on it (`vscode://anthropic.claude-code/open?...`).
- `terminal` (CLI, JetBrains, SDK and Claude Desktop, which has no signal): you get the commands
  to open it; you cannot start an interactive `claude` from a tool call.
- `web` (claude.ai/code): no full fork exists there; use `brief`, or the person runs `/branch`.

Quicker native paths the person can use themselves, worth one line when they apply: `/branch`
(copy and switch) or `/fork` (copy into a background session) in an interactive CLI, and "Fork
conversation from here" on a message in VS Code.

## 2a. Full fork

```bash
ai1 fork full --opener '${user_config.fork_opener}' [--title "<what the fork explores>"] [--task "<first instruction for the fork>"]
```

With the person's `--open-command`, their command creates the forked session and opens it (and sends
the task, if their tool can); otherwise ai1 creates it (`--claude-command "<cmd>"` when a plain
`claude` is not logged in) and the task is printed to paste. A fork loses "allow for this session"
permissions and plan mode. It fails, saying why, without a Claude Code session id or on the web
(use `brief` then).

## 2b. Brief

1. Get the path: `ai1 fork brief-path <slug>` (kebab of the task). It is `.ai1/work/handoffs/` in a
   repo that uses ai1 (git-ignored), else the temp dir.
2. Write the brief there. It is all the new conversation will know, so make it self-sufficient and
   short; no conversation history, no secrets:

   ```markdown
   # <task in one line>

   ## Task
   One paragraph: what to do and why.

   ## Context you need
   Only the facts and decisions this task depends on, each with its source (file, concept in the
   knowledge bundle, later entry, plan, commit). State what was decided, not how the discussion went.

   ## Files
   Where to look and where to change.

   ## Limits
   What not to touch; open questions to ask the person instead of guessing.

   ## Done when
   How to verify (commands, observable result).

   ## Report back
   What to return when finished.
   ```

3. Show the person the path and a two-line summary; launch after their yes:

   ```bash
   ai1 fork brief --opener '${user_config.fork_opener}' --file <path> [--title "<title>"] [--cwd <dir>]
   ```

   `--cwd` starts it in another directory (default: the repo root), e.g. when the task moves or
   removes this repo's folder.

## 3. Report

Say what was created (session id, and what the person's command printed), how to open it (the CLI
prints every way: `claude --resume`, the VS Code URI, `claude --desktop --resume` on macOS and
Windows, the Desktop link for a brief) and, when it was not opened by their command, the task to
paste. Do not keep working on the forked line here unless the person asks.

## Open forks in another tool

ai1 knows the terminal, VS Code, Claude Desktop and the web. To open forks in anything else (an agent
manager, a terminal multiplexer, a team tool), the person sets up their own command once, and you guide
them, when they ask for it, when `ai1 fork` says the opener they chose is not built in, or when it adds
the note about another tool and they want it:

1. **Ask which tool, and how it starts a conversation** from a prompt or file, and how it would take an
   existing Claude Code session by id (for a full fork). Read its docs or `--help` together.
2. **What ai1 gives the command**: placeholders, filled shell-quoted (never quote them yourself, write
   `{title}`, not `'{title}'`), unused ones empty: `{mode}` (`full` or `brief`), `{cwd}`, `{title}`,
   `{brief_file}` (brief), `{task_file}` (full, empty without `--task`), `{original_session_id}` and
   `{session_id}` (full: the new id to create). It runs with `sh -c` in `{cwd}`, with this session's
   environment, 180 s at most; what it prints is shown to the person; a non-zero exit is an error.
3. **For a full fork the command creates the session itself**, so it can use the person's launcher and
   model: `claude -p --resume <original> --fork-session --session-id <new> --tools '' "Reply only: ready."`,
   then hands `<new>` to the tool.
4. **Write a small script in the person's own config** (their dotfiles or config repo, never the
   plugin nor a project repo), for example:

   ```sh
   #!/bin/sh
   # ai1 fork opener: $1 mode, $2 cwd, $3 title, $4 brief file, $5 task file, $6 original id, $7 new id
   mode="$1"; cwd="$2"; title="$3"
   if [ "$mode" = brief ]; then
     my-tool new --cwd "$cwd" --title "$title" --prompt-file "$4"
   else
     claude -p --resume "$6" --fork-session --session-id "$7" --tools '' "Reply only: ready." >/dev/null &&
       my-tool import "$7" --cwd "$cwd" --title "$title"
   fi
   ```

   and the command: `<path to script> {mode} {cwd} {title} {brief_file} {task_file} {original_session_id} {session_id}`.
5. **Try it once** with a throwaway brief (`ai1 fork brief --open-command "<command>" --file <brief>`)
   and check with the person that it opened where they wanted.
6. **Save it as their personal customization** of this skill with /ai1:core-customize-skill: "pass
   `--open-command \"<command>\"` to `ai1 fork full` and `ai1 fork brief`" (and `--claude-command` if a
   plain `claude` is not logged in on their machine). From then on every fork opens there.

## Fixed rules

- Launch only after the person's yes to the mode and, for a brief, to its path and summary.
- A brief carries no secrets and no conversation history, only what the new task needs.
- Do not keep working on the forked line here unless the person asks.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context session-fork-conversation` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context session-fork-conversation`
