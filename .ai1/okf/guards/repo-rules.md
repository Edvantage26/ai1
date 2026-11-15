---
type: Component
title: repo-rules
description: PreToolUse guard that applies the repo's own rules from `rules` in .ai1/config.json (ask or deny matching shell commands and edits), and the /ai1:danger-write-rule skill that writes them.
tags: [guard, hooks, config, rules]
resource: src/guards/repo-rules.mjs
sources:
  - id: rules-config
    resource: src/core/repo-rules-config.mjs
    title: Rule validation
  - id: write-rule-skill
    resource: skills/danger-write-rule/SKILL.md
    title: /ai1:danger-write-rule
  - id: proposal-0006
    resource: .ai1/later/0006-repo-rules.md
    title: Later 0006
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-15T14:49:27Z'
---

Feature `danger` (on by default), PreToolUse on Edit, Write, MultiEdit, NotebookEdit and Bash.
Built 2026-11-09 from later 0006; decision in [harness guards](../decisions/harness-guards.md).

# Contract

`rules` in `.ai1/config.json` ([contract](../architecture/harness-contract.md)), a list of:

```json
{ "id": "use-pnpm", "on": "bash", "pattern": "^npm (install|i|ci)\\b", "action": "deny", "message": "this repo uses pnpm: run pnpm install." }
{ "id": "generated-code", "on": "edit", "paths": ["src/generated/**"], "action": "deny", "message": "generated: change the schema and run codegen." }
```

- `on: bash`: `pattern` (required) is tested against each simple command of the line, as split by
  `shell-parse` (words joined by one space, quotes removed; `bash -c`, `eval` and `find -exec` unwrapped).
- `on: edit`: `paths` (globs from the repo root) limit the files; `pattern` is tested against the new
  text only (`new_string`, written `content`, MultiEdit new strings, `new_source`). At least one of the two.
- `on: mcp` (since v0.42.3): `tool` (regex) is tested against the MCP tool name and `pattern` against the
  call's `tool_input` as JSON (capped at 20,000 characters); at least one of the two. The PreToolUse
  matcher in hooks/hooks.json includes `mcp__.*`, and only repo-rules loads for MCP calls (its `toolNames`
  has `mcp__*`, a prefix match in `modulesForEvent`). Found setting up a repo whose database is also
  reachable through an MCP server: a heavy query that way escaped every rule.
- `flags` (since v0.42.3): `i`, `m`, `s`, `u` for `pattern` and `tool`. Without them a case-insensitive
  rule had to spell `[Ss][Ee][Ll]...`, which also hit the 300-character limit.
- `action`: `ask` or `deny` (deny wins when several match; the reason lists every match as `[id] message`).
- Validation (`src/core/repo-rules-config.mjs`): kebab-case unique `id`, known fields only, `message`
  required, `pattern` compiles and is at most 300 characters. A bad rule is **dropped with a notice**
  at session start, never an error, so one rule cannot switch ai1 off; `rules` that is not a list
  makes the config invalid like any type error. Tested input is capped at 20,000 characters.
- `ai1 status` lists the active rules and why the others are ignored.

# Writing rules

`/ai1:danger-write-rule` turns a correction ("never do X again") or a CLAUDE.md line into one rule:
pins down what it catches, `ask` vs `deny` and the message, checks the pattern against examples,
shows the JSON and adds it with Edit after a yes - where [config-guard](config-guard.md) asks the
person once more (that prompt is the final approval). It offers to remove the CLAUDE.md line it
replaces. Anthropic's `hookify` plugin does the same per person (`.claude/hookify.*.local.md`); ai1
rules are versioned with the repo.

This repo uses it on itself (2026-11-09): `no-npm-dependencies` (deny adding dependencies to
`package.json`) and `no-git-permission-grants` (deny writing a `Bash(git commit|push ...)` permission in
the plugin's code, skills, templates, hooks or schema), plus the credential deny rules from
`ai1 init --deny-credentials`. A rule against internal hostnames was left out: its pattern would have
to name them in a committed file of a public repo; repo rules have no local, uncommitted layer.

Tests: `test/repo-rules.test.mjs`.
