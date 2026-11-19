---
name: storyboard-record-flow
description: >-
  Storyboard — Record the user flow of a visual change as a storyboard (steps and screenshots,
  before vs after, the files it takes in and gives out) the person reviews without running the app. Use after changing UI (screens, forms, navigation, styles) and checking it in a
  browser, when ai1/storyboard-reminder asks for it, or when the person says "enséñame el flujo",
  "haz capturas del flujo", "quiero ver cómo queda", "documenta el flujo visualmente", "show me the
  flow", "record a storyboard", "record a walkthrough", "before and after screenshots".
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Record the user flow as a storyboard

**Goal:** the person validates how the *user* sees the flow (what appears, what to click, what
changed), not that the code works. Tests cover that; this is the view of a person using the app.
ai1 does not drive the browser: capture with the browser tool you have (Playwright MCP or another),
then hand each image (and each file the flow takes in or gives out) to `ai1 storyboard`.
Everything you write in it is short: the person reviews, they do not read an essay.

## 1. Decide the flow

- From the change, write the path a user takes through it as 3-10 steps, each one sentence in the
  user's words: "Abre el calendario y ve los días libres en verde", not "renders AvailabilityGrid".
- Include the screen before the changed one (where the user comes from) and the result after it.
- When the flow has distinct phases ("Subida del Excel", "Informe generado"), give each step its
  `--section "<short name>"`; consecutive steps of a section are grouped under one header.
- Steps get stable ids from the caption; pass `--id <short-id>` when the same step will be captured
  before and after with different wording.

## 2. Capture the new version (after)

- Run the app the project's way (in a worktree: `ai1 worktree run <name> <command>`, its own port).
- For each step and each viewport, desktop 1440x900 and mobile 375x812:
  1. Do what the user does (navigate, type, click).
  2. Frame what the user clicks or looks at: evaluate `scripts/highlight.js` from this skill on the
     element, with `__LABEL__` replaced by "<step> · <what>". Skip it for steps that only show a result.
  3. Take the screenshot (viewport, not full page, unless the step is about scrolling).
  4. `ai1 storyboard add --step "<caption>" --image <file> --viewport desktop|mobile [--section "<name>"] [--id <id>] [--detail "<one or two lines>"]`
     (the first add may set `--title "<flow name>"` and `--base <base branch>`). Write `--detail`
     whenever the screenshot does not explain itself: what the process does at that point, in the
     user's terms ("valida las columnas y descarta las filas sin NIF"). Summarize, never explain code.
- Every file the flow takes in (an upload field) or gives out (a download, a generated report or
  email) goes on its step as evidence, never only the page around it:
  `ai1 storyboard file --step "<caption>" --file <path> --role input|output --contains "<what data it holds>" --use "<what it is for in the flow>" --check "<what to verify in it>" [--mask]`
  - Keep the input file you uploaded; download the output with your browser tool.
  - Each of the three lines is one short line. ai1 previews spreadsheets, csv, text, emails and
    images itself; for a PDF (or any type it does not read) screenshot its first page with your
    browser tool and pass it with `--preview <png>`.
  - Use `--mask` when the file holds real people's data (names, phones, emails): the preview shows
    the shape of the values and the raw file is not kept. Previews always cut to 10 rows.
- `add` and `file` warn when a text is over 200 characters: shorten it.
- Look at every screenshot yourself before going on. A broken layout, an error, a spinner or a cut
  dialog is a finding: fix it (or tell the person) and capture again; never leave it in the storyboard.

## 3. Capture the base version (before)

When the change modifies an existing flow, capture the same steps on the base:

- With worktrees: `ai1 worktree create <name>-before --base <base>`, set it up and run the app there
  (its own port), then `ai1 storyboard add ... --variant before` from inside it, reusing the step ids;
  its captures land in `<name>`'s storyboard. Drop it afterwards: `ai1 worktree drop <name>-before --confirm`.
- Without worktrees: use the main checkout only if it still runs the base; otherwise skip "before" and
  say so in one line.
- Steps that only exist after are marked "new", steps only before "removed": no need to fake them.

## 4. Build and show it

- `ai1 storyboard build --pdf`. If no Chrome is found, print `index.html` to `storyboard.pdf` in the
  same folder with your browser tool (print media; the page has one step per page).
- `ai1 storyboard serve` and give the person, in two or three lines: the URL, the PDF path, and what
  to look at ("pasos 2 y 4 cambian; el 5 es nuevo").
- If /ai1:design-review-usability is available, offer it in one more line: whether the flow is
  intuitive for the people who use it, with the findings on these steps. Run it only after a yes.
- The storyboard stays in `.ai1/storyboards/<slug>/` (git-ignored). If that folder is linked
  elsewhere by the person's own tooling, it already ended up there.

## 5. Publish (only if a customization asks for it)

The customization below may name publish destinations (a PR comment from `SUMMARY.md`, a task tracker,
another skill that takes `steps.json`). Offer them in one line after showing the storyboard and
publish only after the person says yes. With no customization, there is nothing to publish: the local
URL, the PDF and the folder are the result.

## 6. When the change closes

`ai1 worktree finish|drop` stops the server and deletes the screenshots `add` copied from (only
unchanged, untracked images; the files added with `file` are never deleted). Without a worktree, run `ai1 storyboard clean` and
`ai1 storyboard stop` yourself once the change is done.

## Fixed rules

- Never publish anywhere outside the repo without the person's yes in this conversation.
- Never commit screenshots or storyboards; they live in `.ai1/storyboards/` (git-ignored).
- Captions describe what the user does and sees, never the code.
- Every file the flow takes in or gives out goes in the storyboard with `ai1 storyboard file`.
- Never put a screenshot that shows an error or a broken screen in the storyboard as if it were fine.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context storyboard-record-flow` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context storyboard-record-flow`
