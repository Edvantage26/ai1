# CLAUDE.md

`ai1` is a **public** Claude Code plugin (and its own marketplace) that gives any repo guardrails, a
verification gate and project memory, configured per repo with `.ai1/config.json`. The spec,
decisions and roadmap live in the OKF bundle (`.ai1/okf/`); there is no PROJECT.md in this repo.

## Knowledge (OKF)

OKF v0.2. Read `.ai1/okf/index.md` first and follow the links to the relevant concepts. After a change
that affects a documented asset (contract, module, decision, roadmap), update its concept body and
`generated: { by: <agent>/<version> or human:<id>, at: <ISO 8601> }`. Add a dated `.ai1/okf/log.md` entry
only for lifecycle events (created, deprecated, superseded, regenerated, verified). Validate with the
OKF validator in `--strict` mode (`node bin/ai1 okf validate .ai1/okf --strict`).

## Rules for this repo

- **Cross-platform**: Linux, macOS and Windows. Paths with `node:path`/`os.homedir()`, no shell where Node does it, `chmod` best effort, byte-exact files as text or `binary` in `.gitattributes`; new code touching paths, files or processes gets its tests on a `windows-latest` CI job. See `.ai1/okf/decisions/principles.md`.
- **Public repo**: never commit secrets, internal hostnames, client names or Edvantage-specific
  infrastructure. Those belong in a private pack, not here.
- **Hooks**: plain Node or POSIX shell, no npm dependencies, no network calls. A system tool (`git`)
  only when optional, with a timeout, failing open when missing, and telling the person once
  when that turns a check off. Per-tool-call hooks stay in milliseconds; heavy work goes to the CLI.
  Skill scripts are Node too (`ai1` subcommands), dependencies vendored in `vendor/`; no second
  language. Fail open on internal errors; fail closed only on matched production writes. See
  `.ai1/okf/decisions/principles.md`.
- **Never grant the agent git permissions** (commit/push) from the plugin.
- Every module ships with tests; run `npm test` and `claude plugin validate .` before committing.
- Adding a module: one file (with its `feature`), one line in `src/core/module-index.mjs`, its entry in the schema, its description and origin in `src/core/readme-index.mjs` (then `npm run readme-tables` for the Hooks table of the README).
- Skills live in `skills/<module>-<action>/`: Claude Code names a plugin skill by its folder. The OKF toolkit (`skills/okf-*`, `src/okf/okf-{validate,init,visualize}.mjs`, `vendor/`) is ours now (see `.ai1/okf/packs/okf-pack.md`); keep `THIRD-PARTY.md` in sync.
- Designing a new skill or reviewing how the skills fit: the project skill `ai1-skill-design` (route, neighbours, fit map).
- Adding a skill: its entry in `src/core/skill-customization-index.mjs` (customizable, with its scopes and `hints`, or not and why); a customizable one gets the `allowed-tools` permission, a `## Fixed rules` section and the `skill-context` injection as last line (the coherence test checks it; see `.ai1/okf/architecture/skill-customization.md`). Also its origin in `src/core/readme-index.mjs` (written in ai1, imported from or based on which projects), then `npm run readme-tables` to refresh the Skills table of the README (a test fails when it is out of date).
- Keep `.claude-plugin/plugin.json` and `marketplace.json` versions in sync; tag releases.
- README describes only what exists; anything not built yet is marked *planned*.

## Layout

- `.claude-plugin/` manifests · `hooks/hooks.json` wiring
- `bin/ai1-hook.mjs` entry point · `bin/ai1` CLI · `src/core/` runtime · `src/context/`, `src/okf/`, `src/guards/` modules
- `skills/core-setup-repo/` `/ai1:core-setup-repo` · `skills/core-report-issue/` + `ai1 issue` (`src/cli/issue-command.mjs`) · `skills/worktrees-plan-recipe/` `/ai1:worktrees-plan-recipe` (engine in `src/worktrees/`) · `skills/session-fork-conversation/` + `ai1 fork` (`src/session/`) · `skills/storyboard-record-flow/` + `ai1 storyboard` (`src/storyboard/`) · `skills/reuse-encapsulate/` + `ai1 reuse` (`src/reuse/`) · `skills/watches-follow-release/` + `ai1 watch` (`src/watches/`) · `skills/messages-draft-message/` + `ai1 contacts` (`src/messages/`) · `skills/routines-set-routine/` + `ai1 routine` (`src/routines/`) · `ai1 maintain` (`src/maintenance/`) · `.ai1/local/` and `ai1 keys|local` (`src/core/person-*.mjs`) · `skills/okf-*/` + `ai1 okf` (`src/okf/`) `vendor/` OKF toolkit
- `schema/`, `templates/` the .ai1/config.json contract · `test/` node:test suite
