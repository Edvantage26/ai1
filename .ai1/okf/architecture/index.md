# Architecture

* [Plugin layout](plugin-layout.md) - plugin + marketplace in one repo, install paths.
* [.ai1/config.json contract](harness-contract.md) - per-repo configuration read by the hooks.
* [Features](features.md) - what a repo chooses; one feature per module.
* [Profiles](profiles.md) - deprecated, replaced by features.
* [Hook runtime](hook-runtime.md) - dispatcher, module contract, failure policy.
* [Skill customization](skill-customization.md) - project and person overlays injected into ai1 skills, `ai1 skill-context`, the customization index.
* [Decision log](decision-log.md) - every module run logged locally (metadata only), read with `ai1 log`.
