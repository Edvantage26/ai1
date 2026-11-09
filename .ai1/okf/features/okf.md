---
type: Component
title: okf feature
description: Project knowledge in an OKF bundle - index and bundle health notes at session start, CLAUDE.md drift hint, related concepts per message and per file read or edited, upkeep reminder at stop, OKF toolkit skills.
tags: [okf, knowledge, hooks, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T13:24:58Z'
sources:
  - id: okf-index
    resource: src/okf/okf-index.mjs
    title: SessionStart module
  - id: okf-upkeep
    resource: src/okf/okf-upkeep.mjs
    title: Stop module
  - id: okf-session-scan
    resource: src/okf/okf-session-scan.mjs
    title: Transcript, memory and shell-edit scan for upkeep
  - id: okf-validator
    resource: src/okf/okf-validator.mjs
    title: Bundled Python validator runner
  - id: okf-bundle
    resource: src/okf/okf-bundle.mjs
    title: Shared bundle helpers and maintenance rules
  - id: okf-recall
    resource: src/okf/okf-recall.mjs
    title: UserPromptSubmit module
  - id: okf-file-context
    resource: src/okf/okf-file-context.mjs
    title: PostToolUse module
  - id: okf-file-map
    resource: src/okf/okf-file-map.mjs
    title: File to concept map
  - id: okf-claude-md
    resource: src/okf/okf-claude-md.mjs
    title: SessionStart CLAUDE.md drift hint
  - id: okf-claude-md-check
    resource: src/okf/okf-claude-md-check.mjs
    title: CLAUDE.md drift check (hook and ai1 claude-md)
  - id: okf-tidy-claude-md
    resource: skills/okf-tidy-claude-md/SKILL.md
    title: /ai1:okf-tidy-claude-md skill
---

# What it does

- **okf-index (SessionStart):** reads `.ai1/okf/index.md`, injects it (up to
  12,000 characters) with the maintenance rules, and records the HEAD at session start in the
  session state. Without a bundle it suggests creating one with `/ai1:okf-maintain-knowledge`.
  Since 2026-11-09 it adds, only when there is something to say, two bundle health notes (at most 10
  paths each): concepts changed in commits after the last commit that touched the overview
  (`overview.md`, or the root `index.md` when the bundle has none), so the overview may not describe
  them; and concepts no `index.md` of the bundle links to (a link starting with `/` is read from the
  bundle root). The overview itself is not injected: the index links to it, and injecting it would
  cost tokens every session. Taken from a standalone OKF guard script that ai1 replaces.
- **okf-claude-md (SessionStart, since v0.20.0):** the repo's CLAUDE.md files are loaded whole in
  every session while the bundle is read on demand, so knowledge piled up in CLAUDE.md costs tokens
  every time and drifts from the concepts. A deterministic check (`src/okf/okf-claude-md-check.mjs`,
  no LLM) reads every CLAUDE.md of the repo (`git ls-files --cached --others --exclude-standard`,
  minus deleted files and the bundle; not `~/.claude/CLAUDE.md` nor `CLAUDE.local.md`), splits it into
  sections by `#`-`###` headings outside fences, and reports:
  - `too-long`: over 80 lines or 6,000 characters;
  - `duplicates-concept`: a section of >= 6 non-blank lines that holds at least 3, and 60%, of a
    concept's title/tags/description keywords (keywords in >= 20% of the concepts ignored: `hooks`,
    `repo`... matched every section), or cites a path the concept has as `resource`/`sources` (body
    citations would make overview concepts match everything);
  - `knowledge-without-concept`: a section of >= 12 non-blank lines that overlaps no concept;
  - `stale-reference`: a backticked path (with a `/` and an extension or a trailing `/`; not
    absolute, `~`, `@/`, placeholders) or a relative link that exists neither from the CLAUDE.md's
    folder, nor the repo root, nor as the end of a repo file path (`app/main.py` written for a
    `backend/` subproject). After the bundle moved from `.okf/` to `.ai1/okf/`, old `.okf/` paths show
    here.
  The hook adds one line (~70 words) with counts per kind and the offer of `/ai1:okf-tidy-claude-md`,
  only when the findings differ from the last ones told for this repo (fingerprint in
  `<state>/<hash(git common dir)>.claude-md`, shared by its worktrees; state files expire after 7
  days, so an unresolved drift is told again at most weekly). No findings, or the same ones: silence,
  zero tokens. `ai1 claude-md [--json]` prints the full report (file, section line range, kind,
  concept). The skill does what needs judgement, only on request: compares flagged sections with
  their concepts (contradictions included, checked against the code), proposes a CLAUDE.md under ~40
  lines (what the repo is, rules for every task, commands, pointer to the bundle) and, per moved
  section, the concept edit; applies after a yes, then validates.
  The best moment to offer it is when the bundle is created, since it is usually written from
  CLAUDE.md and the overlap is largest then, while the hint would only come at the next session start.
  So the three skills that set up OKF end by running `ai1 claude-md` and offering the skill in one
  line when there are findings: `/ai1:okf-maintain-knowledge` (produce, new bundle),
  `/ai1:okf-backfill-from-history` (Finalize) and `/ai1:core-setup-repo` (joined with its offer to fix
  old paths after a migration). If the person declines, the hint repeats once at the next session
  start (the CLI does not write the hint's fingerprint: its state folder may differ from the hook's).
  Measured (2026-11-09) on five real repos with 46-842-line CLAUDE.md files: check 30-140 ms. A
  scratch copy of one of them: the SessionStart entry point told the hint once and nothing on the
  second start; a subagent following the skill produced a 38-line CLAUDE.md and a destination per
  section, and its feedback added the line ranges, the deleted-files rule and the "read the
  destination concept" step. Not yet run in a live `claude` session (headless auth was unavailable).
- **okf-recall (UserPromptSubmit):** on every message from the person, ranks the bundle concepts
  against it (keywords without accents, 6-letter prefixes so plurals match; weights: title/tags 3,
  description/path 2, body 1, body words present in >40% of concepts ignored) and adds the top 5
  with score >= 3 to the agent's context, asking it to read the relevant ones first. Messages with
  fewer than 2 meaningful words and slash commands add nothing. ~25 ms on a 46-concept bundle.
  Reason: field data showed the agent consulted the bundle on only part of the messages once the
  session-start index was far behind in a long conversation.
- **okf-file-context (PostToolUse Read/Edit/Write/MultiEdit, since v0.15.0):** when the agent reads
  or edits a file a concept describes, names that concept right then (``ai1/okf: `src/x` is described
  by `.ai1/okf/y.md` (title). Read it before changing this code...``), so the knowledge arrives when
  the agent starts on the code, whatever words the person used. Claude Code requires a Read before an
  Edit, so "after Read" lands before programming. One line per concept, about 150 characters, the
  pointer only (the agent opens the concept). Deduped per session and per subagent (`agent_id`): a
  read pointer once, an update reminder once after an edit (skipped when the concept was already
  edited in the session); a concept the agent already Read, Edited or Wrote gets no read pointer.
  Silent for bundle files, `.ai1/`, `.claude/` and files outside the repo.
  Verified in a real session (2026-11-09, `claude -p --plugin-dir`): first Read of
  `src/guards/danger.mjs` got the pointer to `guards/danger.md`, the second Read nothing; a subagent
  reading the same file got its own pointer, and its state file carried its `agent_id`.
- **File to concept map (`src/okf/okf-file-map.mjs`):** built from what concepts already say, no new
  field, so bundles stay plain OKF:
  - top-level `resource` (spec §4.1, the asset the concept describes): strongest;
  - `sources[].resource` (spec §5.1, what it derives from): block, inline and plain items;
  - inline backticked code paths in the body (fenced blocks ignored), kept by shape: relative, with
    a `/`, a file with an extension or a folder of at least two segments (`src/` alone is too broad).
  Path forms follow spec §6.2 (`/x` bundle-relative, `./x` and `../x` concept-relative); a bare
  relative path (`src/x.mjs`) is read from the repo root, an **ai1 convention** (the spec would read
  it from the concept). URLs and scope descriptors are dropped. Ranking: resource > sources > body,
  a file before a folder, then the longest matched path, then the concept citing fewer paths (the
  specific one over an overview); at most 2 concepts per file. No disk check, so the map depends
  only on the bundle; cached in the state directory and rebuilt when the bundle's newest mtime
  changes. Measured on this repo (2026-11-09): build about 15 ms, cached load about 1.6 ms, a match
  about 0.03 ms. Writing `resource` or `sources` in a concept is how a repo makes it show up.
- **okf-upkeep (Stop):** blocks finishing when the session left knowledge newer than the last
  bundle update: repo files changed since the session's base HEAD (tracked diff + untracked)
  modified after the session started and after the newest bundle file (except files `ai1 worktree
  finish` brought in after its OKF checks and untouched since, see [worktrees](worktrees.md)), or project memories (`~/.claude/projects/<path>/memory/*.md`,
  not `MEMORY.md`) written **by this session**: the hook reads the session transcript
  (`transcript_path`, Write/Edit calls; incremental scan with the byte offset in the session state,
  ~0.5 s once on a 33 MB transcript, then ~0.15 s per stop) and, without a transcript, the memory's
  `originSessionId`. Other sessions open on the same repo share the memory folder; their memories
  are theirs to move. Files count only when the transcript shows a call that may have written
  (`src/core/session-writes.mjs`; without a transcript the dates alone decide), so a session that only
  read is not asked about another session's changes in the same folder. Before 2026-11-09 uncommitted
  changes from before the session, and those of a concurrent session, were reminded as this session's.
  A deleted file is mentioned once per session. The reminder also names the
  concepts the file map says describe the pending files ("probably affected", deleted files
  included, concepts already edited in the session left out, at most 5). Asks once per set of pending changes (fingerprint in the
  session state). `.claude/settings.json`, `settings.local.json` and `.ai1/config.json` never count, nor
  `.ai1/later/` when the [later feature](later.md) is on (an undecided entry must not be written into the bundle),
  nor `.ai1/work/` (scratch plans; until 2026-11-09 a plan written in a worktree, where the folder's
  own `.gitignore` was missing, was reminded as knowledge).
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
- **Discarded attempt reminder (Stop, same module, since 2026-11-09):** an approach tried and
  undone before the stop (edit, run the tests, revert) leaves no diff and may stay under 10
  investigation steps, so neither reminder above saw it and why it was dropped was lost. The same
  transcript scan keeps the files the session edited with Write/Edit since it last edited the bundle
  (memory files and bundle files left out; a bundle edit clears the list). When no file or memory
  reminder is due, the files of that list inside the repo that show no change against the base HEAD
  (not under `.ai1/` or `.claude/`, not ignored by git) are listed, with the concepts that describe
  them, and the agent is asked to record what was tried and why it was dropped, or to say in one line
  that the edit was trivial. Once per set of files, at most 3 per session; it comes before the
  investigation reminder and resets its count.
- **Validation gate (Stop, same module):** when the bundle was changed in the session, the hook
  runs the bundled validator itself (`python3 skills/okf-validate-bundle/scripts/okf_validate.py --json`, ~0.2 s on a
  45-concept bundle) and blocks only on ERRORS, listing them; warnings (e.g. v0.1 legacy) never
  block. It also runs when `stop_hook_active` is set (the agent was just asked to update the
  bundle), which is exactly when it matters; the upkeep reminder itself is not repeated then.
  Loop guards: the same errors are reported once, and at most 3 validation blocks per session.
  It tries `python3`, `python` and `py -3` (Windows) in order. Without a Python 3 it fails open and
  tells the person once per session (`systemMessage`, never blocking); before 2026-11-09 only stderr
  said it, so on Windows the gate was off without anyone knowing.
- **Structure check (Stop, same module, since 2026-11-09):** after a clean validation (or when no
  Python can validate), if this session changed or deleted concepts (any bundle page but an
  `index.md`, a `log.md` and the root `overview.md`; changed since the base HEAD and after the
  session started) without touching the overview or the root `index.md`, the agent is asked to check
  that they still describe the project, or to say in one line that they do; it is also asked to link
  from the index of their folder the concepts it changed that no `index.md` links to. Once per set of
  findings, at most 3 per session, and never when `stop_hook_active` is set (it comes at the next
  ordinary stop): changing a concept to answer the upkeep reminder must not chain a second block.
  While the validator reports errors, it waits for them to be fixed.
- **Rules given to the agent:** update the concept and `generated: { by: claude-code/<model>, at }`
  with the real current UTC time; `log.md` only for lifecycle events; validate with `/ai1:okf-validate-bundle`
  and fix errors. On a v0.1 bundle: legacy warnings are expected, the agent must not migrate the
  bundle, and in each concept it edits it replaces `timestamp` with `generated`.
- **Field test (2026-10-31, copy of a real v0.1 bundle):** after a code change the agent updated the
  right concept and left `log.md` alone, but kept `timestamp` next to `generated`, invented the time
  and skipped `/ai1:okf-validate-bundle`. The first two led to the stricter rules above; the third to the
  validation gate. Verified in a real session: an agent wrote a concept without `type`, the hook
  blocked with the error, the agent fixed it.

# Limits

- Upkeep is triggered by changed files, memories, edits undone in the session or a long investigation. A decision taken only
  in the conversation, with none of those, is not detected: recording it is up to the agent.
- Reading is suggested, not enforced: okf-file-context names the concept of each file the agent
  reads or edits, but nothing stops an edit without opening it. Files no concept cites get nothing,
  and okf-recall only finds concepts that share words with the message.
- okf-recall runs on the person's messages only; subagents get okf-file-context pointers for the
  files they read.

# Skills and agents

From the [OKF toolkit](../packs/okf-pack.md): `/ai1:okf-maintain-knowledge`, `/ai1:okf-validate-bundle`, `/ai1:okf-visualize-bundle`,
`/ai1:okf-backfill-from-history`, and the agents `bundle-weaver` and `event-analyzer`. Written in
ai1: `/ai1:okf-tidy-claude-md` (see okf-claude-md above).

# Coexistence with a standalone OKF setup

A machine may already have a standalone `okf@...` plugin and a global OKF guard hook. In a repo set
up with `ai1 init` and `okf` on, the standalone plugin is disabled in the personal
`.claude/settings.local.json` (no duplicate skills, nothing committed), and a guard hook should skip repos that have `.ai1/config.json`. Verified in
a real session on 2026-10-31: only `ai1:*` skills listed, a single upkeep reminder.

# State

`${CLAUDE_PLUGIN_DATA}/state` (else `~/.cache/ai1`), files `<session>-<hash(project)>.base` and
`.reminded`, removed after 7 days.
