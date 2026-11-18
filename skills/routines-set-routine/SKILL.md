---
name: routines-set-routine
description: Routines — Set, run, launch or stop the person's own periodic tasks in this repo (run a skill, check something), reminded at session start. Use when the person says "recuérdame cada semana…", "cada lunes comprueba…", "ponme una tarea periódica", "lanza esto cada X días", "remind me every…", "every Monday check…", "set a routine", when ai1/routines says a routine is due, or when the person answers "hazlo", "lánzalo en otro agente", "ahora no" or "no me lo recuerdes más" about one.
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Routines: the person's periodic tasks

A routine is a task the person wants to do again and again in this repo: run a skill
(`/ai1:okf-validate-bundle .ai1/okf`) or follow a prompt ("check outdated dependencies"). It lives in
their ignored `.ai1/local/routines.json`, only theirs. At session start, one line says which are due;
you offer each one.

## Set one

From the person's words, pick an id (kebab), the period and the action, and confirm them in one line
("Cada lunes: comprobar dependencias desactualizadas. ¿Así?"). Then:

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" routine add <id> --every <12h|7d|mon..sun> (--skill "/name args" | --prompt "<what to do>") [--title "<short title>"]
```

`--every`: hours or days since the last run (`12h`, `7d`), or a weekday (`mon`, `tue`... `sun`, local
time) for "cada lunes". A repeated id is refused; `--replace` changes it. `ai1 routine list` shows them.

## When one is due

Offer it in one line, with your recommendation: "Toca «Dependencias». ¿La hago aquí, la lanzo en otra
conversación, o lo dejamos para mañana?" Then, on their answer:

- **Here**: do it (run the skill, or follow the prompt), tell the result, then
  `ai1 routine done <id> "<what you found, one line>"`.
- **In another agent**: `ai1 routine launch <id> --opener '${user_config.fork_opener}'`. It writes the
  task as a brief and opens a new conversation the person sees (VS Code, terminal, or their own tool
  when they set an opener command, see /ai1:session-fork-conversation). The new conversation records the
  result itself. When it only prints how to open it, give the person that line; nothing is recorded
  until the new conversation runs `done`.
- **Not now**: `ai1 routine snooze <id> [days]` (tomorrow by default).
- **Never again**: `ai1 routine off <id>` (`on` brings it back, `remove` deletes it).

Several due at once: one line for all, the person picks.

## Built-in routines

For whoever maintains ai1 in this repo, ai1 adds its own (today `later-backlog`: later entries left
open for months). They are told when their check finds something; `ai1 routine off|on|snooze` works
on them too.

## Fixed rules

- Never set, run or launch a routine without the person's yes; the session-start line only asks you to offer.
- Routines are the person's: they live in `.ai1/local/`, never in a committed file.
- Record runs only through `ai1 routine done|launch`, never by editing the files.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context routines-set-routine` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context routines-set-routine`
