# Decisions

* [Prior art: take ideas, not code](prior-art.md) - Superpowers, rsc-harness, rsc-factory; knowledge bundles and their evidence (2026-11-16).
* [Design principles](principles.md) - mechanisms over prompts, no surprises on the user's machine.
* [Skill customization](skill-customization.md) - one mechanism, project and person scopes, customizable by default with justified exclusions (later 0001).
* [All features on by default](all-features-on.md) - opt-out config (version 2), migration of old configs, basic modes refined by the project (2026-11-13).
* [Harness guards](harness-guards.md) - config-guard, test-guard, repo rules, credential deny rules and the decision log (later 0002-0006).
* [The person within a project](person-in-project.md) - local by default in `.ai1/local/`, team facts committed (maintainers, watches, contacts), sealed sync on request with `node:crypto` only (2026-11-18).
* [Host tooling stays out of the plugin](host-tooling-out-of-plugin.md) - generic options (`--open-command`, `--claude-command`) plus the person's customization; no agent-manager code in ai1.
* [Project operations](project-operations.md) - an Operations concept per project and its gap category in ai1; the person's infrastructure in their own skills, a plugin only to share them (2026-11-22).
* [Stack](stack.md) - the person's usual pieces (and their plugins'), chosen per project in the interview and kept as `stack.md` (2026-11-22).
