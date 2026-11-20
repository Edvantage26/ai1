---
type: Component
title: ai1 skill design (project skill of the ai1 repo)
description: ai1-skill-design guides a new plugin skill so it earns its place, has a boundary with its neighbours and a route by which the agent is offered it, and reviews how the existing skills fit; its fit map lists routes, hand-offs, permissions and description cost per skill.
tags: [skills, design, proactivity, review]
resource: .claude/skills/ai1-skill-design/SKILL.md
sources:
  - id: fit-map
    resource: .claude/skills/ai1-skill-design/fit-map.mjs
    title: fit map of every skill
  - id: customization-index
    resource: src/core/skill-customization-index.mjs
    title: one entry per plugin skill
  - id: readme-index
    resource: src/core/readme-index.mjs
    title: where each plugin skill and hook comes from, and what each hook does
  - id: readme-tables
    resource: scripts/readme-tables.mjs
    title: generates the Skills table of the README and the Hooks table of docs/reference.md
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-20T23:57:28Z'
---

Built 2026-11-18 at the person's request: a skill for developing ai1, not for the people who use
it, so it is a **project skill** (`.claude/skills/ai1-skill-design/`) like [retro](retro.md) and does
not ship with the plugin.

# Why

A plugin skill's description is listed in every session of everyone who installs ai1
([plugin layout](../architecture/plugin-layout.md#which-skills-the-agent-sees)), and a skill the agent
never loads at the right moment is dead weight. ai1 makes skills proactive with hooks and briefs that
name them at the moment they apply (fix-loop, storyboard-reminder, watch-release-detect, reuse-check,
foreign-repo, issue-offer), with hand-offs between skills, or on demand by design (later).

# How it works

- **New**: (1) skill or not - hook, `ai1` subcommand, brief line or project skill first
  ([principles](../decisions/principles.md)); (2) the fit map and the neighbours: colliding
  triggers, overlap, hand-offs, other plugins; (3) a route, with one way to offer (one line after the
  work, once, act on a yes); (4) name, description (~80 words, strict YAML), body, Fixed rules; (5)
  the wiring checklist ([skill customization](../architecture/skill-customization.md), features,
  README, concept); (6) a real try with `claude --plugin-dir`.
- **Review**: the fit map plus a read of every body, checked for missing routes, collisions,
  one-way hand-offs, duplication, broad `allowed-tools`, description cost, shape, drift and
  contradictions; a table of proposals, nothing applied without a yes.
- `node .claude/skills/ai1-skill-design/fit-map.mjs [--json]`: per skill the description words,
  `allowed-tools`, strict-YAML frontmatter, the `src/`/`bin/` files that name it (files that list or
  rename every skill excluded) and the skills that name it or that it names.

# First review (2026-11-18)

Run over the 20 plugin skills and 2 project skills; the person accepted all but narrowing the OKF
skills' `allowed-tools` (kept as they are). Applied the same day: ai1-retro no longer offers later;
boundaries fork -> delegate and danger-write-rule -> core-customize-skill; routes for the two skills
that had none (`rule-offer` -> danger-write-rule, `llm-brief` -> verify-evaluate-llm-prompts); the
okf-maintain-knowledge trigger "any work in a repo with a bundle" dropped and the watches description
cut; strict YAML in later-write and worktrees-plan-recipe; hand-made skill lists in the architecture
concepts replaced by pointers to the index and the folders; sizing's description says what it does
and the redundant `user-invocable: true` is gone.

# README tables: skills, hooks and where each comes from

Since 2026-11-21, at the person's request, the README lists every plugin skill and
`docs/reference.md` every hook module, with what each does and its origin. The README follows the
shape of successful plugin READMEs (Compound Engineering, Superpowers, Impeccable): tagline and
badges, install, try it, why, one line per feature, skills, config, FAQ; every detail lives in
`docs/reference.md`. `src/core/readme-index.mjs` holds one entry per `skills/<folder>`
(`SKILL_ORIGIN_INDEX`) and one per module of `src/core/module-index.mjs` (`HOOK_README_INDEX`, with
the hook's description): `importedFrom` (code or text copied, also in `THIRD-PARTY.md` with its
license) and `basedOn` (projects whose ideas or method it takes, no code copied); both empty means
written in ai1. `npm run readme-tables` (`scripts/readme-tables.mjs`) writes the Skills table between
the `skills:` markers of `README.md` and the Hooks table between the `hooks:` markers of
`docs/reference.md`: a skill's description is the first sentence of its
`description` without its feature prefix; a hook's id, feature and event come from the module index.
`test/readme-tables.test.mjs` fails when a skill or module has no entry or a table is out of date, so a
new skill or hook, a changed description or a new origin reaches the docs with the commit. What is
neither (the CLI, customization, local data, planned pieces) stays hand-written under "Other
components" of `docs/reference.md`. Origins come from the [prior art](../decisions/prior-art.md) and the feature concepts;
the Credits section of the README keeps the general influences and license attributions.
