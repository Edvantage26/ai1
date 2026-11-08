# Edvantage fork

This is Edvantage's fork of [scaccogatto/okf-skills](https://github.com/scaccogatto/okf-skills)
by Marco Boffo (MIT). The original `LICENSE` and `NOTICE` apply unchanged; the vendored OKF
specification is (c) Google LLC under Apache 2.0.

## Install from this fork

```text
/plugin marketplace add Edvantage26/okf-skills
/plugin install okf@edvantage-okf
```

## Remotes

- `origin`: this fork. All Edvantage changes land here.
- `upstream`: the original, fetch only. Bring changes in with `git fetch upstream` and a merge or
  cherry-pick, reviewed like any other change.

## Tests (no CI on this fork)

GitHub Actions are not enabled on this fork, so nothing runs on push. Before pushing, run:

```bash
# shipped scripts with only the vendored PyYAML (-S hides any system pyyaml)
for test_file in tests/test_okf_validate.py tests/test_okf_stop_hook.py tests/test_okf_backfill_events.py; do
  python3 -S "$test_file" || exit 1
  uv run --no-project --python 3.9 python "$test_file" || exit 1   # minimum supported Python
done
uvx ruff@0.16.10 check .
claude plugin validate .
```

Enable Actions only when merging a large upstream change; if you do, disable the `release` and
`Dependabot auto-merge` workflows first (they only make sense in the upstream repo).

## Versioning

`plugin.json` carries the upstream version plus `-edv.<n>`, e.g. `0.12.0-edv.1`. Bump `<n>` on every
fork change so installed plugins pick it up with `claude plugin update okf@edvantage-okf`; after a
merge from upstream, restart at `<new upstream version>-edv.1`.

## Fork changes

Keep this list current so a merge from upstream knows what to preserve.

| Date | Change | Files |
|---|---|---|
| 2026-10-30 | Marketplace renamed to `edvantage-okf`, owner Edvantage (plugin author unchanged) | `.claude-plugin/marketplace.json` |
| 2026-10-30 | This file | `FORK.md` |
| 2026-10-30 | `--migrate` keeps plain-text citations as `sources` and leaves prose ("Related: ...") in the body under `# Related`; upstream kept only Markdown links and deleted the rest of the section | `skills/validate/scripts/okf_validate.py`, `tests/test_okf_validate.py` |
| 2026-10-30 | Version `0.12.0-edv.1` (fork versioning scheme) | `.claude-plugin/plugin.json` |
| 2026-10-31 | MCP server `bundle` no longer starts with the plugin: `.mcp.json` moved to `servers/mcp.json` (the e2e test and CI read it from there). Claude Code already has Read/Grep, so the server only added a process per session. To re-enable it, move the file back to the plugin root | `servers/mcp.json`, `tests/test_okf_mcp_e2e.py`, `.github/workflows/ci.yml` |
| 2026-10-31 | Version `0.12.0-edv.2` | `.claude-plugin/plugin.json` |
| 2026-10-31 | Scripts run with the system `python3` (3.9+), no `uv`: PyYAML 6.0.3 vendored in `vendor/yaml` (loaded only if present), `datetime.UTC` replaced by `timezone.utc`, skills/agent/help texts call `python3` instead of `uv run`. On upstream merges keep `python3` in those lines | `vendor/`, `skills/*/scripts/*.py`, `skills/*/SKILL.md`, `agents/event-analyzer.md` |
| 2026-10-31 | Lint target `py39` (tests stay `py311`), `vendor/` excluded | `ruff.toml` |
| 2026-10-31 | Version `0.12.0-edv.3` | `.claude-plugin/plugin.json` |
| 2026-11-08 | Skill names prefixed with their module and self-explanatory (`okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle`, `okf-backfill-from-history`); directories keep their upstream names. Descriptions start with "OKF — ". `okf` and `backfill` accept a bundle path named by a harness (e.g. `.ai1/okf/`). On upstream merges keep the `name:` lines and the `/okf:<name>` references | `skills/*/SKILL.md`, `README.md`, `templates/CLAUDE-okf.md`, `.okf/`, `docs/self.html` |
| 2026-11-08 | Version `0.12.0-edv.4` | `.claude-plugin/plugin.json` |
