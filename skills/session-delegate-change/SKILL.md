---
name: session-delegate-change
description: Session — Have a change to another repository made by a session started in that repository, with its own rules, and relay its questions to the person. Use when ai1/foreign-repo refuses an edit because the file belongs to another repository with ai1, or when the person says "hazlo en el otro repo", "delega el cambio en X", "que lo haga un agente en ese repo", "delegate this to the other repo", "make the change in repo X with its own rules".
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Delegate a change to another repository

A file of another repository with ai1 active is not edited from this session: that repository has its
own config, hooks, CLAUDE.md, knowledge and skills, and only a session started there applies them.
`ai1 delegate` runs `claude -p` in that repository with a brief you write; the delegated session cannot
ask the person, so it stops and returns its questions, and you relay them.

Reading the other repository's files and knowledge is always fine; do it first to write a good brief.

## 1. Write the brief

Get a path with `ai1 fork brief-path <slug>` and write there what the delegated session needs, and only
that: it does not see this conversation.

```markdown
# <the change in one line>

## Task
What to change in that repository and why.

## Context you need
Facts and decisions it depends on, each with its source (file, concept, commit). What was decided,
not how the discussion went.

## Limits
What not to touch; what to leave to the person.

## Done when
How to check it (its tests, an observable result).
```

No secrets. `ai1 delegate` appends how to finish (status line, no push, follow that repository's rules).
A one-line change can go inline instead: `ai1 delegate --cwd <repo> "<task>"`.

## 2. Run it

```bash
ai1 delegate --cwd <repo> --brief <path>
```

It can take minutes: run it in the background (Bash `run_in_background`) and read the result when it
ends. The result is JSON (also saved; `ai1 delegate show <session-id>` prints it again):
`status`, `question`, `summary`, `session_id`, `commits`, `changed_files`, `new_worktrees`, `denied`.
The delegated run inherits this session's permission mode (`--permission-mode` overrides it).

## 3. Act on the status

| status | What you do |
|---|---|
| `done` | Tell the person what changed there (summary, commits, files, worktrees left to integrate per that repo's rules). |
| `needs-input` | Ask the person the `question`, word for word, and wait. Resume with their answer: `ai1 delegate --resume <session_id> "<their answer>"`. |
| `blocked` | A guard of that repository refused or asked to confirm `denied`. Tell the person what it wanted to run and why. Only if they say yes to that exact command: `ai1 delegate --resume <session_id> --allow-once "<command>" "<their answer>"`. A refusal (deny) cannot be lifted this way. |
| `failed` | Tell the person what is known (`summary`, `exit_code`); do not retry blindly. |

Resume as many times as needed: it is the same delegated session, with its context.

## 4. When the person wants it done here

If the person explicitly says the edit must be made from this session, record their words:
`ai1 delegate allow <repo> --because "<their words>"`; edits to that repository are allowed for the
rest of this session. Never run it without that explicit request.

## Fixed rules

- Never edit a file of another repository with ai1 from this session by another route (shell, scripts) to avoid the refusal.
- Relay the delegated session's questions to the person word for word; never answer them yourself.
- `--allow-once` and `ai1 delegate allow` only after the person's explicit yes to that exact action or repository.
- The delegated session does not push; pushing stays the person's decision.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context session-delegate-change` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context session-delegate-change`
