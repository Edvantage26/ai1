# PROJECT — ai1

## Goal

A public, generic harness for coding agents (Claude Code first), distributed as a Claude Code plugin
that is also its own marketplace. It gives any repo guardrails, a verification gate and project
memory, configured per repo through `.ai1/config.json`.

## Context and origin

Born from professionalizing an internal document-processing backend, where the rules ("never write to prod", "run
the regression test before calling a change done", "keep `.okf/` updated") existed only as text in
`CLAUDE.md`. The same rules apply to dozens of other repos with a similar stack, and almost none enforce them.

Prior art reviewed (2026-10-30):

- **Superpowers** (obra): 14 method skills + one SessionStart hook. Strong methodology and evals of
  skills, but enforcement is prompt-only.
- **rsc-harness** (Eric Risco, MIT): memory/hands/trade/reflexes, three lanes (answer, FTD, ASDD = Agent Spec-Driven Development),
  hooks in Claude Code, refuting reviewers. Too large to install as is (269 skills), auto-updates from
  npm each session and grants `git commit`/`git push` without asking.
- **rsc-factory** (gregoryjp, unofficial): a PRD-to-product engine outside the agent. Out of scope;
  useful later for a pipeline mode.

Decision: take ideas, not code; keep `ai1` small, readable and enforcement-first.

## Architecture

```
ai1/
├── .claude-plugin/plugin.json        plugin manifest
├── .claude-plugin/marketplace.json   the repo is its own marketplace (source "./")
├── hooks/hooks.json                  every event -> node bin/ai1-hook.mjs <Event>
├── bin/ai1-hook.mjs                  single entry point (stdin JSON in, decision JSON out, exit 0)
├── src/core/                         dispatcher, config, registry, hook-io, shell-parse
├── src/core/features.mjs             feature registry (okf, danger, core)
├── src/context/                      SessionStart modules (brief)
├── src/okf/                          okf feature: okf-index (SessionStart), okf-upkeep (Stop)
├── src/design/                       design feature: design-brief (SessionStart), design-detect (PostToolUse)
├── src/guards/                       PreToolUse modules (danger; planned: prod, secrets)
├── src/cli/ + bin/ai1                setup CLI (ai1 status / ai1 init)
├── skills/core-setup-repo/                      /ai1:core-setup-repo
├── packs/okf/                        OKF toolkit, git subtree of Edvantage26/okf-skills
├── schema/ai1.schema.json        contract for editors
├── templates/config.json            contract example
└── test/                             node:test suite, run in CI on Node 18/20/22
```

Module contract: `{ id, event, feature, description, toolNames?, run(context) -> decision }`.
Decisions: `allow`, `ask`, `deny`, `block` (Stop), `context` (SessionStart). Detail in
`.ai1/okf/architecture/hook-runtime.md`.

### Per-repo contract: `.ai1/config.json`

| Field | Meaning |
|---|---|
| `version` | Contract version (`1`) |
| `features.<id>` | `true`/`false` per feature (`okf`, `danger`: on by default) |
| `trunk` | Protected branch name |
| `verify` | Commands that must pass before the agent calls a change done |
| `knowledge` | Path of the OKF knowledge bundle (default `.ai1/okf`) |
| `modules.<id>` | `true`/`false`, or an options object for that module |

## Technical decisions

- **Hooks in Node or POSIX shell, zero dependencies.** They run on every tool call; startup cost and
  supply-chain risk must stay minimal.
- **Fail open on internal errors** (a broken hook must never brick the shell), **fail closed on
  matched production writes**.
- **No network, no auto-update, no git permissions granted.** Updates come only through the
  marketplace.
- **Knowledge format: OKF**, so the bundle is readable by humans, agents and other tools.

## Phases

1. **Core + first guard** (done 2026-10-30): dispatcher, config, schema, `brief`, `danger`, tests, CI,
   verified in real Claude Code sessions.
2. **Features, okf feature and `/ai1:core-setup-repo`** (done 2026-10-31): per-repo features replace profiles;
   OKF toolkit vendored as `packs/okf`; okf-index/okf-upkeep; `ai1` CLI. Verified in real sessions.
3. **`prod` and `secrets` guards** (proposal: [RFC 0001](.ai1/rfc/0001-prod-and-secrets-guards.md)).
4. **`verify` Stop gate** (done 2026-11-08).
5. **`ai1 doctor`** (proposal: [RFC 0002](.ai1/rfc/0002-ai1-doctor.md)).
6. **Method skills + reviewers**: `ftd`, `verify`, `review`, finding verifier (proposal:
   [RFC 0003](.ai1/rfc/0003-method-skills-and-reviewers.md)).

Planned features are kept as RFCs in `.ai1/rfc/` (the `rfc` feature, on in this repo) until they are
decided; see [.ai1/rfc/README.md](.ai1/rfc/README.md).

After each increment the plugin is tried in real repos of different shapes (a document-processing
backend, a web product, a small service). The contract is frozen once three of them run it. An
optional private pack for company-specific checks stays outside this public repo.
