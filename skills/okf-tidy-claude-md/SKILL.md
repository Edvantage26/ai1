---
name: okf-tidy-claude-md
description: >-
  OKF — Tidy the repo's CLAUDE.md against its OKF bundle: find the knowledge piled up in CLAUDE.md
  (architecture, setup, decisions, references that no longer exist), propose a short CLAUDE.md that
  keeps only what the agent needs every session plus a pointer to the bundle, and move the rest into
  concepts - after the person approves. Use when a session says "CLAUDE.md drifts from the bundle",
  or the person says "ordena/refactoriza el CLAUDE.md", "pasa el CLAUDE.md al okf", "el CLAUDE.md
  está desfasado", "tidy CLAUDE.md", "move CLAUDE.md into the bundle".
user-invocable: true
argument-hint: "[path/to/CLAUDE.md]"
allowed-tools: Bash(ai1 skill-context *)
---

# Tidy CLAUDE.md into the bundle

CLAUDE.md is loaded whole in every session; the bundle (`.ai1/okf/`) is read on demand. Knowledge
that lives in CLAUDE.md costs tokens every time and drifts from the concepts. The goal: a CLAUDE.md
the agent needs in every session, and everything else in the bundle, said once.

## 1. Get the facts (cheap)

Run `ai1 claude-md --json`. It lists, per CLAUDE.md of the repo, deterministic findings:
`too-long`, `duplicates-concept` (section lines + concept), `knowledge-without-concept` (long section,
no concept), `stale-reference` (path or link that no longer exists, e.g. an old `.okf/` bundle path
after the move to `.ai1/okf/`). If the person named one file, work on that one only; otherwise one
proposal per CLAUDE.md with findings, the root one first. Read `.ai1/okf/index.md`, then only the
flagged sections and the concepts they would go to: do not read the whole bundle.

## 2. Classify every section

| Keep in CLAUDE.md | Move to the bundle |
|---|---|
| what the repo is, in 2-3 lines | architecture, modules, data flows |
| rules the agent must follow on every task (MUST / NEVER) | why a decision was taken, history, incidents |
| the commands to build, test and verify | setup details, env vars, endpoints, credentials *locations* |
| the pointer to `.ai1/okf/index.md` | anything a concept already says |

The findings are hints, not verdicts: a short rule section that cites a file stays; a section the
check missed can still move. A rule whose *explanation* is long stays as one line in CLAUDE.md and
its explanation goes to a decision concept, linked from that line.

For each `duplicates-concept`, compare the section with the concept. When they **contradict**, do
not pick a side: check the code (or `git log`) for which is true, and if the code does not tell,
list it for the person to decide. For each `stale-reference`, find the current path (`git log
--follow`, a search) or mark the line for removal.

## 3. Propose, do not apply

Show the person, in one message:

- the new CLAUDE.md in full (aim for under ~40 lines of at most ~100 characters);
- per moved section: the concept it goes to (update `x.md` / new concept `y.md`) and exactly what is
  added. Read (or grep) each destination concept first, so you say "already there" or "add X", never
  "check later";
- contradictions found and how you propose to resolve each;
- stale references: fixed path or removed.

Nothing is written until the person says yes (or asks for changes: then propose again). Never drop
content: every line that leaves CLAUDE.md lands in a concept, or is listed as removed with a reason
(stale, duplicated word for word).

## 4. Apply

1. Update or create the concepts first (follow /ai1:okf-maintain-knowledge: frontmatter with `type`,
   `generated: { by: claude-code/<model>, at: <date -u +%Y-%m-%dT%H:%M:%SZ> }`, cross-links, index
   entry for new concepts). Add `resource`/`sources` paths where a concept describes code: that is
   how ai1 points the agent to it when the file is touched.
2. Then write the new CLAUDE.md.
3. Validate with /ai1:okf-validate-bundle and fix every error.
4. Run `ai1 claude-md` again and report what is left and why (a finding the person chose to keep).

## Fixed rules

- Nothing is written until the person approves the proposal.
- Never drop content: every line that leaves CLAUDE.md lands in a concept or is listed as removed with a reason.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `ai1 skill-context okf-tidy-claude-md` and apply what it prints.

!`ai1 skill-context okf-tidy-claude-md`
