---
name: ai1-skill-design
description: Design a new skill for the ai1 plugin so it fits the others and gets offered at the right moment, or review how the existing ones fit. Only for the ai1 repo. Use when the person says "nueva skill", "crea una skill para ai1", "añade una skill al plugin", "¿esto debería ser una skill?", "revisa las skills", "repasa el encaje de las skills", "¿se pisan las skills?", "review the skills", "new ai1 skill", or before adding any folder under skills/.
---

# Design ai1 skills that fit together

A plugin skill costs context in every session of every person who installs ai1 (its description
is always listed), and it is worth nothing if the agent never loads it at the right moment. So a
new skill must earn its place, have one clear boundary with its neighbours, and a **route** by which
the agent reaches it without the person typing `/ai1:...`.

Two modes: **new** (steps 1-6) and **review** (step 7). This skill is for this repo only; the skills
it designs ship in `skills/` to everyone.

## 1. Is it a skill at all?

Take the first row that fits ([principles](../../../.ai1/okf/decisions/principles.md): mechanisms over prompts):

| What it is | Where it goes |
|---|---|
| A rule that must always hold | a hook module (guard or reminder), not a skill |
| Deterministic work (files, numbering, checks) | an `ai1 <subcommand>` in Node; a skill only says when and how to call it |
| One or two lines the agent needs every session | the feature's brief (SessionStart) |
| A procedure that needs judgement, used now and then | a skill |
| Something only the ai1 maintainers need | a project skill in `.claude/skills/` (like `ai1-retro`), never in `skills/` |

Say in one line which row and why before going on.

## 2. Map its neighbours

Build the fit map of what exists, then place the new skill on it:

```bash
node .claude/skills/ai1-skill-design/fit-map.mjs          # --json for the raw data
```

Per skill (plugin and project): description words, `allowed-tools`, whether its frontmatter is
strict YAML, its **routes** (hook, brief or CLI files in `src/`/`bin/` that name `/ai1:<skill>`), the
skills that hand over to it and the ones it hands over to. A route or hand-off is only a mention:
read the line before trusting it.

- **Triggers that collide**: list the new skill's trigger phrases next to each neighbour's. Two
  skills answering the same phrase ("hazle una skill", "no vuelvas a hacer X", "lanza otro agente")
  need an explicit boundary: a `Not for X (that is /ai1:Y)` in the description of the one that wins
  less often, and a line in the body of both.
- **Overlap in what it does**: if a neighbour already does half of it, extend that one (same feature,
  one more mode or step) instead of creating a second skill.
- **Hand-offs**: which skill comes before or after it in a real flow (storyboard -> usability review,
  later accepted -> okf, fix-loop -> debug). Each hand-off is one line in the skill that hands over,
  offered and done only after a yes.
- **Outside ai1**: Claude Code built-ins (`/code-review`, `/simplify`, `/init`) and plugins listed
  in `src/core/plugin-overlaps.mjs`. Never ship a second copy of something a common plugin does;
  point to it when installed (as the design feature does with frontend-design).

## 3. Give it a route (proactivity)

Every skill states how the agent reaches it. Pick one and write it down:

| Route | When | Example |
|---|---|---|
| A hook names it at the moment it applies | the moment is detectable from tool calls or state | `fix-loop` -> verify-debug-systematically, `storyboard-reminder` (Stop), `watch-release-detect`, `reuse-check`, `foreign-repo` refusal, `issue-offer` |
| The feature's brief names it | the moment depends on the task, the agent judges it | sizing brief -> sizing-design-before-code |
| Another skill hands over to it | it follows another flow | storyboard-record-flow -> design-review-usability |
| The description only | the person asks for it in words; nothing to detect | messages-draft-message, okf-visualize-bundle |
| Never offered, on demand only | offering it would push the agent to over-use it | later-write (decided: never offered) |

How a hook or a skill **offers** it, always the same way:

- One line, at the end of the report, with the evidence ("3 intentos fallidos seguidos: ...") and
  what it would do; never in the middle of the task, never as a question that blocks.
- Once per moment: the hook keeps state so it does not repeat in the same session (look how
  `storyboard-reminder` or `issue-offer` do it) and a no is remembered when it would come back
  (`ai1 reuse dismiss`).
- Nothing is created, sent or published without the person's yes; a yes covers what was offered,
  not more.
- Friction proportional to risk: remind only for what this session did.

A hook route means a module change (one file with its `feature`, a line in
`src/core/module-index.mjs`, its schema entry, tests, milliseconds per tool call): size that work
apart, it is not part of writing the skill.

## 4. Name, description and body

- Folder = name = `<feature>-<verb>-<object>` (`watches-follow-release`); the prefix is an existing
  feature id from `src/core/features.mjs`, or `core` / `session` (always listed). The prefix also
  decides its customization folder and whether it is hidden when the feature is off
  (`src/core/skill-visibility.mjs`).
- Description: starts with `<Feature> — `, says what it does in one sentence, then `Use when` with
  the person's own phrases in Spanish and English and the hook message that names it. No how-to: that
  is the body. Aim for about 80 words; every word is paid in every session, so more needs a reason
  (later-write keeps its long exclusion on purpose). Exclusions only for real collisions found in
  step 2.
- Frontmatter in strict YAML: a description with `: ` inside goes in quotes or as a folded `>-`
  block (Claude Code tolerates it, other parsers do not; the fit map flags it).
- Body: goal in two lines, numbered steps, the `ai1` commands it calls through
  `"${CLAUDE_PLUGIN_DATA}/bin/ai1"` or `ai1`, how to check the result, then `## Fixed rules` (what a
  customization must never change: approvals, privacy, never-by-hand files).
- Public repo: no hostnames, client names, private tooling; a person's tool goes in their
  customization ([host tooling stays out](../../../.ai1/okf/decisions/host-tooling-out-of-plugin.md)).
- Cross-platform commands ([principles](../../../.ai1/okf/decisions/principles.md)).

## 5. Wire it in

- [ ] `skills/<name>/SKILL.md`
- [ ] Its entry in `src/core/skill-customization-index.mjs`: customizable with scopes and `hints` (one line: what a project or person usually has to tell it, shown the first time it runs in a repo; then the
      `allowed-tools` line, `## Fixed rules`, `## Customization` and the `skill-context` injection
      as last line, copied from a customizable skill) or not, with the reason
- [ ] Its entry in `SKILL_ORIGIN_INDEX` of `src/core/readme-index.mjs` (projects it imports from or is based on, with links; empty: written in ai1; anything copied also in `THIRD-PARTY.md`), then `npm run readme-tables` for the Skills table of the README
- [ ] `allowed-tools` grants only the `ai1` commands it runs, never a bare `Bash`, `Write` or `Edit`
- [ ] The skill named in its feature's `description` in `src/core/features.mjs`
- [ ] Its route: the hook text, the brief line or the hand-off line in the skill before it
- [ ] The boundary lines in the neighbours found in step 2
- [ ] Its feature's row in `docs/reference.md` (and the one-line row in the README for a new feature), and the feature's OKF concept (`.ai1/okf/features/<feature>.md`)
- [ ] `npm test` (the coherence test checks the index and the customization wiring) and
      `claude plugin validate .`

## 6. Try it for real

The repo's own sessions run the published plugin, so a new skill is not loaded here until a release.
Try it with `claude --plugin-dir <worktree>` in a scratch repo (see "Dogfooding" and "To check a
release end to end" in [plugin layout](../../../.ai1/okf/architecture/plugin-layout.md)):

- say one of its trigger phrases, without naming the skill: does the agent load it?
- say a neighbour's phrase: does it stay out?
- reproduce its route (the hook moment): is it offered in one line, once?

Report what you saw, with the transcript lines.

## 7. Review mode: how the skills fit

Run the fit map of step 2 (it covers `skills/` and `.claude/skills/`), read every skill body, then
check each one:

| Check | Finding when |
|---|---|
| Route | no hook, brief or hand-off names it and it is not on-demand by design |
| Collisions | two descriptions answer the same phrase without a boundary in either |
| Hand-offs | a skill mentions another one that does not mention it back where the flow needs it |
| Duplication | two skills (or a skill and a hook brief) carry the same procedure |
| Permissions | `allowed-tools` broader than the commands the skill runs |
| Description cost | over about 80 words, how-to in it, or a trigger so broad it loads on any task |
| Shape | missing feature prefix, frontmatter not strict YAML, missing `Fixed rules` in a customizable skill, a step done by hand that a CLI command already does |
| Contradictions | a skill offers what a brief or another skill forbids (e.g. offering later, which is never offered) |
| Drift | a concept or README listing skills by hand that misses some (point to the index instead) |

Report a table: skill, finding, evidence (file:line), proposed change. Most important first:
permissions, collisions, missing routes, then cost and shape. Apply nothing without a yes; each
accepted change goes through this repo's rules (worktree, tests, the OKF concept updated).

## Fixed rules

- No new skill without its route written down and its neighbours mapped.
- A plugin skill never grants itself unrestricted tools.
- Offers are one line, once, after the work, and act only on a yes.
- What only the maintainers need stays a project skill, never in `skills/`.
