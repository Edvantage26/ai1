---
type: Component
title: storyboard feature
description: Storyboard of the user flow after a visual change - numbered steps with desktop/mobile screenshots, before/after, HTML served at a local URL and a PDF, kept in .ai1/storyboards/ (git-ignored); residual screenshots deleted on close; Stop reminder; publishing only through a skill customization.
tags: [storyboard, ui, screenshots, pdf, worktrees]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-14T15:15:14Z'
sources:
  - id: storyboard
    resource: src/storyboard/storyboard-steps.mjs
    title: steps.json model, add, residual cleanup
  - id: build
    resource: src/storyboard/storyboard-build.mjs
    title: index.html and SUMMARY.md
  - id: pdf
    resource: src/storyboard/storyboard-pdf.mjs
    title: Chrome discovery and PDF printing
  - id: serve
    resource: src/storyboard/storyboard-serve.mjs
    title: local server, release on worktree finish/drop
  - id: reminder
    resource: src/storyboard/storyboard-reminder.mjs
    title: Stop reminder
  - id: skill
    resource: skills/storyboard-record-flow/SKILL.md
    title: /ai1:storyboard-record-flow
---

# Name (since v0.33.0)

Called **walkthrough** until v0.32 (feature and module `walkthrough`/`walkthrough-reminder`, skill
`walkthrough-record-flow`, CLI `ai1 walkthrough`, folder `walkthroughs` under `.ai1/`, `walkthrough.pdf`).
Renamed with the person on 2026-11-11 to say what it produces. `evidence` was considered and rejected: it
promises any kind of proof (tests, API calls, logs) while this records only the visual flow, and it would
blur with [verify](verify.md), which already is about evidence before claims; `preview` was the other
option. "record a walkthrough" stays among the skill's triggers. Existing repos (including a symlinked
folder) are moved by [migration 2](/architecture/migrations.md) at session start; storyboards built before
keep their old HTML title and PDF name until rebuilt.

# Why

Decided with the person on 2026-11-09: after a visual change, let them validate how the user sees the
flow without running the app. Prior art in [prior art](../decisions/prior-art.md#visual-walkthroughs-of-ui-changes-2026-11-09).
ai1 never drives the browser: the agent captures with its own tool and hands the files to
`ai1 storyboard add`. On by default since v0.36.0; its reminder only fires when UI files changed.

# How it works

- **Skill** `/ai1:storyboard-record-flow` (customizable, project and person): the flow as 3-10 steps
  in the user's words; desktop 1440x900 and mobile 375x812; `scripts/highlight.js` frames what is
  clicked; the agent looks at every screenshot before adding it; base captured in a
  `<name>-before` worktree (its captures land in `<name>`'s storyboard); build with `--pdf`, serve,
  give URL + PDF + what to look at. Publishing exists only when a customization names a destination,
  and only after the person's yes (fixed rule).
- **Folder** `.ai1/storyboards/<slug>/` in the main checkout, ignored by its own `.gitignore` (`*`,
  `ensureDirectoryIgnoredByItself`, shared with `.ai1/work/`). Works unchanged when the folder is a
  symlink to a synced folder; where storyboards go outside the repo is the person's tooling, not ai1
  (decided 2026-11-09, replacing a destination setting with mount checks). A symlinked folder must be
  excluded by that tooling (`.git/info/exclude`): git sees a symlink as a file.
- **Slug**: `--slug`, else the worktree name (a trailing `-before` stripped), else the only open plan.
- **CLI** `ai1 storyboard add|note|build [--pdf]|serve|stop|list|clean` (src/cli/storyboard-command.mjs).
- **`steps.json`** (contract for publishers, with `SUMMARY.md`): steps keyed by id (from the caption or
  `--id`), captures by variant (before/after) and viewport (desktop/mobile), each with its `source`
  (path, size, mtime) until cleaned. Same step+variant+viewport replaces the image.
- **Notes** (since v0.37.0, from [/ai1:design-review-usability](design.md#usability-review-ai1design-review-usability-since-v0370)):
  `ai1 storyboard note --step <id> --severity P0..P3 --text ... [--profile] [--fix] [--viewport]` adds
  `{ id, severity, text, profile?, fix?, viewport? }` to the step's `notes`; `note --clear` removes all
  (a new review replaces the last). Additive, so `version` stays 1. Rendered under the step header
  (P0/P1 in the removed colour), printed in the PDF, listed as `Findings:` in `SUMMARY.md`, with a
  line saying they are synthetic. The skill offers the review in one line after showing a storyboard.
- **`index.html`**: one file, images inlined, slides (arrow keys) or strip, before/after columns, steps
  marked new/removed, the base's wording under the new caption when it differs, click a screenshot to
  see it full size; print stylesheet A4 landscape, one step per page, used for the PDF.
- **`serve`**: detached Node server on 127.0.0.1 (`--host`), port from `pickWorktreePort('storyboard:'+slug)`
  avoiding listening and worktree ports, TTL 8 h, `server.json` record (stale ones removed).
- **Close**: `ai1 worktree finish|drop` (or `ai1 storyboard stop` + `clean`) stop the server and delete
  the screenshots `add` copied from - only unchanged, untracked images outside the storyboard. The
  storyboard stays.
- **`storyboard-reminder`** (Stop): UI files (design-detect's classification) changed in the session
  and no `index.html` in `.ai1/storyboards/` newer than them -> one block per set of files, at most 2
  per session. `modules.storyboard-reminder.ignore`: globs.
- Recommended by `/ai1:core-setup-repo` with `design` (same frontend signal).

# Findings

- Google Drive does not render HTML; it previews PDF and images. Hence the PDF.
- Headless PDF: Playwright's Chromium crashes at start inside sandboxed agent shells unless
  `--no-sandbox`; snap `chromium-browser` cannot read `/tmp` (snap private tmp) but reads the repo.
  Content is ai1's own file, so `--no-sandbox` is passed always, and every browser found is tried in
  turn until one prints (the snap one on PATH failed first in the end-to-end run).
- End-to-end run (2026-11-09, scratch repo with a base and a changed booking page, `playwright-rec`
  MCP): browser MCPs save screenshots relative to their own working directory - they landed in the
  root of the session's repo, exactly the residue `clean` removes (7 deleted on `worktree finish`).
  The plugin Playwright MCP failed there (no `/opt/google/chrome`). The highlight label sits above the
  element and can cover its neighbours: acceptable, the frame is what matters.
- Validate the look by building a demo storyboard from two headless screenshots
  (`chrome --headless --no-sandbox --window-size=1440,900 --screenshot=...`), screenshotting
  `index.html` and reading the PDF page by page. The slides view opens on step 1 (a `#step-n` hash
  does not move it): to see a later step, print the PDF (`--print-to-pdf`) and render that page
  (`pdftoppm -f n -l n -png`). Done for notes on 2026-11-14 with a script importing `addCapture`,
  `addStepNote`, `buildStoryboard` from `src/storyboard/`.
- Snap `chromium-browser` cannot write screenshots under `/tmp` nor in hidden folders of the home
  (`~/.cache/...`): for scratch captures, pick a Playwright Chromium from `findChromeBinaries()`
  (the `ms-playwright` paths), which writes anywhere.
- Tests that serve must stop their servers in `after` (a failed assertion left detached servers).
