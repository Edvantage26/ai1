---
name: reuse-encapsulate
description: Reuse — Turn work that keeps coming back in this repo into a reusable piece (rule, hook, script, skill, MCP entry) or complete or merge one the project already has, after the person says yes to the one-line proposal. Use when the person accepts a reuse proposal ("sí, encapsúlalo", "hazle una skill", "conviértelo en script", "complétalo en la skill que ya hay"), or says "esto lo hacemos siempre, hazlo reutilizable", "turn this into a skill", "make this reusable". Not for noting it down for later (/ai1:later-write).
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Reuse: encapsulate repeated work in this repo

The person said yes to encapsulating something this repo keeps doing. Build it **inside this repo**,
smallest container first, without leaving a second piece that does the same.

## 1. Gather the evidence

- Run `ai1 reuse search "<3-5 keywords>"` (twice with other words if the first finds little). It
  lists this repo's past sessions that did it and the project skills, commands and MCP servers that
  already cover part of it. Never use other repos' sessions.
- From this conversation and those sessions, write down the **skeleton**: the steps that were the same
  every time, the values that changed (they become parameters), the checks that proved it worked, and
  what went wrong on the way (it becomes a rule of the piece). Only from work that ended well.

## 2. Pick the container

Take the first row that fits:

| What repeats | Container |
|---|---|
| The same correction of the agent | A guard rule (/ai1:danger-write-rule) or a line in the knowledge bundle, not a skill |
| Something that must happen on an event, every time (after an edit, before a commit) | A hook in `.claude/settings.json` |
| Fixed steps with no judgment | A script in the repo (`scripts/` or the repo's usual place), called from a skill only if the agent needs to know when |
| A procedure that needs judgment (choices, reading results) | A project skill: `.claude/skills/<name>/SKILL.md` |
| Access to an external system with credentials or state, used as tools | An MCP server entry in `.mcp.json` (secrets by environment variable), with a skill that says how to use it if the tools alone are not enough |
| An existing project piece covers part of it | **Complete it**: add the missing steps or parameters there, or fix its description if it did not trigger |
| Two existing pieces overlap with it | **Merge or restructure** them into one, and remove the leftover |

Say the chosen container, why, and what it replaces in one or two lines before building.

## 3. Build it

- Reuse before writing: extend the existing piece when there is one.
- A skill: frontmatter `name` and a `description` that says **when** to use it with the person's own
  words as triggers (that is how it gets picked), then the steps, parameters and the check. Keep it
  short; put long references in files next to it.
- A script: parameters instead of the values seen in the sessions, fails with a clear message, no
  secrets in the file.
- Never write secrets, tokens or internal hostnames into committed files: environment variables.

## 4. Check that it works

Run it once on the real case of this conversation (the script, the hook's command, the MCP tool, or
follow the skill's steps) and show the result. For a skill, also check its description would trigger:
read it next to the person's original request.

## 5. Report

One line per file created or changed, what it replaces, and how to call it. Leave committing to the
repo's usual way of working.

## Fixed rules

- Only after the person's yes; a no is recorded with `ai1 reuse dismiss` and never proposed again.
- Only this repo: never read, cite or copy from other repos' sessions.
- Never leave two pieces doing the same thing: complete or merge before creating.
- No secrets in committed files.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context reuse-encapsulate` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context reuse-encapsulate`
