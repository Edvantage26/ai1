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
- **Related repositories:** when this repo depends on the knowledge of another
  one, record it in `related` of `.ai1/config.json` (`name`, `path` and/or
  `remote`, `branch`, `bundle`, `read_without_clone`, `owns`), after the person's
  yes, not in prose. Each fact lives in the repository that changes it; link to
  it, never copy it.
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

Build a bundle from a session started in the repository that owns it (its hooks
and rules only apply there); for another repository with ai1, delegate it with
`/ai1:session-delegate-change`.

**Starting a brand-new bundle?** Use the init fast-path instead of hand-writing
the first files. Pass `--no-starter` when you are about to write the real
concepts (it writes only `index.md` and `log.md`, without a placeholder concept):

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" okf init <target-dir> --no-starter [--title "..."]
```

It refuses to touch a directory that already has `.md` files unless `--force`
is given. Write the bundle in the language of the repo's docs. Then extend it:

1. Read [reference/SPEC.md](reference/SPEC.md) (§3–§9).
2. **Read the revision that runs.** For each repository or submodule you will
   read: `git fetch` and `git log --oneline HEAD..origin/<deployed branch>`. If
   the checkout is behind, ask the person to update it or read that branch, and
   write the revision you read in the concept.
3. Pick the source(s): **code** (derive concepts from source, READMEs,
   docstrings, config), **docs/wiki** (distill pages into concepts, record the
   originals in `sources`), **manual** (decisions, playbooks, metrics). Git
   history, the project's MCP servers, a live database or service, or a lot of
   code to read at once: read [reference/sources.md](reference/sources.md) first.
   - **A doc is a claim, not a fact.** Check what READMEs, CLAUDE.md files and
     wikis say against the code before you write it; leave out, or mark as not
     verified, what you cannot check.
   - **Secrets:** never copy one; write where it lives, never the value.
   - **An incident found while documenting** (a service that does not answer, a
     risky query): write it as observed state with the date and list it for the
     person; do not fix it. A security one is told as soon as it is confirmed.
4. Choose a directory layout by domain (e.g. `services/`, `datasets/`,
   `decisions/`). One concept per file. Value what the code does not say (why,
   conventions, how the live system behaves) over describing what the code does.
5. Write each concept from [templates/concept.md](templates/concept.md): set a
   descriptive `type`, fill recommended fields, record `generated` and the
   `sources` you actually read, cross-link related concepts. Cite the code it
   describes (see *Citing code*).
   - **Decisions:** write a `decisions/` concept only for a choice with a known
     why: written (commit `git:<sha>`, doc, docstring; cite the original, never a
     concept of this bundle) or told by a person (`resource: human:<id>` with the
     date, their words quoted, the technical facts that come with it checked in
     the code). Never invent a why. When the person does not know it, investigate
     (history, config, the live system) and write either a decision with that
     evidence or one marked pending review with its costs and an alternative.
     Link each decision from the concepts of its area.
6. Add/refresh `index.md` per directory (and `okf_version: "0.2"` in the root
   index). A new bundle gets a dated **Creation** entry in `log.md`. Extending
   an existing one does not.
7. Validate (see below). Fix every error before finishing. Then, from the
   project root, `"${CLAUDE_PLUGIN_DATA}/bin/ai1" okf file-map <file>...` on the
   files you cited: it prints the concept ai1 names for each (exit 1 when one has
   none).
8. A new bundle: run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" claude-md`; if it reports
   findings, offer `/ai1:okf-tidy-claude-md` in one line, without tidying before
   a yes.

#### Citing code

ai1 names the concept that describes a file when the agent opens or edits it,
from the paths each concept cites:

- Where: `resource` (strongest), then `sources[].resource`, then paths in
  backticks in the body. A file beats a folder; paths in fenced blocks are
  ignored.
- Form: a bare path (`src/core/config.mjs`) is read from the repository root (an
  ai1 convention); a leading `/` is the bundle root.
- A **specific** concept puts its own files in `resource` or `sources`; a
  **broad** one (overview, operations) names big folders only in its body. A
  service or worker puts its entry file in `resource`.
- A file that only **proves** a claim goes in `sources` with `role: evidence`:
  it supports the claim without the concept claiming the file.

### maintain — keep a bundle in sync with reality
Before reading code to correct a concept, check its revision (produce step 2);
for sources other than the repo's code, see [reference/sources.md](reference/sources.md).

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
- No secrets in the bundle: write where a secret lives, never its value.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-maintain-knowledge` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context okf-maintain-knowledge`
