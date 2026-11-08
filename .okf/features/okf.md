---
type: Component
title: okf feature
description: Project knowledge in an OKF bundle - index at session start, upkeep reminder at stop, OKF toolkit skills.
tags: [okf, knowledge, hooks, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T18:23:08Z'
sources:
  - id: okf-index
    resource: src/okf/okf-index.mjs
    title: SessionStart module
  - id: okf-upkeep
    resource: src/okf/okf-upkeep.mjs
    title: Stop module
  - id: okf-bundle
    resource: src/okf/okf-bundle.mjs
    title: Shared bundle helpers and maintenance rules
---

# What it does

- **okf-index (SessionStart):** reads `<knowledge>/index.md` (default `.okf`), injects it (up to
  12,000 characters) with the maintenance rules, and records the HEAD at session start in the
  session state. Without a bundle it suggests creating one with `/jig:okf`.
- **okf-recall (UserPromptSubmit):** on every message from the person, ranks the bundle concepts
  against it (keywords without accents, 6-letter prefixes so plurals match; weights: title/tags 3,
  description/path 2, body 1, body words present in >40% of concepts ignored) and adds the top 5
  with score >= 3 to the agent's context, asking it to read the relevant ones first. Messages with
  fewer than 2 meaningful words and slash commands add nothing. ~25 ms on a 46-concept bundle.
  Reason: field data showed the agent consulted the bundle on only part of the messages once the
  session-start index was far behind in a long conversation.
- **okf-upkeep (Stop):** blocks finishing when the session left knowledge newer than the last
  bundle update: repo files changed since the session's base HEAD (tracked diff + untracked)
  modified after the newest bundle file, or project memories (`~/.claude/projects/<path>/memory/*.md`,
  not `MEMORY.md`) written **by this session**: the hook reads the session transcript
  (`transcript_path`, Write/Edit calls; incremental scan with the byte offset in the session state,
  ~0.5 s once on a 33 MB transcript, then ~0.15 s per stop) and, without a transcript, the memory's
  `originSessionId`. Other sessions open on the same repo share the memory folder; their memories
  are theirs to move. A deleted file is mentioned once per session. Asks once per set of pending changes (fingerprint in the
  session state). `.claude/settings.json`, `settings.local.json` and `jig.json` never count, nor
  `docs/rfc/` when the [rfc feature](rfc.md) is on (a proposal must not be written into the bundle).
- **Investigation reminder (Stop, same module):** knowledge found by querying or running commands
  leaves no file behind, so the same transcript scan counts investigation steps (Bash, MCP calls,
  web) since the session last edited the bundle; at 10 or more, with no file/memory reminder due,
  the agent is asked to record findings, ways to validate and ways of working (or to say in one
  line that nothing is worth keeping). The count starts over after any reminder or bundle edit.
  A bundle edit is a Write/Edit on a bundle path or a Bash command that writes there
  (`shellCommandWritesBundle`: redirects, `tee`, `sed -i`, `mv`/`cp` into it, `rm`, inline
  python/node scripts naming a bundle file); reading or validating the bundle does not count.
  Before 2026-11-08 shell edits counted as investigation and caused false reminders.
  Field data (2026-11-01): a long investigation session ran 831 steps and 41 production queries
  without writing to the bundle.
- **Validation gate (Stop, same module):** when the bundle was changed in the session, the hook
  runs the bundled validator itself (`python3 packs/okf/.../okf_validate.py --json`, ~0.2 s on a
  45-concept bundle) and blocks only on ERRORS, listing them; warnings (e.g. v0.1 legacy) never
  block. It also runs when `stop_hook_active` is set (the agent was just asked to update the
  bundle), which is exactly when it matters; the upkeep reminder itself is not repeated then.
  Loop guards: the same errors are reported once, and at most 3 validation blocks per session.
  Without `python3` it fails open (message on stderr).
- **Rules given to the agent:** update the concept and `generated: { by: claude-code/<model>, at }`
  with the real current UTC time; `log.md` only for lifecycle events; validate with `/jig:validate`
  and fix errors. On a v0.1 bundle: legacy warnings are expected, the agent must not migrate the
  bundle, and in each concept it edits it replaces `timestamp` with `generated`.
- **Field test (2026-10-31, copy of a real v0.1 bundle):** after a code change the agent updated the
  right concept and left `log.md` alone, but kept `timestamp` next to `generated`, invented the time
  and skipped `/jig:validate`. The first two led to the stricter rules above; the third to the
  validation gate. Verified in a real session: an agent wrote a concept without `type`, the hook
  blocked with the error, the agent fixed it.

# Skills and agents

From the [OKF pack](/packs/okf-pack.md): `/jig:okf`, `/jig:validate`, `/jig:visualize`,
`/jig:backfill`, and the agents `bundle-weaver` and `event-analyzer`.

# Coexistence with a standalone OKF setup

A machine may already have a standalone `okf@...` plugin and a global OKF guard hook. In a repo set
up with `jig init` and `okf` on, the standalone plugin is disabled in the personal
`.claude/settings.local.json` (no duplicate skills, nothing committed), and a guard hook should skip repos that have `.claude/jig.json`. Verified in
a real session on 2026-10-31: only `jig:*` skills listed, a single upkeep reminder.

# State

`${CLAUDE_PLUGIN_DATA}/state` (else `~/.cache/jig`), files `<session>-<hash(project)>.base` and
`.reminded`, removed after 7 days.
