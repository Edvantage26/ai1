---
type: Component
title: OKF pack (packs/okf)
description: The OKF toolkit vendored as a git subtree of the Edvantage26/okf-skills fork, and how to update it.
tags: [okf, subtree, vendor]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-08T22:15:28Z'
sources:
  - id: fork
    resource: https://github.com/Edvantage26/okf-skills
    title: Edvantage26/okf-skills (fork of scaccogatto/okf-skills, MIT)
---

`packs/okf/` is a squashed git subtree of `Edvantage26/okf-skills` (`main`), itself a fork of
`scaccogatto/okf-skills` by Marco Boffo (MIT; the OKF spec it vendors is (c) Google, Apache 2.0).
Its `LICENSE`, `NOTICE` and `FORK.md` stay inside the pack.

- **Loaded by the plugin:** `plugin.json` lists `skills: ["./packs/okf/skills/"]` and the two agents.
  The pack's own `hooks/`, `.mcp.json`-less `servers/`, `.github/` and `.claude-plugin/` are not
  loaded (only the plugin root's are), so its dormant Stop hook and MCP server never run.
- **Skill names:** the fork renames the skills (`name:` only, directories keep upstream names) to
  `okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle`, `okf-backfill-from-history`,
  so in ai1 they read `/ai1:okf-...` (fork `0.12.0-edv.4`). The skills default to `.okf/` but follow
  the bundle path the ai1 brief names (`.ai1/okf/`).
- **Updating:** change the fork first (its tests run locally, see its `FORK.md`), then:
  `git subtree pull --prefix=packs/okf https://github.com/Edvantage26/okf-skills.git main --squash`.
  Never edit `packs/okf/` in ai1 directly.
- **Runtime:** the scripts run with the system `python3` (3.9+); PyYAML 6.0.3 is vendored in
  `packs/okf/vendor/yaml` (fork change of 2026-10-31), so no `uv`, `pip` or network is needed.
  Verified with `python3 -S` (no system packages) and a clean Python 3.9.
- **Size:** about 9 MB, 7 MB of it upstream benchmarks; kept whole so subtree pulls stay clean.
