---
type: Component
title: reuse feature
description: Reuse - after real work the session judges whether it will recur in this repo, searches this repo's own past sessions and project skills/commands/MCP servers (ai1 reuse search) and proposes in one line to encapsulate it (rule, hook, script, skill, MCP entry) or complete or merge an existing piece; built only on a yes with /ai1:reuse-encapsulate; a no is kept in .ai1/reuse.json.
tags: [reuse, skills, hooks, cli, transcripts]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-13T13:14:37Z'
sources:
  - id: reuse-history
    resource: src/reuse/reuse-history.mjs
    title: Repo transcript folders, keyword search, project inventory, dismissals
  - id: reuse-check
    resource: src/reuse/reuse-check.mjs
    title: Stop hook - asks to judge recurrence after 8+ tool calls
  - id: reuse-brief
    resource: src/reuse/reuse-brief.mjs
    title: SessionStart text
  - id: reuse-encapsulate
    resource: skills/reuse-encapsulate/SKILL.md
    title: /ai1:reuse-encapsulate
---

Built 2026-11-13 (deep plan `reuse`). Off by default; `/ai1:core-setup-repo` recommends it when the
repo already keeps `.claude/skills`, `.claude/commands` or `.mcp.json`. Prior art in
[prior art](../decisions/prior-art.md) (section of 2026-11-13).

# How it works

- **Judgment is the agent's, the trigger and the search are deterministic.** No model in hooks, no
  background observer (unlike ECC continuous-learning), no counting ledger: the repo's own transcripts
  are the count.
- `reuse-brief` (SessionStart): before a task that sounds done before here, run `ai1 reuse search`
  and reuse how it was done; how to word a proposal; only this repo.
- `reuse-check` (Stop): tool calls counted from the transcript (incremental) across turns; at
  `modules.reuse-check.minToolCalls` (default 8) since the last check it blocks once asking for one line:
  low → finish; medium → `ai1 reuse search` and propose only with evidence; high → propose. The count
  restarts after each check; at most 2 per session.
- `ai1 reuse search "<keywords>" [--days 90] [--json]`: terms = lowercased words of 3+ letters (2 with a
  digit: o2, s3) minus stopwords; a session or a project piece matches with half or more of the terms.
  Searches real user prompts (not meta, not `<`-wrapped), Bash commands, MCP tool calls and Skill
  names in `~/.claude/projects/<main checkout, / and . as ->` and `<same>--claude-worktrees-*`, never
  another repo's folder, skipping `CLAUDE_CODE_SESSION_ID`. Inventory: `.claude/skills/*/SKILL.md`,
  `.claude/commands/*.md`, `.mcp.json` servers - project level only (the person's ruling).
- `ai1 reuse dismiss <slug> --keywords "<words>" "<why>"`: `.ai1/reuse.json`
  (`{ dismissed: [{ slug, keywords, reason, date }] }`), committed - a no is a project decision and
  must outlive the 7-day expiry of local state. Search prints matching dismissals so they are not proposed again.
- `/ai1:reuse-encapsulate`: evidence from the search, the skeleton (fixed steps, parameters, checks,
  pitfalls; only from work that ended well), container from a table (guard rule or bundle line /
  hook / script / skill / MCP entry / complete an existing piece / merge overlapping ones), build in the
  repo, run it once on the real case. Customizable (project and user overlays) for where pieces go.

# Decisions (2026-11-13, by the person)

- Semi-automatic and in the conversation: the session detects likely recurrence, searches past
  conversations, or proposes directly when it is very likely.
- Only the repo where ai1 is active: never other repos' sessions or skills.
- Completing or restructuring existing skills/MCPs comes before creating new ones, to keep the harness in order.

# How to check it

`node --test test/reuse.test.mjs` (scenarios `reuse:S1`-`S5`). On a real repo:
`ai1 reuse search "<words of a task done before>"` should list its past sessions (ai1 repo: "storyboard
capturas flujo" finds the session of 2026-11-09 in ~2 s).
