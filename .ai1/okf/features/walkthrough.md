---
type: Component
title: walkthrough feature (in progress)
description: Storyboard of the user flow after a visual change - numbered steps with desktop/mobile screenshots, before/after, HTML served locally and a PDF; residual screenshots deleted on close. Being built (plan .ai1/work/walkthrough/plan.md).
tags: [walkthrough, ui, screenshots, pdf, worktrees]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-09T15:30:21Z'
sources:
  - id: storyboard
    resource: src/walkthrough/walkthrough-storyboard.mjs
    title: steps.json model, add, residual cleanup
  - id: build
    resource: src/walkthrough/walkthrough-build.mjs
    title: index.html and SUMMARY.md
  - id: pdf
    resource: src/walkthrough/walkthrough-pdf.mjs
    title: Chrome discovery and PDF printing
  - id: serve
    resource: src/walkthrough/walkthrough-serve.mjs
    title: local server, release on worktree finish/drop
---

# Why

Decided with the person on 2026-11-09: after a visual change, let them validate how the user sees the
flow without running the app. Prior art in [prior art](../decisions/prior-art.md#visual-walkthroughs-of-ui-changes-2026-11-09).
ai1 never drives the browser: the agent captures with its own tool and hands the files to
`ai1 walkthrough add`. Off by default; recommended with `design` (same frontend signal).

# Built so far

- `ai1 walkthrough add|build [--pdf]|serve|stop|list|clean` (src/cli/walkthrough-command.mjs).
- `steps.json` contract: steps keyed by id (from the caption or `--id`), captures by variant
  (before/after) and viewport (desktop/mobile), each with its `source` (path, size, mtime) until cleaned.
- `index.html`: one file, images inlined, slides (arrow keys) or strip, before/after columns, steps
  marked new/removed; print stylesheet A4 landscape, one step per page. `SUMMARY.md` for publishers.
- `serve`: detached Node server on 127.0.0.1, port from `pickWorktreePort('walkthrough:'+slug)` avoiding
  listening and worktree ports, TTL 8 h; `ai1 worktree finish|drop` stop it and delete residual
  screenshots (only unchanged, untracked images that `add` copied).
- Pending: storyboard folder moving to `.ai1/walkthroughs/<slug>/` (awaiting the person's approval of the
  redesign), the skill, the Stop reminder, docs.

# Findings

- Google Drive does not render HTML; it previews PDF and images. Hence the PDF.
- Headless PDF: Playwright's Chromium crashes at start inside sandboxed agent shells unless
  `--no-sandbox`; snap `chromium-browser` cannot read `/tmp` (snap private tmp) but reads the repo.
  Content is ai1's own file, so `--no-sandbox` is passed always.
- Validate the look by building a demo storyboard from two headless screenshots
  (`chrome --headless --no-sandbox --window-size=1440,900 --screenshot=...`), screenshotting
  `index.html` and reading the PDF page by page.
- Tests that serve must stop their servers in `after` (a failed assertion left detached servers).
