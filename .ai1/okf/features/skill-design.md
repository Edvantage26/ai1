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
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T16:49:56Z'
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

Run over the 20 plugin skills and 2 project skills; the findings went to the person as proposals.
