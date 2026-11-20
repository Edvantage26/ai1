---
type: Component
title: design feature
description: UI rules at session start and deterministic design checks on every edited UI file - the generic AI look and basic quality problems - with the design context kept as OKF concepts, and a usability review of a flow by an agent playing its user. Ideas from Impeccable, Hallmark and UXAgent.
tags: [design, frontend, ui, hooks, context, impeccable, hallmark]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-20T07:55:31Z'
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
  - id: brand-find
    resource: src/design/brand-find.mjs
    title: ai1 brand find
  - id: gather-brand
    resource: skills/design-gather-brand/SKILL.md
    title: /ai1:design-gather-brand
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
| `design-brief` | SessionStart | Context first (lists the design context files) and the installed design skills, then the generic AI look and the quality floor in one line (design-detect reports the detail on each edit that breaks one), the usability review after a storyboard. With no context, asks for the user profiles in the `## Users` shape. Mentions `/impeccable critique`, `audit`, `polish` only when Impeccable is installed, and frontend-design (set the visual direction, then record its palette, typefaces and type scale in `DesignSystem`) only when that skill is installed, and `/hallmark` for a new page (redesign or audit only when the person names it, Hallmark's own rule) only when Hallmark is installed (`isDesignSkillInstalled`: a plugin of that name or a skill folder). Skipped on `resume`. |
| `design-detect` | PostToolUse (Edit, Write, MultiEdit) | Scans the edited UI file, keeps the findings on lines this edit wrote (Write = whole file; Edit/MultiEdit = where `new_string` landed), reports each once per session (keyed by rule + line text), as `additionalContext`. Never blocks. In a page Hallmark built (`/* Hallmark` stamp in the file, or a `.hallmark/` folder between the file and the project root), skips the rules that carry a `hallmarkGate`: Hallmark's own hook and sweep check those. |

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

# Client brand (/ai1:design-gather-brand, ai1 brand find, since v0.52.0)

Asked by the person on 2026-11-19: designing a client's web, the agent neither looked at the client's
colours, logo or images nor asked for them, nor reused them from other projects with that client, and
frontend-design made up a style from scratch.

- **Where it lives**: the `DesignSystem` concept carries `brand_owner: <client>` in its frontmatter
  and a `## Brand` section, one short line each for Logo, Colours (hex + role), Typefaces and Imagery,
  each with its source (this repo, another repo, a URL, the person). Without a bundle, `DESIGN.md`.
  Assets are copied into the repo's static folder.
- **Brief** (`design-brief`): with no `## Brand` recorded, one line sends to /ai1:design-gather-brand
  before designing a client's UI; with one, it names the file and says to design with its colours, logo
  and typefaces. The frontend-design line says to set the direction within the brand.
- **Skill** (customizable, project + person): who the client is (`Product`, `ai1 contacts`, else ask),
  then in order this repo, `ai1 brand find`, the sources of the customization, the client's website
  (logo in the header, og:image or a large favicon; main colours; fonts its CSS loads), and the person
  for what is still missing; record, show a short summary. Fixed rules: never invent or use a doubtful
  logo, every item has its source, the client's own images only for the client's web. Offered by the
  brief only: whether a web is for a client depends on the task (a hook that blocks UI edits without a
  brand was rejected).
- **`ai1 brand find "<owner>" [--json]`**: repos from the decision-log `.repo` sidecars
  (`listLoggedRepositories`, every repo where ai1 ran on this machine) and `related`, each read through
  its bundle; `DesignSystem` concepts whose `brand_owner` matches exactly after dropping case, accents
  and punctuation (another client's brand is worse than none); the current repo (by main checkout)
  excluded; backticked asset paths made absolute. No network.
- The person's private sources (their tools and folders of client logos) go in their customization of
  the skill, never in the plugin ([host tooling stays out](../decisions/host-tooling-out-of-plugin.md)).
- Finding: the worst-case session start was at 9497 of 9500 characters before this line (9406 after the later/sizing briefs were tightened on 2026-11-19); the brief
  wording was tightened to fit (the session-start budget test caught it).

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

35 rules, checks written from scratch for source text (regex and colour arithmetic, no code from
Impeccable or Hallmark). Ids of the first 26 from Impeccable's catalogue; the last 9 from Hallmark's
gates ([review](/decisions/prior-art.md#hallmark-review-2026-11-20), 2026-11-20). Each rule that
matches a Hallmark gate names it in `hallmarkGate` (25 of them), which is what the Hallmark-page skip
reads.

- **slop**: overused-font, gradient-text, ai-color-palette (purple/violet 300-900 or hue 255-300),
  side-tab, dark-glow, bounce-easing (hint), pulsing-dot, marquee, kicker-above-heading,
  icon-tile-stack, italic-serif-display, cream-palette, marketing-buzzword, em-dash-overuse (hint),
  theater-slop-phrase (hint), repeating-stripes-gradient (hint), codex-grid-background (hint),
  extreme-negative-tracking.
- **quality**: hard-offset-shadow (hint), organic-clip-path, broken-image, skipped-heading,
  gray-on-color, low-contrast (CSS blocks with solid colour and background, WCAG 4.5:1),
  tiny-text (< 11px), justified-text (hint).
- **from Hallmark** (2026-11-20): transition-all (`transition: all`, or width/height/top/left, gate
  10a), outline-removed (outline none with no focus style in the file: no `:focus`, `focus-visible`,
  `focus-within` or Tailwind `focus:`, 26a),
  no-reduced-motion (`@keyframes` with no `prefers-reduced-motion` / `motion-reduce:` in the file, 27),
  hidden-until-js (reveal, fade-in, appear, on-scroll or `data-animate` selector, comments dropped, at
  opacity 0 or visibility hidden, not scoped to `.js` nor a `:hover`/`:focus` state, no `@starting-style`,
  62), autoplay-unmuted (28a), viewport-units (hint: a fixed `height: 100vh`/`h-screen`, or
  `100vw`/`w-screen`; `min-h-screen` is left alone, 6a/34), emoji-icon (an emoji alone in an element or leading a heading, list
  item or button; ©/™ excluded, 30a), template-punctuation (two or more middle dots, or an arrow
  ending link or button text, 63), placeholder-name (Jane/John Doe or Smith, Acme, lorem ipsum, 19).
  Left out of Hallmark on purpose: its house rules (stamp, every colour through a token, ~80 words per
  screen) and everything that needs the rendered page.

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

- Hallmark rules (2026-11-20): scan of 465 tracked UI files in 6 repos of the dev server
  (`scanUiFile` per file, new rules only). First pass too noisy: `min-h-screen` page wrappers (123),
  `outline-none` with a `focus:` or `:focus` replacement, hover-revealed elements and comments read as
  selectors; tightened to viewport-units 33 (fixed `h-screen` loaders), outline-removed 6,
  hidden-until-js 0, emoji-icon 4 (all real), template-punctuation 2, transition-all 76 (mostly
  Tailwind `transition-all` on hover, as Hallmark rules it).
- Speed (same day): `listCssBlocks` was a regex that went quadratic on large HTML with inline
  scripts (about 700 ms per rule on a 100 KB mockup, three rules use it); now one linear pass cached
  per file, the same blocks on all 311 files of fisio-rider, slowest file 15 ms for any rule.

- `npm test` (2026-11-08): 35 design tests (26 rule pairs, ranges, dispatcher flow, brief).
- Scan of 8 real frontends on the dev server (about 750 UI files): false positives found and fixed
  (lucide `<Image>` icon, pastel `purple-50` gradients, minified CSS, `>` inside Vue attributes);
  the `low-contrast` hits checked by hand were real (e.g. white on `#06b6d4`, 2.4:1).
- Live headless Claude Code session with `--plugin-dir` (2026-11-08): writing a `.tsx` hero with a
  purple gradient-text heading and "Streamline" got `gradient-text`, `ai-color-palette` and
  `marketing-buzzword` back as PostToolUse context, and the agent quoted them.
