---
name: core-setup-repo
description: Core — Set up ai1 in the current repository, or switch ai1 features off or back on. Use when the person says "set up ai1 here", "configure the harness", "enable/disable an ai1 feature", "desactiva X de ai1 en este repo", "activa ai1 en este repo", or when a session reports that ai1 is installed but inactive.
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Set up ai1 in this repository

The files are written by the `ai1` CLI (on the Bash PATH while the plugin is enabled), never by
hand: it merges with existing files and validates the result.

## 1. See the current state

```bash
ai1 status --json
```

It returns the repo root, whether `.ai1/config.json` exists, the detected protected branch,
the knowledge bundle path (always `.ai1/okf`) and whether a bundle exists, every feature with `enabled`,
`enabledByDefault` and `recommendation` (`recommended`: true, false or null = the repo cannot tell,
ask; `reason`; `evidence` found in the repo), `detectedVerifyCommands` (the test commands found in
package.json, Makefile, pytest config, Cargo, Go), and `overlappingPlugins`: other plugins enabled for the person (user, project or
local settings) that do part of ai1's job, each with `pluginId`, `features` it overlaps with (`null` =
ai1 as a whole), `action` (`disable` recommended, or only `warn`) and `reason`.

If `legacyMigration.moves` or `legacyMigration.settingsFiles` is not empty, the repo has the old
layout (ai1 was called jig, and OKF bundles live in `.okf/` by convention). `ai1 init` moves it to
`.ai1/` before writing the configuration: `.claude/jig.json` -> `.ai1/config.json`, `.okf/` ->
`.ai1/okf/`, `docs/rfc/` -> `.ai1/later/` (only when the rfc feature was on), `.jig/work/` ->
`.ai1/work/`, a bundle at a custom path from the retired `knowledge` setting -> `.ai1/okf/`, and
`jig@jig` -> `ai1@ai1` in the settings. Tracked paths move with `git mv`; links
inside the moved bundle and later entries are rewritten. A repo that used the `rfc` feature of ai1
before v0.18.0 (`.ai1/rfc/`, `features.rfc`) or the `proposals` feature before v0.25.0
(`.ai1/proposals/`, `features.proposals`) gets it renamed to `later` the same way. Show the person the list and ask before step 4.
If `legacyMigration.conflicts` is not empty, the targets already exist: stop and tell the person.

## 2. Everything on; ask only what to switch off

Every feature is on unless the repo switches it off (`features.<id>: false`). Features that need
something from the repo start in a basic mode: worktrees with the recipe ai1 works out from the repo,
design and storyboard quiet in a repo without a frontend. So the setup does not choose features: it
shows them all on and asks only whether to switch any off.

Look at the repo yourself too (README, CLAUDE.md, the main folders) next to each `recommendation`
(the CLI only reads cheap signals). Show the person, in one message, a table with one row per
feature: what it does in one line and, only where the repo gives a reason, why they might switch it
off ("design: no frontend found, it stays quiet anyway"). When the repo already has
`.ai1/config.json`, show what is off now. Add the verify commands you propose
(`detectedVerifyCommands`, or what you found).

Then use AskUserQuestion with **multiSelect**: "Which features do you want off in this repo?", one
option per feature (label = `title`); none selected keeps everything on, which is the recommendation.
Do not invent features. Confirm the verify commands in the same round.

Before proposing a verify command, run it once from the repo root (Bash, timeout 10 minutes,
measuring the time) and put the result in the table: passes, fails or times out, and how long it
took. The verify gate makes the agent run it in full before finishing every change, so:
- it fails on the current code: say so; propose it anyway only if the person will fix the tests
  first, otherwise leave the verify commands empty for now (the gate does nothing without them);
- it takes more than about 3 minutes: say so and propose a faster command that still checks the
  changed code (unit tests only, one package), or leave the verify commands empty for now;
- it cannot run (missing dependencies, a service down): say what is missing instead of guessing.

## 3. Ask about overlapping plugins

Keep the `overlappingPlugins` whose `features` is `null` or includes a feature left on.
If any is left, tell the person in one line per plugin what overlaps and why (its `reason`), then
ask with AskUserQuestion, **multiSelect**, which ones to disable **in this repo only** (written to
`.claude/settings.local.json`, personal and not committed; the plugin keeps working in other repos).
One option per plugin; mark the `disable` ones "(recommended)", the `warn` ones without it. Never
disable one the person did not pick. If none is left, skip this step.

Then, unless `credentialDenyRules` already shows them all, ask one yes/no question (recommended:
yes): add Claude Code permission deny rules so the agent cannot read credential files - private
keys (`*.pem`, `*.key`, `~/.ssh/id_*`) and the credential stores in the home folder (`~/.aws`,
`~/.gnupg`, `~/.kube`, `~/.config/gh`, `~/.docker/config.json`, `~/.netrc`, `~/.git-credentials`,
`~/.npmrc`, `~/.pypirc`). Say in one line what they cover: the file tools and the shell file
commands Claude Code recognises (`cat`, `head`, redirects), not scripts that open files themselves,
and that they go in the committed `.claude/settings.json`, so they apply to the whole team. `.env`
files are not included.

Unless `reportErrors` is already set (it is per person, so it carries across repos), ask once how
ai1's own errors (a hook that crashes, never a misfire) should be reported to the ai1 maintainers:
**ask each time** (recommended), **automatically** (an issue with only versions, OS and the error's
module and plugin file:line, nothing from their work, filed without asking) or **never**. It goes to
their user settings (`~/.claude/settings.json`), not to the repo.

## 4. Write the configuration

```bash
ai1 init [--disable <ids switched off in step 2> | --disable none] [--verify "<command>" ...] [--disable-plugins <ids picked in step 3>] [--deny-credentials] [--report-errors ask|auto|off]
```

`--disable` is the exact list of features off (it writes only those, as `false`); `--disable none`
switches them all on; without `--disable` the opt-outs the repo already has are kept. Report what the
command printed, including the plugins it disabled in this repo. When it migrated an old layout,
offer to update the files it lists as still mentioning old paths (CLAUDE.md, README...).

## 5. Show what they have

A short table with one row per enabled feature: what it does for them in one line (from its
`description`), and how to use it (its skills `/ai1:...` and `ai1 ...` commands named in the
description, or "automatic" when it only runs hooks).

## 6. Set up each enabled feature

Some features work better with project-specific setup that `ai1 init` cannot write. Offer each one
that applies, one at a time, in this order, and do it only after a yes (the person may leave any for later):

- `worktrees`: it already works with the basic recipe. Offer `/ai1:worktrees-plan-recipe` only when
  the repo clearly needs more (ports per worktree, services, big data folders to share); otherwise
  the agent completes the overlay when `ai1 worktree` reports a gap.
- `okf` and there is no bundle yet: create one with `/ai1:okf-maintain-knowledge` (produce mode).
- `okf` and there is a bundle: run `ai1 claude-md`. If it reports findings, offer
  `/ai1:okf-tidy-claude-md`; when the migration listed CLAUDE.md among the files with old paths,
  make it one offer (the skill fixes those paths too).
- `design` and the bundle has no concept of type `Product` or `DesignSystem`: capture who uses the
  product (under `## Users` of `Product`, one `### <name>` per profile: who they are, what they already
  know, device, what they come to do; /ai1:design-review-usability reads them) and its tone; palette,
  typefaces, type scale, spacing and radii (read from the code first, ask only what it does not say).

## 7. Close

- Tell the person to commit `.ai1/` (and the moves, if any) and `.claude/settings.json`, and to restart
  the Claude Code session so the hooks and skills load with the new configuration.
- Do not commit on your own.
- In one line, tell them that ai1 skills can be customized for this project (committed) or only for
  them: `ai1 skill-context --list` shows which ones, and /ai1:core-customize-skill writes it.

## Fixed rules

- The files are written by the `ai1` CLI, never by hand.
- Each feature's own setup only after a yes; do not commit on your own.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context core-setup-repo` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context core-setup-repo`
