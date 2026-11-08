# CLAUDE.md

`jig` is a **public** Claude Code plugin (and its own marketplace) that gives any repo guardrails, a
verification gate and project memory, configured per repo with `.claude/jig.json`. Full spec and
phases in [PROJECT.md](PROJECT.md).

## Knowledge (OKF)

OKF v0.2. Read `.okf/index.md` first and follow the links to the relevant concepts. After a change
that affects a documented asset (contract, module, decision, roadmap), update its concept body and
`generated: { by: <agent>/<version> or human:<id>, at: <ISO 8601> }`. Add a dated `.okf/log.md` entry
only for lifecycle events (created, deprecated, superseded, regenerated, verified). Validate with the
OKF validator in `--strict` mode (`python3 packs/okf/skills/validate/scripts/okf_validate.py .okf --strict`).

## Rules for this repo

- **Public repo**: never commit secrets, internal hostnames, client names or Edvantage-specific
  infrastructure. Those belong in a private pack, not here.
- **Hooks**: plain Node or POSIX shell, zero dependencies, no network calls. Fail open on internal
  errors; fail closed only on matched production writes.
- **Never grant the agent git permissions** (commit/push) from the plugin.
- Every module ships with tests; run `npm test` and `claude plugin validate .` before committing.
- Adding a module: one file (with its `feature`), one line in `src/core/registry.mjs`, its entry in the schema.
- `packs/okf/` is a git subtree: never edit it here; change the fork and `git subtree pull` (see `.okf/packs/okf-pack.md`).
- Keep `.claude-plugin/plugin.json` and `marketplace.json` versions in sync; tag releases.
- README describes only what exists; anything not built yet is marked *planned*.

## Layout

- `.claude-plugin/` manifests · `hooks/hooks.json` wiring
- `bin/jig-hook.mjs` entry point · `bin/jig` CLI · `src/core/` runtime · `src/context/`, `src/okf/`, `src/guards/` modules
- `skills/init/` `/jig:init` · `skills/worktree/` `/jig:worktree` (engine in `src/worktrees/`) · `packs/okf/` vendored OKF toolkit
- `schema/`, `templates/` the jig.json contract · `test/` node:test suite
