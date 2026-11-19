---
name: design-gather-brand
description: >-
  Design — Gather a client's brand (colours, logo, typefaces, images) before designing its UI: from
  this repo, the person's other projects with that client, the client's website, then the person; record
  it under `## Brand` of the design-system context so every design uses it. Use when the design brief
  asks for it, when starting a web or screens for a client, or when the person says "usa la marca del
  cliente", "saca los colores y el logo de su web", "busca el logo del cliente", "use the client's
  brand", "get their logo and colours".
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *) Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" brand *)
---

# Gather the client's brand before designing

**Goal:** a client's web looks like the client: its logo, its colours, its typefaces and its own
images, not defaults or a style made up from scratch. Gather what exists, ask only for what is
missing, record it once so every later session designs with it.

## 1. Who the client is

Take the client's name from the `Product` concept or the project's contacts (`ai1 contacts`); if
neither names it, ask the person. That name is the `brand_owner`.

## 2. Look, in this order, and stop asking for what you already have

1. **This repo**: logo files, favicon, images in the static folders, colours and fonts already in
   the CSS or the theme.
2. **The person's other projects with this client**: run
   `"${CLAUDE_PLUGIN_DATA}/bin/ai1" brand find "<client>"`. A match gives that repo's `## Brand` with
   absolute paths: reuse its colours and typefaces and copy its assets into this repo.
3. **The sources in the customization below**, if any (the person's own folders or tools).
4. **The client's website**, with your browser or fetch tool: the logo in the header (SVG or the
   largest PNG; `og:image`, `apple-touch-icon` or a large favicon otherwise), the main colours (header,
   buttons, links, background) and the fonts its CSS loads. Check the logo really is this client's.
5. **The person**, for what is still missing, in one message: the logo in good quality, their own
   photos, colours or fonts they must keep. Say what you already found so they only fill the gaps.

## 3. Record it

- Copy the assets into the folder this project already serves static files from (`public/`,
  `static/`, `assets/`...) and say which.
- In the `DesignSystem` concept (create it with /ai1:okf-maintain-knowledge if missing; without a
  knowledge bundle, in `DESIGN.md`): frontmatter `brand_owner: <client>` and a `## Brand` section, one
  short line each, with where it came from:

  ```markdown
  ## Brand

  - Logo: `public/logo.svg` (source: https://client.example)
  - Colours: #0E7C66 primary, #F4B400 accent, #FFFFFF background, #1D1F21 text (source: website CSS)
  - Typefaces: Lora headings, Inter body (source: website CSS)
  - Imagery: `public/images/team.jpg` (source: the person); none yet for the services page
  ```

- Show the person a short summary: the colours with their hex, the logo file, what is still missing.

## 4. Design with it

From here on the brand is the starting point: frontend-design or any other design work picks the
layout and the details within it, and a colour or font outside it is a deliberate addition recorded
in the same concept.

## Fixed rules

- Never invent a logo, draw one or use a doubtful one; without a reliable logo, say so and go on
  without it.
- Never present a guessed colour as the client's: each item of `## Brand` says where it came from.
- Use the client's own images only for the client's web; stock or third-party images are not copied
  from its site.
- Ask the person only for what is still missing after looking.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context design-gather-brand` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context design-gather-brand`
