---
type: Decision
title: Harness guards - close the cheap ways round ai1 and measure its cost
description: Decisions behind config-guard, test-guard, repo-rules, credential deny rules and the decision log (proposals 0001-0005, 2026-11-09).
tags: [decision, guards, verify, config]
sources:
  - id: proposal-0001
    resource: .ai1/proposals/0001-config-guard.md
    title: Guard the harness configuration from the agent
  - id: proposal-0002
    resource: .ai1/proposals/0002-test-weakening-guard.md
    title: Detect weakened, skipped or deleted tests
  - id: proposal-0003
    resource: .ai1/proposals/0003-credential-deny-rules.md
    title: Offer credential deny rules in the setup assistant
  - id: proposal-0004
    resource: .ai1/proposals/0004-hook-decision-log.md
    title: Local log of hook decisions
  - id: proposal-0005
    resource: .ai1/proposals/0005-repo-rules.md
    title: Repo-declared block and warn rules
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T09:20:51Z'
---

Context: a survey of popular skills and hook packs ([prior art](prior-art.md), 2026-11-09) checked
against ai1's code found that the agent could switch ai1 off by editing its config, pass `verify` by
weakening tests, and read credential files; and that nothing measured ai1's own cost. The person
accepted the five proposals and asked to build them all.

# Decisions

1. **Fold into existing features, no new ones.** [config-guard](../guards/config-guard.md) and
   [repo-rules](../guards/repo-rules.md) belong to `danger`, [test-guard](../guards/test-guard.md) to
   `verify`, all on by default; a repo switches one off with `modules.<id>: false`. Alternatives
   discarded: five features (more switches to explain), one `guards` feature (a test guard without
   `verify` protects nothing).
2. **Guards ask, they do not deny**, for config and tests: these files change legitimately, and the
   permission prompt is the person's consent. Only repo rules may `deny`, because the repo chose so.
3. **Config is matched by path ending**, so other worktrees' copies and user settings count.
4. **test-guard checks shapes per edit, not a Stop-time "only tests changed" rule**, which would
   block sessions that only write tests. Added tests are never flagged.
5. **Repo rules live in `.ai1/config.json`** (versioned, team-wide), validated per rule: a bad rule is
   dropped with a notice instead of invalidating the config. Writing one goes through config-guard,
   whose prompt is the approval. Anthropic's hookify (personal rule files) stays an alternative.
6. **Credential deny rules are Claude Code permissions written by `ai1 init --deny-credentials`**,
   not a new hook: zero runtime cost, and Claude Code applies them to file tools and recognised shell
   file commands. In the committed settings (team default; a deny cannot be re-allowed locally).
   **`.env` files are left out** (the person's decision: local workflows read keys from them), and only
   key files in `~/.ssh` so `~/.ssh/config` stays readable. The full `secrets` guard of the
   [roadmap](../roadmap.md) remains for secrets in staged files and scripts.
7. **The [decision log](../architecture/decision-log.md) is always on, metadata only**, with an
   environment switch instead of a config key: local, rotated, nothing private, 0.115 ms per call.

# Consequences

- The real-session check could not run (`claude -p` OAuth expired); the hook entry point was driven
  with Claude Code payloads instead (ask, ask, deny, allow as designed).
- Shared helper `src/core/tool-call-paths.mjs`: the files a tool call may change, by kind.
