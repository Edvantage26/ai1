# CLAUDE.md

`ai1` is a **public** Claude Code plugin (and its own marketplace) that gives any repo guardrails, a
verification gate and project memory, configured per repo with `.ai1/config.json`. The spec,
decisions and roadmap live in the OKF bundle (`.ai1/okf/`); there is no PROJECT.md in this repo.

## Knowledge (OKF)

OKF v0.2. Read `.ai1/okf/index.md` first and follow the links to the relevant concepts. After a change
that affects a documented asset (contract, module, decision, roadmap), update its concept body and
`generated: { by: <agent>/<version> or human:<id>, at: <ISO 8601> }`. Add a dated `.ai1/okf/log.md` entry
only for lifecycle events (created, deprecated, superseded, regenerated, verified). Validate with the
OKF validator in `--strict` mode (`python3 skills/okf-validate-bundle/scripts/okf_validate.py .ai1/okf --strict`).

## Rules for this repo

- **Public repo**: never commit secrets, internal hostnames, client names or Edvantage-specific
  infrastructure. Those belong in a private pack, not here.
- **Hooks**: plain Node or POSIX shell, no npm dependencies, no network calls. A system tool (`git`,
  `python3`) only when optional, with a timeout, failing open when missing, and telling the person once
  when that turns a check off. Per-tool-call hooks stay in milliseconds; heavy work goes to the CLI.
  Skill scripts may use another runtime from the README requirements, dependencies vendored; no third
  language. Fail open on internal errors; fail closed only on matched production writes. See
  `.ai1/okf/decisions/principles.md`.
- **Never grant the agent git permissions** (commit/push) from the plugin.
- Every module ships with tests; run `npm test` and `claude plugin validate .` before committing.
- Adding a module: one file (with its `feature`), one line in `src/core/module-index.mjs`, its entry in the schema.
- Skills live in `skills/<module>-<action>/`: Claude Code names a plugin skill by its folder. The OKF toolkit (`skills/okf-*`, `agents/`, `vendor/`) is ours now (see `.ai1/okf/packs/okf-pack.md`); keep `THIRD-PARTY.md` in sync.
- Adding a skill: its entry in `src/core/skill-customization-index.mjs` (customizable, with its scopes, or not and why); a customizable one gets the `allowed-tools` permission, a `## Fixed rules` section and the `skill-context` injection as last line (the coherence test checks it; see `.ai1/okf/architecture/skill-customization.md`).
- Keep `.claude-plugin/plugin.json` and `marketplace.json` versions in sync; tag releases.
- README describes only what exists; anything not built yet is marked *planned*.

## Layout

- `.claude-plugin/` manifests · `hooks/hooks.json` wiring
- `bin/ai1-hook.mjs` entry point · `bin/ai1` CLI · `src/core/` runtime · `src/context/`, `src/okf/`, `src/guards/` modules
- `skills/core-setup-repo/` `/ai1:core-setup-repo` · `skills/core-report-issue/` + `ai1 issue` (`src/cli/issue-command.mjs`) · `skills/worktrees-plan-recipe/` `/ai1:worktrees-plan-recipe` (engine in `src/worktrees/`) · `skills/session-fork-conversation/` + `ai1 fork` (`src/session/`) · `skills/walkthrough-record-flow/` + `ai1 walkthrough` (`src/walkthrough/`) · `skills/okf-*/` `agents/` `vendor/` OKF toolkit
- `schema/`, `templates/` the .ai1/config.json contract · `test/` node:test suite
