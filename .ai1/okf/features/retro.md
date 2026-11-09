---
type: Component
title: ai1 retro (project skill of the ai1 repo)
description: ai1-retro reads every repo's decision log on this machine (ai1 log --all) and proposes fixes to ai1 - errors, likely false positives, slow or context-heavy modules - without showing hook problems in other repos.
tags: [retro, observability, skills]
resource: .claude/skills/ai1-retro/SKILL.md
sources:
  - id: log-command
    resource: src/cli/log-command.mjs
    title: ai1 log --all
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T12:10:02Z'
---

Built 2026-11-09. A **project skill** (`.claude/skills/ai1-retro/`), so it exists only in this repo
and does not ship with the plugin: the person asked that hook problems never show up in the repos
ai1 is used in. Idea from Matt Pocock's `retro` skill ([prior art](../decisions/prior-art.md)).

# How it works

1. `node bin/ai1 log --all --since 168 --json` (a week; the installed `ai1` may be older): every
   `decisions-<hash>.jsonl` in every ai1 state dir, named by its `.repo` sidecar, summarized per repo
   and module - runs, decisions, ms, characters, `errors` by signature, `rules` behind asks, and
   `asks` answered (approved / refused / unknown).
2. Ask outcomes come from the session transcripts (`~/.claude/projects/*/<session>.jsonl` and its
   `subagents/`): the `tool_result` of the asked call is `refused` when Claude Code says the person did
   not want to proceed, `approved` when the tool ran (even if it then failed), `unknown` without a
   transcript. Counted per module and tool call.
3. The skill sorts findings (errors; 5+ asks with 80%+ approved; often refused; avg above 20 ms;
   chars per run on SessionStart/UserPromptSubmit; never fires), shows a table and proposes fixes
   with a test, applying none without a yes. Nothing from other repos goes into anything public.

Checked on synthetic logs (2026-11-09): an error, a 7/7-approved rule and a slow, heavy recall all
surfaced. Repos unused for 7 days are absent: state files expire (`removeExpiredStateFiles`).
