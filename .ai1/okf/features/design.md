---
type: Component
title: design feature
description: UI rules at session start and deterministic design checks on every edited UI file - the generic AI look and basic quality problems - with the design context kept as OKF concepts. Ideas from Impeccable.
tags: [design, frontend, ui, hooks, context, impeccable]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:15:28Z'
sources:
  - id: design-rules
    resource: src/design/design-rules.mjs
    title: Rule catalogue and scanner
  - id: design-detect
    resource: src/design/design-detect.mjs
    title: PostToolUse check
  - id: design-brief
    resource: src/design/design-brief.mjs
    title: SessionStart recipe
---

# Why

Agents building UI fall back on the same defaults (Inter, purple gradients, glows, icon tiles,
uppercase kickers, buzzwords) and miss basics (contrast, heading order, tiny text). Prompt-only
design skills help, but nothing checks the result. [Impeccable](/decisions/prior-art.md) showed
that a deterministic detector run as a hook catches much of it without an LLM. Decided with the
person on 2026-11-08: bring the detector idea and a short brief into ai1, keep the design context
in the OKF bundle, and point to Impeccable for its method commands instead of copying them.
Off by default: only repos with a frontend want it.

# Modules

| Module | Event | What it does |
|---|---|---|
| `design-brief` | SessionStart | Context first (lists the design context files), avoid the generic AI look, quality floor, expect design-detect. Mentions `/impeccable critique`, `audit`, `polish` only when Impeccable is installed. Skipped on `resume`. |
| `design-detect` | PostToolUse (Edit, Write, MultiEdit) | Scans the edited UI file, keeps the findings on lines this edit wrote (Write = whole file; Edit/MultiEdit = where `new_string` landed), reports each once per session (keyed by rule + line text), as `additionalContext`. Never blocks. |

Only files inside the project. UI files: `.css .scss .sass .less .pcss` (style) and `.html .htm .jsx .tsx .vue .svelte .astro`
(markup); `*.min.*` is skipped. Option `modules.design-detect.ignore_rules` switches rules off.

# Design context

Kept as bundle concepts, so [okf-recall](/features/okf.md) surfaces them and okf-upkeep keeps
them current: `type: Product` (who it is for, tone, constraints) and `type: DesignSystem`
(palette, typefaces, type scale, spacing, radii). Impeccable's `PRODUCT.md` / `DESIGN.md` at the
repo root are listed too, so both tools can share one context. With no context, the brief tells
the agent to ask the person and record it before a sizeable UI task.

# Rules

26 rules, ids taken from Impeccable's catalogue, checks written from scratch for source text
(regex and colour arithmetic, no code from Impeccable):

- **slop**: overused-font, gradient-text, ai-color-palette (purple/violet 300-900 or hue 255-300),
  side-tab, dark-glow, bounce-easing (hint), pulsing-dot, marquee, kicker-above-heading,
  icon-tile-stack, italic-serif-display, cream-palette, marketing-buzzword, em-dash-overuse (hint),
  theater-slop-phrase (hint), repeating-stripes-gradient (hint), codex-grid-background (hint),
  extreme-negative-tracking.
- **quality**: hard-offset-shadow (hint), organic-clip-path, broken-image, skipped-heading,
  gray-on-color, low-contrast (CSS blocks with solid colour and background, WCAG 4.5:1),
  tiny-text (< 11px), justified-text (hint).

Each rule has a flagged and a clean sample in `test/design.test.mjs`; a new rule without both
fails the suite. Adding a rule: one entry in `DESIGN_RULES`, its id in the schema enum
(`modules.design-detect.ignore_rules`), its two samples.

# Limits

- Source only: no rendering, so no real contrast over images, overflow, line length or nested
  cards. Impeccable's CLI (`npx impeccable detect <url>`) covers the rendered page.
- Line-based: Tailwind checks look at one line; classes built across lines or in helpers escape.
- `low-contrast` sees only literal colours in one CSS block, not variables or Tailwind classes.
- Planned: a Stop reminder for unresolved findings (with the `verify` gate), and checking literal
  fonts and colours against the `DesignSystem` concept.

# Verified

- `npm test` (2026-11-08): 35 design tests (26 rule pairs, ranges, dispatcher flow, brief).
- Scan of 8 real frontends on the dev server (about 750 UI files): false positives found and fixed
  (lucide `<Image>` icon, pastel `purple-50` gradients, minified CSS, `>` inside Vue attributes);
  the `low-contrast` hits checked by hand were real (e.g. white on `#06b6d4`, 2.4:1).
- Live headless Claude Code session with `--plugin-dir` (2026-11-08): writing a `.tsx` hero with a
  purple gradient-text heading and "Streamline" got `gradient-text`, `ai-color-palette` and
  `marketing-buzzword` back as PostToolUse context, and the agent quoted them.
