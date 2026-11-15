---
name: okf-maintain-knowledge
description: >-
  OKF — Author, maintain, and consume Open Knowledge Format (OKF) knowledge bundles. Use when
  capturing project knowledge (services, APIs, schemas, decisions) into an OKF bundle, when
  updating one after code or docs change, or when a repository's OKF bundle should inform the
  task. Triggers on: "document this in OKF", "update the knowledge bundle",
  "capture this as a concept", or any work in a repo that has an OKF bundle.
user-invocable: true
argument-hint: "[produce|maintain|consume] [path]"
allowed-tools: Read Write Edit Grep Glob Bash Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Open Knowledge Format (OKF) skill

OKF represents knowledge as a directory of markdown files with YAML frontmatter.
It is minimal by design: no schema registry, no runtime, no SDK. Your job is to
produce, maintain, and consume OKF bundles **conformant with the spec**, not your
memory of it.

**Read the canonical spec before non-trivial work:**
[reference/SPEC.md](reference/SPEC.md). It is the verbatim OKF v0.2 specification
and the source of truth for every rule below. It is long (~1,000 lines): for
producing or maintaining concepts read §3–§9 (structure, frontmatter,
provenance, trust, lifecycle, links, index, log); §10 only for an Attested
Computation; §12–§13 and Appendix A only for versioning or a v0.1 bundle.

## The one hard rule

A bundle is conformant (§11) iff: every non-reserved `.md` file has a parseable
YAML frontmatter block, and every such block has a **non-empty `type`** field.
Everything else is soft guidance. Consumers MUST tolerate missing optional
fields, unknown types, and broken links — never reject a bundle over them.

## Conventions to apply

- **One concept = one file.** The file path (minus `.md`) is the concept ID.
- **Frontmatter:** `type` is required. Add `title`, `description`, `tags` when
  they aid consumption; add `resource` (a canonical URI) only for concepts bound
  to a real asset — omit it for abstract concepts.
- **Body:** prefer structural markdown (headings, tables, lists, fenced code).
  Conventional headings: `# Schema`, `# Examples`, `# Computation`.
- **Cross-links:** standard markdown links; prefer absolute bundle-relative
  form (`/services/auth-api.md`). A link asserts a relationship; its *kind* lives
  in the surrounding prose, not the link.
- **Reserved files:** `index.md` (directory listing, no frontmatter, except the
  bundle-root index, which may carry `okf_version` and this plugin's
  `upkeep: enforced` opt-in flag, plus `recursive: true` (or a depth `n`: levels below the root, `true` is 6) to make the hook
  watch nested git repos) and `log.md` (ISO-dated history, newest
  first). Never use these names for concepts.
- **Related repositories:** when this repo depends on the knowledge of another one (a contract it
  consumes, a schema another repo owns), record it in `related` of `.ai1/config.json`, not in prose:
  `{ "name", "path" (where it is usually cloned, e.g. `../other`) and/or "remote" (`owner/name`),
  "branch", "bundle" (default `.ai1/okf`, else `.okf`), "read_without_clone" (a command that prints its
  bundle `index.md` when it is not cloned here, whatever works for that repo), "owns" (what it owns that
  this repo uses) }`. Each fact lives in the repository that changes it; this repo's concepts only link
  to it, never copy it. ai1 lists `related` at session start and points to that bundle when the agent
  reads the other repo. Add an entry only after the person's yes (ai1 offers it when it notices the
  other repo; `config-guard` asks before the file changes).
- **What goes in `log.md`:** lifecycle events only, written in the bundle-root
  `log.md`: a bundle **created**, a concept **deprecated** or retired, one
  concept **superseding** another, concepts **regenerated** after their source
  changed, a **verification** pass. Routine edits to a concept do not get an
  entry: its `generated` and git already record them. A log is append-only, so
  never rewrite or drop an existing entry.

## The v0.2 families (all optional, all worth filling)

- **Trust (§5.2):** `generated: { by, at }` — who produced the current content
  and when. `verified: [{ by, at }]` — who confirmed it since (a bare mapping is
  one entry). Write `by` in the **actor convention** (§7): `<producer>/<version>`
  for an agent, `human:<id>` for a person, `process:<id>` for an automated job.
  Use `human:` whenever a person authored or signed off — consumers key trust
  tiers off that prefix. In Claude Code the agent writes `claude-code/<model id>`
  (e.g. `claude-code/claude-opus-5-5`), with the real UTC time from
  `date -u +%Y-%m-%dT%H:%M:%SZ` in `at`.
- **Lifecycle (§5.4–5.5):** `status: draft|stable|deprecated` (absent means
  stable) and `stale_after`, an absolute ISO 8601 datetime (a bare date is
  tolerated), not a TTL.
- **Provenance (§5.1):** `sources: [{ id, resource, title, author,
  usage_count, last_modified }]` plus a `usage_window: { from, to }` sibling of
  `sources` framing every `usage_count` (an entry may carry its own to override
  it); a `usage_count` without a window warns. `resource` is required per entry
  and may be a URL, a bundle path, or a scope descriptor. Attribute a specific
  claim with a markdown footnote whose label is the source's `id`:
  `…sharded daily.[^ga4-schema]` plus a `[^ga4-schema]: …` definition. The label
  is the join key, it must match a `sources[].id`.
- **Attestation (§10):** a sanctioned computation is its own concept,
  `type: Attested Computation`, carrying `runtime` (required), `parameters`,
  `executor`, `attester`, and the computation itself under `# Computation` (or a
  `computation:` path). Concepts that need the value link to it. Never inline a
  number's SQL into the concept that narrates it.

**Reading a v0.1 bundle?** Two constructs were superseded (§13.1): `timestamp`
is now `generated.at`, and a body `# Citations` list is now `sources`. Read both,
write v0.2 — and when you touch a legacy concept in **maintain** mode, migrate
its frontmatter as part of the edit. The validator warns on both.

Templates to copy: [concept](templates/concept.md), [index](templates/index.md),
[log](templates/log.md).

## Default bundle location

Use `.okf/` at the repository root unless the project already uses another
location or a harness names one for the session (for example `.ai1/okf/`). Commit it alongside the code it describes — knowledge as code.

## Modes

### produce — create or extend a bundle

**First, the right session.** Build a bundle from a session started in the
repository that owns it: its hooks, rules and customizations only apply there.
If the bundle belongs to another repository with ai1, do not write it from here:
delegate it with `/ai1:session-delegate-change`.

**Starting a brand-new bundle?** Use the init fast-path instead of hand-writing
the first files. When you are about to write the real concepts, pass
`--no-starter`: it writes only `index.md` and a `log.md` whose Creation entry
links to the index (without it you also get a `getting-started.md` placeholder
in English, which you would delete, leaving the append-only log pointing to a
missing file):

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" okf init <target-dir> --no-starter [--title "..."]
```

It refuses to touch a directory that already has `.md` files unless `--force`
is given. Translate the index heading and the log line to the language of the
repo's docs, and write every concept in that language too. Until the bundle is
first committed, its log can still be adjusted. Then extend it:

0. **Read the revision that runs.** For each repository or submodule you will
   read: `git fetch` and `git log --oneline HEAD..origin/<deployed branch>`. If the
   checkout is behind, ask the person to update it, or read that branch
   (`git archive origin/<branch> | tar -x -C <tmp dir>`); write the revision you
   read in the concept. A checkout months behind documents a system that no
   longer exists.
1. Read [reference/SPEC.md](reference/SPEC.md) (§3–§9).
2. Pick the source(s): **code** (derive concepts from source, READMEs,
   docstrings, config), **docs/wiki** (distill pages into concepts, record the
   originals in `sources`), **live systems** (a deploy panel's API, a database
   catalog, a server: cite them in `sources` as a scope descriptor with the date
   you read them, and give the concept a `stale_after`, since that state drifts
   without any commit), **manual** (decisions, playbooks, metrics), and for a
   new bundle in a repo with history, **git history** for the *why* the code no
   longer shows (only when creating the bundle or when asked; keep it light):
   - Read `git log --oneline --no-merges` whole, then open at most ~20 commits with
     `git show --stat <sha>` (and the diff of the few that need it): the largest
     ones, those touching dependencies, configuration or the architecture, and
     those whose message says why, instead, replace, drop or revert.
   - Write a `decisions/` concept only for a choice with a clear reason in the
     commit (or its PR); cite the commit in `sources` (`resource: git:<sha>`).
     Never invent a reason the history does not give, and skip routine changes.
   - **A doc is a claim, not a fact.** READMEs, CLAUDE.md files and wikis go
     stale: check each claim against the code (or the live system) before you
     write it; leave out, or mark as not verified, what you cannot check; and
     list the discrepancies you found for the person (they are candidates for
     `/ai1:okf-tidy-claude-md`).
   - **Secrets in a source:** never copy one. Write where it lives (secret
     manager item, deploy environment variable), and tell the person in your
     summary which committed files hold a secret in clear text:
     `ai1 okf scan-secrets <paths you cite>` lists them (`file:line`, never the value).
   - **The project's MCP servers** (their code, and their read-only tools) say
     how the team really operates the system: which tables, keys, containers and
     checks. Contrast the operations, data and monitoring concepts with them; use
     their read-only tools as live checks. If one does not start, read its code
     and say so.
   - **A live database:** say first, in one line, where you connect and with what
     limits. Catalog only (`information_schema`, `pg_catalog`), in a read-only
     transaction with a statement timeout; never read data tables. Document a
     map by domain (not table by table), the relations that are really declared,
     partitioning, and dead or frozen tables. Statistics are cumulative and may
     have been reset: "0 writes" means "none since the counters start", and a
     table that is not written may still be read.
   - **An incident found while documenting** (a service that does not answer, a
     risky query in the code): write it as observed state with the date and a
     short `stale_after`, list it for the person, and do not fix it.
3. Choose a directory layout by domain (e.g. `services/`, `datasets/`,
   `decisions/`). One concept per file. A large project built in phases (one
   area at a time, each reviewed): fix the whole layout up front, list in the
   indexes only the concepts already written (a short "pending" note in the root
   index says what comes later), link forward only where it carries meaning, and
   keep the plan of the remaining areas in a work file, not in the bundle.
   **A large area** (tens of thousands of lines): split the reading across
   subagents, each with a brief (revision to read, questions, paths, "never copy
   secrets", claims of the docs to verify, reads inside the repository). Their
   reports sound equally sure when wrong: check 3–5 claims of each in the code
   before writing them.
4. Write each concept from [templates/concept.md](templates/concept.md): set a
   descriptive `type`, fill recommended fields, record `generated` and the
   `sources` you actually read, cross-link related concepts. Cite the code it
   describes (see *Citing code* below).
5. Add/refresh `index.md` per directory (and `okf_version: "0.2"` in the root
   index). A new bundle gets a dated **Creation** entry in `log.md`. Extending
   an existing one does not.
6. Validate (see below). Fix every error before finishing. Where the `ai1` CLI
   is available, check that the code you cited links back: from the project root,
   `ai1 okf file-map <file>...` prints the concept ai1 names for each file
   (exit 1 when one has none). Run it on the files you cited **and** on a few
   undescribed files next to them (a folder cited in a body claims all its
   files), and resolve the ties it warns about.
7. A new bundle, where the `ai1` CLI is on the PATH: run `ai1 claude-md`. If it reports findings,
   offer `/ai1:okf-tidy-claude-md` in one line (CLAUDE.md now repeats or should move into the
   bundle); do not tidy without a yes. A `secret-in-claude-md` finding is never moved: tell the person
   (clean it from CLAUDE.md, rotate it).

#### Citing code

ai1 tells the agent which concept describes a file when it opens or edits it,
from the paths each concept cites:

- Where: `resource` (strongest), then `sources[].resource`, then paths in
  backticks in the body (weakest). A file beats a folder. Paths inside fenced
  blocks are ignored; a folder in the body needs two segments (`src/core/`).
- Form: a bare path (`src/core/config.mjs`) is read **from the repository root**
  (an ai1 convention: the spec would read it from the concept); a leading `/` is
  the bundle root. In a repo with submodules, cite from the root that holds the
  bundle (`svc/lib/db.py`).
- The rule that follows: a **specific** concept puts its own files in `resource`
  or `sources`; a **broad** one (overview, operations) cites big folders only in
  its body. A broad concept with `src/` in `sources` would win over every
  specific concept that cites a file of `src/` only in its body.
- A concept of a service or worker puts its entry file in `resource`: it then
  beats every concept that only cites that file in `sources`.
- A file that only **proves** a claim (an MCP server's code used as evidence)
  goes in `sources` with `role: evidence`: it supports the claim without the
  concept claiming the file. A path in backticks in the body always claims it.

### maintain — keep a bundle in sync with reality
Before reading code to correct a concept, check its revision as in produce step 0.

1. Identify which concepts the change affects (search by `resource`, path, or
   topic). This bookkeeping is exactly what agents are good at — touch every
   affected file in one pass.
2. Update the body and `generated.at` (with your own actor in `generated.by`);
   fix or add cross-links; create new concepts for new assets; mark removed
   assets `status: deprecated` and note the deprecation in `log.md` rather than
   silently deleting context. Facing a whole v0.1 bundle rather than a stray
   field? Do not hand-edit it — run the validator's `--migrate` once.
3. Update the relevant `index.md` files. Append a dated `log.md` entry only if
   the change is a lifecycle event (see *What goes in `log.md`*).
4. Validate.

### consume — use a bundle as context
1. Read the bundle-root `index.md` first for progressive disclosure, then follow
   links only into the concepts relevant to the task.
2. Weigh what you read: `status: draft`/`deprecated`, a `stale_after` already
   past, or no `verified` entry all mean "check before relying on this". Treat
   broken links as not-yet-written knowledge, not errors.
3. Need a number an `Attested Computation` covers? Run *its* computation with
   values bound to the declared `parameters` — never write your own query.
4. If you learn something durable while working, switch to **maintain** and
   write it back.

## Validation (do this before declaring done)

Never eyeball conformance — run the deterministic checker. Invoke the companion
**`okf-validate-bundle`** skill (`/ai1:okf-validate-bundle <bundle-dir> --strict`), or run the
checker directly:

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" okf validate <bundle-dir> --strict
```

Resolve every `ERROR` (hard §11 failures). Under `--strict` warnings also fail
the run (exit 1), so clear them too; drop `--strict` (or use `--max-warnings N`)
if you only want §11 conformance gated.

## Fixed rules

- Every concept file has a YAML frontmatter block with a non-empty `type` (the one hard rule).
- Validate with /ai1:okf-validate-bundle before declaring done and resolve every ERROR.
- No secrets in the bundle.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-maintain-knowledge` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-maintain-knowledge`
