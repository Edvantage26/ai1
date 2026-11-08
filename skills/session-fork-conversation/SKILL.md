---
name: session-fork-conversation
description: Session — Fork the current conversation into a new one, opened where the person works (Paseo agent, VS Code, terminal, Claude Desktop). Two modes - full (a copy of the whole conversation, to explore another line without losing this one) and brief (a clean conversation that only gets a written handoff with the context it needs). Use when the person says "haz un fork", "forkea la conversación", "bifurca", "abre otra conversación para...", "lanza otro agente con...", "pásale esto a una sesión nueva", "fork this", "branch this conversation", "start a new session for X with only the context it needs".
---

# Fork the conversation

Two modes. The `ai1` CLI (on the Bash PATH while the plugin is enabled) detects the host and opens
the new conversation the native way; you decide the mode, write the brief and confirm.

| Mode | What the new conversation gets | Use when |
|---|---|---|
| `full` | the whole conversation, copied (`claude --resume <id> --fork-session`); the original is untouched | the person wants to try another line of the *same* work and needs everything said so far |
| `brief` | only a handoff you write: task, needed facts and decisions, files, limits, how to verify | the new work is scoped (a subtask, a side investigation, a fix elsewhere) and does not need this history |

If the person did not say which, propose one in a line with the reason and let them correct it.
Prefer `brief` when this conversation is long and the new task is narrow: it starts focused and
cheaper. A `full` fork runs one short turn over the whole context to create the copy.

## 1. Check the host

```bash
ai1 fork host
```

- `paseo`: the new conversation becomes a Paseo agent (same provider, model and mode as this one,
  labelled `ai1=fork`, `fork_mode`, `forked_from`), independent from this agent.
- `vscode`: the extension is opened on it (`vscode://anthropic.claude-code/open?...`).
- `terminal` (CLI, JetBrains, SDK and Claude Desktop, which has no signal): you get the commands
  to open it; you cannot start an interactive `claude` from a tool call.
- `web` (claude.ai/code): no full fork exists there; use `brief`, or the person runs `/branch`.

Quicker native paths the person can use themselves, worth one line when they apply: `/branch`
(copy and switch) or `/fork` (copy into a background session) in an interactive CLI, and "Fork
conversation from here" on a message in VS Code.

## 2a. Full fork

```bash
ai1 fork full [--title "<what the fork explores>"] [--task "<first instruction for the fork>"]
```

With `--task`, Paseo sends it to the new agent right away; elsewhere it is printed to paste. A fork
loses "allow for this session" permissions and plan mode. It fails, saying why, without a Claude
Code session id, on the web, or when the Paseo agent is not a Claude one (use `brief` then).

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
   knowledge bundle, RFC, plan, commit). State what was decided, not how the discussion went.

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
   ai1 fork brief --file <path> [--title "<title>"]
   ```

## 3. Report

Say what was created (Paseo agent id or session id), how to open it (the CLI prints every way:
`paseo agent open`, `claude --resume`, the VS Code URI, `claude --desktop --resume` on macOS and
Windows, the Desktop link for a brief) and, for a full fork with a task outside Paseo, the task to
paste. Do not keep working on the forked line here unless the person asks.
