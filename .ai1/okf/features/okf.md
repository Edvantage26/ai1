---
type: Component
title: okf feature
description: Project knowledge in an OKF bundle - index and bundle health notes at session start, project context (purpose, scope, requirements, open questions, how it runs in production) with its interview, CLAUDE.md drift hint, catch-up after merging a branch without a bundle, related concepts per message and per file read or edited, upkeep reminder at stop, OKF toolkit skills.
tags: [okf, knowledge, hooks, skills]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-22T14:30:25Z'
sources:
  - id: okf-index
    resource: src/okf/okf-index.mjs
    title: SessionStart module
  - id: okf-catch-up
    resource: src/okf/okf-catch-up.mjs
    title: Catch-up after merging a branch without a bundle (detection, brief, ai1 okf catch-up)
  - id: okf-catch-up-start
    resource: src/okf/okf-catch-up-start.mjs
    title: SessionStart catch-up module
  - id: okf-catch-up-prompt
    resource: src/okf/okf-catch-up-prompt.mjs
    title: UserPromptSubmit catch-up module (after HEAD moved)
  - id: okf-upkeep
    resource: src/okf/okf-upkeep.mjs
    title: Stop module
  - id: okf-session-scan
    resource: src/okf/okf-session-scan.mjs
    title: Transcript, memory and shell-edit scan for upkeep
  - id: okf-validator
    resource: src/okf/okf-validator.mjs
    title: In-process validator runner
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
  - id: secret-lines
    resource: src/core/secret-lines.mjs
    title: Literal secret detector used by the CLAUDE.md drift check
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
  - id: okf-project
    resource: src/okf/okf-project.mjs
    title: Project context - gap map, requirements, open questions
  - id: okf-project-command
    resource: src/okf/okf-project-command.mjs
    title: ai1 okf project
  - id: okf-project-brief
    resource: src/okf/okf-project-brief.mjs
    title: SessionStart project context module
  - id: okf-interview-project
    resource: skills/okf-interview-project/SKILL.md
    title: /ai1:okf-interview-project skill
---

# What it does

- **okf-index (SessionStart):** reads `.ai1/okf/index.md`, injects it (its first lines up to
  3,000 characters, the rest left out with a pointer to `index.md`; the lines are a list the shared
  session-start budget of [hook runtime](../architecture/hook-runtime.md) can shorten further) with the maintenance rules, and records the HEAD at session start in the
  session state. Without a bundle it suggests creating one with `/ai1:okf-maintain-knowledge`.
  Since 2026-11-09 it adds, only when there is something to say, two bundle health notes (at most 3
  paths each, 10 until 2026-11-15, with how many more and how to find them): concepts changed in commits after the last commit that touched the overview
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
  - `secret-in-claude-md`: a section with a line that looks like a literal secret
    (`src/core/secret-lines.mjs`: known token prefixes, a URL with a password, or a label such as
    password, token or API key next to a literal of 12+ characters; placeholders, env var names and
    values with a `/` are not secrets). It replaces the two findings above for that section: moving it
    would put the secret in the committed bundle. Only line numbers are reported, never the value.
    Added 2026-11-15 after `ai1 claude-md` proposed moving a section of plaintext credentials into a
    real project's bundle;
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
  So the two skills that set up OKF end by running `ai1 claude-md` and offering the skill in one
  line when there are findings: `/ai1:okf-maintain-knowledge` (produce, new bundle) and
  `/ai1:core-setup-repo` (joined with its offer to fix old paths after a migration). If the person declines, the hint repeats once at the next session
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
  Measured 2026-11-15 on 18 real prompts of this repo labelled with their relevant concepts: 20%
  of the suggestions relevant, a relevant one for 9 of 16 prompts that need one, 3 suggestions on the
  2 that need none. The noise comes from Spanish words read as English ones ("resumes" as resume,
  "internet" cut to "intern" as internal) and from words many concepts carry (`hooks`, `plugin`,
  `skill`) reaching the score alone. Tried and not kept: discounting common words in every field
  (hits fell to 1-5 of 16: most real matches go through those words), a higher minimum score or fewer
  suggestions (hits fell faster than noise), a floor relative to the best score (no gain), trimming
  plurals (worse). 8-letter prefixes plus Spanish false friends as stop words gave 28% and 10 of 16,
  but on 8 other prompts it came out slightly worse than today (2 of 6 against 3 of 6): fitted to the
  set, not better. The limit is the language gap (Spanish messages, an English bundle), which
  keyword matching cannot bridge. To try a change again: score both sets with `rankConceptsForPrompt`
  and keep it only if the held-out set improves too.
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
  changes. `ai1 okf file-map <file>...` (from the project root, `--json`) prints the concepts ai1
  names for each file, exit 1 when one has none: the check a producer runs after writing concepts that
  cite code (before it, the only way was importing the module by hand). Measured on this repo (2026-11-09): build about 15 ms, cached load about 1.6 ms, a match
  about 0.03 ms. Writing `resource` or `sources` in a concept is how a repo makes it show up.
  A source with `role: evidence` is left out of the map: it proves a claim without the concept
  describing that file (on a large bundle, MCP server code cited as evidence tied with the concept
  that describes the server). `ai1 okf file-map` marks a file whose top concepts tie (`tie` in JSON
  and a warning line). The validator warns on a `role` other than `evidence`.
- **`ai1 okf scan-secrets <path>...`** (`src/okf/okf-scan-secrets.mjs`): `file:line` of the lines that
  look like a literal secret, with the heuristic of `src/core/secret-lines.mjs` (shell defaults such
  as `${PG_PASSWORD:-value}` included), never the value. Available on demand; the produce skill no longer runs it (v0.46.0: the skill only says never to copy a secret).
- **Validator dates:** `generated.at` and `verified.at` later than now (5 minutes of skew pass) are
  warned: a time written by hand ahead of the clock makes a concept look fresher than it is.
- **Catch-up after merging a branch without a bundle (okf-catch-up-start on SessionStart,
  okf-catch-up-prompt on UserPromptSubmit, since 2026-11-16; `src/okf/okf-catch-up.mjs`):** okf-upkeep
  only sees what a session changed, so a branch that never had the documentation folder (forked before
  ai1, or worked on without the plugin) merged in a terminal or on a forge and pulled brought code into
  the history that nobody documented. The person asked for it to be detected on its own and filled in
  automatically, told in the conversation. Rule (the person's, 2026-11-16): on the current branch,
  whatever it is, a **joining merge** is a merge commit where one parent has the bundle
  (`.ai1/okf/index.md`, or the legacy `.okf/index.md`: a branch forked before a repo moved its bundle
  had documentation) and another parent has neither. Its changes are its real effect against the parent
  with the bundle (`git diff --name-only <that parent> <merge>`, conflict resolution included, minus
  `.ai1/`, `.okf/`, `.claude/`). It is closed by a commit reachable from HEAD carrying the trailer
  `Knowledge-Catch-Up: <merge sha>` (7+ hex characters): the record lives in git, so it survives the
  7-day state expiry, is the same in every clone and survives the rebase of `ai1 worktree finish`.
  Nothing to document still leaves a record (an empty commit with the reason and the trailer).
  - **What the agent is told** (about 100 tokens, once): the merge (short sha, subject), how many files,
    up to 5 probably affected concepts from the file map and how many files no concept describes; to tell
    the person in one line and launch an **independent background agent** (Agent tool,
    `run_in_background`) whose prompt is `ai1 okf catch-up --brief <sha>`, then carry on with the task.
    The background agent keeps the analysis out of the conversation's context and the docs out of the
    task's diff: the brief has it create a worktree, read the merge's diff, update or create concepts
    (with the bundle's maintenance rules, `description` and `tags`; behaviour, APIs, data and rules are
    worth a concept even without callers, tests and renames alone are not; what the code does not show
    is written as unknown), validate, commit with the trailer and `ai1 worktree finish`.
  - **When:** at session start; on each message only after HEAD moved since the last check for the
    session (a merge or pull in a terminal with the session open is seen at the next message; otherwise
    one `git rev-parse`); and at Stop for a merge the agent made in the session: okf-upkeep leaves its files
    out of its file reminder (they are not the session's work) and blocks once with the same instruction.
  - **Claims:** a merge told to a session is not told to another for 2 hours (state per git common dir,
    `<hash>.catch-up`, shared by worktrees); a new merge is told anyway; after 2 hours without the
    trailer it is told again.
  - **Cost:** the newest 30 merges within the last 2,000 commits, parents checked in one
    `git cat-file --batch-check`; 30-90 ms warm on six real repos of 290-780 commits (2026-11-16; a cold
    disk cache took up to 1 s once). Zero tokens when nothing is pending.
  - **Not chosen:** a watermark in ai1 state (expires, per machine, cannot tell a branch without the
    system from ordinary work); per-file staleness against concepts (every legitimate "nothing to
    document" commit becomes noise); restricting it to the trunk (the person switches branches often and
    it added nothing; two branches catching up the same merge is rare and meets as an ordinary conflict).
  - **Verified (2026-11-16):** a scratch repo with a branch forked before the bundle merged in a terminal:
    the real hook entry point (`bin/ai1-hook.mjs SessionStart`) injected the instruction; a subagent
    given the brief updated the affected concept, created one for the undescribed file, left unknowns
    as such, committed with the trailer, and after `ai1 worktree finish` the next session start said
    nothing. A live `claude -p` session could not run (headless auth expired), so whether the main agent
    launches the background agent by itself is not yet observed. The subagent's feedback added the
    maintenance rules, `description`/`tags` and the "worth a concept" line to the brief.
- **okf-upkeep (Stop):** blocks finishing when the session left knowledge newer than the last
  bundle update: repo files changed since the session's base HEAD (tracked diff + untracked)
  modified after the session started and after the newest bundle file (except files `ai1 worktree
  finish` brought in after its OKF checks and untouched since, see [worktrees](worktrees.md)), or project memories (`~/.claude/projects/<path>/memory/*.md`,
  not `MEMORY.md`) written **by this session**: the hook reads the session transcript
  (`transcript_path`, Write/Edit calls; incremental scan with the byte offset in the session state,
  ~0.5 s once on a 33 MB transcript, then ~0.15 s per stop) and, without a transcript, the memory's
  `originSessionId`. Other sessions open on the same repo share the memory folder; their memories
  are theirs to move. Files count only when modified inside one of the session's write windows (a
  call that may write was running; `src/core/session-writes.mjs`, same rule as [verify](verify.md);
  a deleted file has no date and counts when the session has any window; without a transcript the
  dates alone decide), so a session that only read, or wrote only scratch files outside the repo, is
  not asked about another session's changes in the same folder. Before 2026-11-09 uncommitted
  changes from before the session, and those of a concurrent session, were reminded as this session's;
  until the write windows (same day) one command not known to be read-only was enough for that.
  The transcript reader skips the `api-request-blob` lines (copies of each request, without a
  timestamp); until 2026-11-09 they made every call count twice, investigation steps included.
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
  While agents the session launched in the background have not reported back (an Agent tool result
  "Async agent launched successfully" with no later `<task-notification>` carrying its
  `<tool-use-id>` and a finished `<status>`), the reminder waits: before, it pushed a concept written
  before the reports arrived (2026-11-15). The detector is `src/core/background-agents.mjs`, shared
  with reuse-check.
  A bundle edit is a Write/Edit on a bundle path or a Bash command that writes there
  (`shellCommandWritesBundle`: redirects, `tee`, `sed -i`, `mv`/`cp` into it, `rm`, inline
  python/node scripts naming a bundle file); reading or validating the bundle does not count.
  Before 2026-11-08 shell edits counted as investigation and caused false reminders. Since
  2026-11-16 a target held in a variable set to a literal earlier in the line (`f=.ai1/okf/x.md &&
  sed -i ... $f && cat >> "$f"`) is expanded (`src/core/shell-writes.mjs`); before, such edits went
  unseen and the reminder asked for knowledge already written (three times in one session).
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
  Since 2026-11-10 the transcript scan skips events stamped before the session base: in a session where
  ai1 became active midway (set up while it ran, first base recorded at a later stop) the whole
  transcript was read from its start, and edits committed days before showed as undone (a long session
  of a real repo got a dozen `app/*.py` files listed).
- **Validation gate (Stop, same module):** when the bundle was changed in the session, the hook
  runs the validator in-process (`src/okf/okf-validate.mjs`, the same as `ai1 okf validate`) and
  blocks only on ERRORS, listing them; warnings (e.g. v0.1 legacy) never
  block. It also runs when `stop_hook_active` is set (the agent was just asked to update the
  bundle), which is exactly when it matters; the upkeep reminder itself is not repeated then.
  Loop guards: the same errors are reported once, and at most 3 validation blocks per session.
  If the validator itself crashes it fails open and tells the person once per session
  (`systemMessage`, never blocking). Until 2026-11-15 it was the Python script of the toolkit, found
  as `python3`, `python` or `py -3`: without Python (common on Windows) the gate was off.
- **Structure check (Stop, same module, since 2026-11-09):** after a clean validation (or when the
  validator could not run), if this session changed or deleted concepts (any bundle page but an
  `index.md`, a `log.md` and the root `overview.md`; changed since the base HEAD and after the
  session started) without touching the overview or the root `index.md`, the agent is asked to check
  that they still describe the project, or to say in one line that they do; it is also asked to link
  from the index of their folder the concepts it changed that no `index.md` links to. Once per set of
  findings, at most 3 per session, and never when `stop_hook_active` is set (it comes at the next
  ordinary stop): changing a concept to answer the upkeep reminder must not chain a second block.
  While the validator reports errors, it waits for them to be fixed. Bundle files `ai1 worktree
  finish` brought in after its OKF checks, and untouched since (`knowledge_checked` in the
  [worktrees](worktrees.md) integration record), are not this session's: until 2026-11-09 (fixed after v0.25.0)
  every finish that brought concepts got this reminder, and its test passed only when the run took
  under a second (it moved the bundle's dates a second back; found by an intermittent full-suite failure).
  That exclusion applies to the concepts, not to the review: since 2026-11-16 an overview or root
  `index.md` that changed during the session counts as reviewed also when it came in through `ai1
  worktree finish`; before, a session that worked in worktrees was asked to review an overview it had
  already updated.
- **Rules given to the agent:** update the concept and `generated: { by: claude-code/<model>, at }`
  with the real current UTC time; `log.md` only for lifecycle events; validate with `/ai1:okf-validate-bundle`
  and fix errors. On a v0.1 bundle: legacy warnings are expected, the agent must not migrate the
  bundle, and in each concept it edits it replaces `timestamp` with `generated`.
  What deserves a concept is one shared sentence (`WORTH_A_CONCEPT_RULE` in `src/okf/okf-bundle.mjs`,
  also in the catch-up brief): behaviour, APIs, data and rules, even when no concept covers them yet;
  tests, formatting and renames alone are not. The upkeep reminder also says how many of the changed
  files no concept describes, and lets the agent finish without writing only when the change adds no
  such knowledge. Until 2026-11-17 it closed with "if nothing documented is affected, say so and
  finish": in a real repo the agent added a link to a map service and a new modal, answered "nothing to
  update, no concept talks about them" and left the feature undocumented.
- **Field test (2026-10-31, copy of a real v0.1 bundle):** after a code change the agent updated the
  right concept and left `log.md` alone, but kept `timestamp` next to `generated`, invented the time
  and skipped `/ai1:okf-validate-bundle`. The first two led to the stricter rules above; the third to the
  validation gate. Verified in a real session: an agent wrote a concept without `type`, the hook
  blocked with the error, the agent fixed it.

# Project context: interview, requirements, open questions (since 2026-11-21)

Asked by the person on 2026-11-21: the agent has to understand each project, ask what is not clear and
write it down; requirements defined at kickoff are updated and consulted as the project advances
("algo así como la skill de goal"). Prior art in
[prior art](../decisions/prior-art.md#project-kickoff-clarification-and-living-requirements-2026-11-21)
and [Claude Code /goal](../decisions/prior-art.md#claude-code-goal-2026-11-21). Part of okf, not a feature
of its own: it reads and writes only the bundle and reaches the agent through the okf hooks.

- **Where it lives** (ai1 conventions on top of OKF, which demands only `type`):
  `product.md` (`type: Product`, shared with the [design feature](design.md); an existing Product
  concept elsewhere is reused) with one `## <heading>` per category; `requirements/R<nnn>-<slug>.md`
  (`type: Requirement`, `state: active | validated | out-of-scope | superseded` because `status` is
  reserved by OKF §5.4, `priority: must | should`, `check`, optional `check_command`, `validated_by`,
  `superseded_by`, a `# History` quoting the person with dates);
  `requirements/questions.md` (`type: OpenQuestions`, `## Q<nn>: <question>` open | assumed | answered,
  with `about: <category>`); `requirements/index.md` generated. Out of scope has one store: requirements
  in state `out-of-scope`.
- **Gap map** (`ai1 okf project gaps`, no model): categories purpose, users, scope, constraints, stack,
  technical-vision, run-test, deploy, operations, stack-pieces, integrations-data, decision-makers. Clear when its Product section has text (scope
  also by any out-of-scope requirement, run-test also by `verify` commands), partial on `TBD`/`TODO` or a
  pending question about it, missing otherwise.
- **Operations (2026-11-22)**: `operations.md` (`type: Operations`, an existing one elsewhere is
  reused), written by `init` (idempotent: run again, it adds only what is missing), one `## <heading>`
  per topic - Deploy, Environments, Logs, Database, Access, Monitoring, Alerts - each left with an HTML
  comment hint, the exact command or place, secrets only as where they live. The `operations` category
  is missing while every topic is empty, partial naming the empty or placeholder ones (or a pending
  question `about: operations`), clear when all have text ("none" counts); its Deploy also answers
  `deploy`, and a `## Deploy` in product.md still does. The interview infers it from production when it
  can reach it read-only and leaves what the project lacks (monitoring, alerts, backups) as open
  questions with a recommendation; how to query the person's own tools comes from their customization
  or their own plugin, never from ai1 ([decision](../decisions/project-operations.md)).
- **Stack (2026-11-22)**: the pieces a person always uses, each with `area`, `applies`, `setup`,
  `check` (`## <id>: <title>` and one `- field: value` line each, the bullets right under the heading).
  Three sources: the person (`~/.config/ai1/stack.md`, `$XDG_CONFIG_HOME` respected), every enabled
  plugin (`ai1/stack.md` inside it, found as in [plugin customizations](../architecture/skill-customization.md#customizations-shipped-by-a-plugin-since-2026-11-22)),
  and the project (`stack.md`, `type: Stack`, linked from `index.md`, each piece with `state:
  integrated | pending | none` and a `note`). The catalog is person + plugins, one per id (the person's
  wins, then plugins by id; `catalog` names the hidden one). Written only by `ai1 okf stack catalog|list|
  add --scope user|project|adopt|set` (`src/okf/okf-stack.mjs`): only the touched piece's lines change;
  `none` needs `--note`; `set` of a piece not in the project fails; `adopt` skips one already there.
  Gap category `stack-pieces` (apart from `stack`, the language and structure): missing with a catalog
  and no project stack, partial naming pending pieces, clear otherwise; it does not start the project
  context by itself. The person's stack is written with `ai1 okf stack add --scope user` (the
  interview offers it when they keep naming the same pieces; `/ai1:okf-define-stack` was removed the same
  day: a list of a few lines did not earn a skill loaded in every session);
  the interview offers the catalog pieces a project lacks as a multi-select by area (at most 4 per
  question, pre-selected by `applies`), adopts the chosen and records the rest as `none`; without a
  catalog it asks as before. `integrated` only after the piece's `check` passed. Tests:
  `test/okf-stack.test.mjs`. Decision: [stack](../decisions/stack.md).
- **`ai1 okf project`**: `init` (Product skeleton, index, questions file, links in the root index),
  `gaps`, `req add|set|command|list|goal` (goal prints a `/goal` line from the requirement's `check`;
  `req add --supersedes <id>` replaces a requirement, which stays as `superseded` by the new one),
  `verify [<id>]` (runs every active or validated requirement's `check_command`; a validated one that
  fails goes back to active, a passing active one is never validated by it; exit 1 on any failure),
  `question add|assume|answer|list`, `conflicts <plan>` (out-of-scope requirements whose title words
  appear in a plan; advisory). Numbering, states, history and the index are written only by it.
- **Requirement vs concept (2026-11-21):** a requirement says what the project must achieve and why
  (changing it needs the person's decision); how it is built lives in the other concepts. Tens per
  project, not hundreds. Requirements change only from the person's words, never from what the code
  does: a message that contradicts one is confirmed in one line, then recorded (a nuance with
  `req set`, a different requirement with `req add --supersedes`). In the skill and in the session
  start rule.
- **okf-project (SessionStart):** silent until the project context is started (a requirement, or a
  Product concept marked `project_context: true` by `ai1 okf project init`; the design feature's
  Product concept alone does not start it): the session start has no room to spare in the worst case
  (`test/session-start-budget.test.mjs`). Then: ask before guessing what neither code nor bundle
  answers; the gaps in one line pointing to the interview; the requirement-change rule; up to 2
  out-of-scope items, 2 pending questions and 3 active must requirements, each list saying how many it
  left out.
- **/ai1:okf-interview-project:** infer from the repo, show a draft, then ask one question at a time
  (open first, ranked by impact x uncertainty, at most 5 per sitting, each with a recommended answer,
  multi-select for scope); answers written where they belong at once; the rest stays as open questions.
  Routes: core-setup-repo offers it when purpose or scope is missing; the session-start gaps line names it.
  Since issue #11 (2026-11-22) the inference also reads the project's documents outside the repo
  (brief, quote, client spreadsheets, specs, notes): folders named in the skill's customization (the
  project's, or the person's default per project), links in README, CLAUDE.md or the bundle, and
  `related` repositories; it cites them with `--from "<document>"`, says which it read and asks once for
  more before the first question, and offers to save a new folder with /ai1:core-customize-skill.
  Ruled out: guessing synced-drive folders (host-specific, see
  [host tooling](../decisions/host-tooling-out-of-plugin.md)), a `docs_paths` config field (the
  customization already holds it) and a gaps line for it (gaps reads only the bundle).
- **Plans:** the deep design lists `requirements: [R001, ...]` and runs `conflicts`; `ai1 plan-done`
  validates the listed ones in the bundle of the checkout it closes, each only when its
  `check_command` (if any) passes (missing, out-of-scope, superseded ids or a failing check are only
  reported, never a reason not to close).
- **Requirements over time (2026-11-21, plan `requirements-lifecycle`):**
  - *Switch:* `"modules": { "okf-project": false }` turns off everything about requirements in a repo
    (session-start lines, the prompt and edit hints below, the review task, plan-done notes, the setup
    offer); okf keeps working and `ai1 okf project` still runs by hand, saying the module is off. A no
    to the setup offer writes it with `ai1 init --disable-modules okf-project`.
  - *Milestones and review:* `milestone: <name>` (`req add --milestone`, `req milestone <id> <name>`);
    `ai1 okf project review [--milestone]` lists per milestone validated, still to build, out of scope
    with the reason of its last history line, superseded, and in force without a check command;
    `review --done` stamps one `requirements_reviewed` date on the Product concept. The judgement is the
    skill's review mode.
  - *satisfies:* a concept's `satisfies: [R004]`; okf-file-context, on an edit of a file that concept
    describes, asks once per requirement and session to run `ai1 okf project verify R004` (only for
    requirements in force with a check command); `req list` shows the satisfying concepts.
    `review` and `gaps` report the coverage (`checkSatisfiesLinks`, report only): validated
    requirements no concept satisfies, and links to requirements missing, out of scope or superseded.
    Ruling (2026-11-22): links stay selective (only concepts that build what a requirement asks) and
    nothing asks to add them yet; a `plan-done` suggestion and a line in /ai1:okf-maintain-knowledge
    wait for real use, decided by what this report shows in a real project.
  - *Messages:* okf-recall scores every Requirement concept on its own: at least two title keywords (all
    when fewer) shared with the message. In force plus a change cue (es/en word list in
    `src/okf/okf-recall.mjs`) adds "may change R003: confirm in one line"; out of scope, matched at all,
    adds "R001 is out of scope: tell the person". Words, no translation: a requirement matches messages
    in its own language, so the interview writes them in the person's language.
  - *Periodic review:* maintenance task `requirements-review` (see [maintenance](maintenance.md)).
- **Technical vision (2026-11-22):** asked by the person ("¿tendría sentido preguntarme a mí como
  desarrollador? cómo me imagino esta aplicación montada, con qué librerías ya existentes, cómo
  integrarla"). Who says it decides where it goes: what the client imposes (their SAP, their servers)
  is a requirement or a Product constraint; the developer's picture (architecture, libraries and
  services to reuse, integration, what to avoid, non-functional targets) is a decision, not a
  requirement, so changing it never asks for a requirement change. Decisions live in
  `decisions/<slug>.md` (`type: Decision`, tag `technical-vision`, `decision_state: proposed | accepted
  | replaced`, `decided_from`, `avoid: [...]`, `replaced_by`; body with why, alternatives considered,
  avoid and a dated history), written only by `ai1 okf project decision add|set|list`, listed in
  `requirements/index.md`. Gap category `technical-vision`: clear with a decision not replaced or a
  `## Technical vision` section. `conflicts` also reports a plan naming an `avoid` term (whole words,
  decisions not replaced). `--from <who>` on requirement and decision history tells a client's word
  from a developer's. The interview has two blocks (product, technical vision) and for the vision it
  proposes options (repo, the person's other projects and defaults, a web search) with a
  recommendation instead of only asking; the person's usual stack and what they avoid are customization
  hints of the skill.
- **Not built (ruling):** per-milestone review dates; satisfies checked at Stop (it is only a hint on
  edit); per-project custom categories (a
  customization of the skill can add questions); numbering across parallel worktrees (two worktrees
  adding requirements can collide, as later entries can).

# Limits

- Upkeep is triggered by changed files, memories, edits undone in the session or a long investigation. A decision taken only
  in the conversation, with none of those, is not detected: recording it is up to the agent.
- Reading is suggested, not enforced: okf-file-context names the concept of each file the agent
  reads or edits, but nothing stops an edit without opening it. Files no concept cites get nothing,
  and okf-recall only finds concepts that share words with the message.
- okf-recall runs on the person's messages only; subagents get okf-file-context pointers for the
  files they read.
- Catch-up sees merge commits only: a squash merge (one new commit on a branch that has the bundle) or
  a branch rebased onto one that has it leaves no joining merge, so its changes are not detected.

# Skills and agents

From the [OKF toolkit](../packs/okf-pack.md): `/ai1:okf-maintain-knowledge`, `/ai1:okf-validate-bundle`, `/ai1:okf-visualize-bundle`, whose
scripts are the `ai1 okf validate`, `ai1 okf init` (`--no-starter`: index and log only, for a
producer about to write the real concepts) and `ai1 okf visualize` commands. Written in ai1:
`/ai1:okf-tidy-claude-md` (see okf-claude-md above) and `/ai1:okf-interview-project` (see project context above). The backfill skill and its two agents were
removed on 2026-11-15 (never used; a light history step, now in the skill's `reference/sources.md`, replaces it).

# Coexistence with a standalone OKF setup

A machine may already have a standalone `okf@...` plugin and a global OKF guard hook. In a repo set
up with `ai1 init` and `okf` on, the standalone plugin is disabled in the personal
`.claude/settings.local.json` (no duplicate skills, nothing committed), and a guard hook should skip repos that have `.ai1/config.json`. Verified in
a real session on 2026-10-31: only `ai1:*` skills listed, a single upkeep reminder.

# State

`${CLAUDE_PLUGIN_DATA}/state` (else `~/.cache/ai1`), files `<session>-<hash(project)>.base` and
`.reminded`, removed after 7 days.

# Related repositories

Other repositories whose knowledge this one needs are listed in `related` of `.ai1/config.json`
(structured and validated, `src/core/related-config.mjs`; never parsed from prose: the person rejected
matching headings or names in `index.md`, 2026-11-15). Code in `src/okf/okf-related.mjs`.

- **Session start** (`okf-index`): each entry with where its knowledge is on this machine (its bundle
  index, or `read_without_clone`, or "not found at <path>") and what it owns; the agent reads the
  relevant one before changing what depends on it.
- **While working** (`okf-file-context`): a read or edit of a file of another repository (not a
  submodule, inside or outside the project folder) whose bundle exists (`bundle`, else `.ai1/okf`, else
  `.okf`) gets one line per repository and session: its bundle; and, when it is not in `related`
  (compared by main checkout, or `origin` against `remote`), the offer to relate it after the person's yes.
- **Setup** (`ai1 status` -> `relatedCandidates`, offered by `/ai1:core-setup-repo`): git repositories
  next to this one that `CLAUDE.md`, `README.md`, `PROJECT.md` or the bundle name **as a repository**
  (a code span of its own, `../name`, `[name]`, or a compound name with - or _ anywhere), and remote URLs
  with this repo's owner; at most 10, shaped as entries. A bare word does not count (it matched ordinary
  words such as "agents" on 2026-11-15).
- The rule written with it: each fact lives in the repository that changes it; the other only links.
