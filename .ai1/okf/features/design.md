---
type: Component
title: design feature
description: UI rules at session start and deterministic design checks on every edited UI file - the generic AI look and basic quality problems - with the design context kept as OKF concepts, and a usability review of a flow by an agent playing its user. Ideas from Impeccable and UXAgent.
tags: [design, frontend, ui, hooks, context, impeccable]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-14T15:15:14Z'
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
On by default since v0.36.0 ([all features on](../decisions/all-features-on.md)), but `design-brief`
stays quiet in a repo without a frontend (the signal of the setup recommendation: UI packages or
tracked UI files, `repoHasFrontend`), and `design-detect` only checks UI files.

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

The user profiles live in a `## Users` section of the `Product` concept, one `### <name>` per profile
(who they are, what they already know, device, what they come to do): the same heading Impeccable
uses in `PRODUCT.md`, so both read one context.

# Usability review (/ai1:design-review-usability, since v0.37.0)

The rules above check how the UI looks; this checks whether *its* user understands the flow. Asked by
the person on 2026-11-14 ("que lo que se haga sea intuitivo para el perfil de usuario que lo tenga que
ver"); prior art reviewed the same day ([prior art](/decisions/prior-art.md#usability-review-skills-2026-11-14)).

- **Profile first**: from `## Users`; with none, the skill asks the person and records it before reviewing.
- **User-agent**: one subagent per profile (main one by default, at most 3) gets only the profile, a
  goal in the user's words, the start URL and the viewport - no code, repo, captions or hints - and
  tries the task in its own browser tab, thinking aloud, up to 25 actions or until it would give up.
  The idea comes from UXAgent; the agent that built the UI cannot judge it alone.
- **Walk**: the four cognitive-walkthrough questions on every step (Wharton et al.), plus vocabulary,
  states, undo, mobile and the cognitive load checklist copied from Impeccable
  (`skills/design-review-usability/reference/cognitive-load.md`, Apache 2.0, THIRD-PARTY.md).
- **Findings**: P0 cannot finish, P1 hesitates or errs and recovers, P2 extra effort, P3 polish (the
  scale Impeccable uses); each with step, profile, observed or judged, one fix. Labelled synthetic
  everywhere. On the storyboard through `ai1 storyboard note` ([storyboard](storyboard.md)); in the
  report only when there is none. Fixes only after the person says which; the user-agent then reruns
  the goals with P0/P1.
- Page-level critique (Nielsen scores, hierarchy) stays with `/impeccable critique` when installed.
- Limit: an LLM reads labels too well and rarely gets truly lost; P0/P1 are worth one real person.
  Its tests pin the skill text (`test/design-review-usability.test.mjs`), not a live run.

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
