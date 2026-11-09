# Third-party code

| What | Where in ai1 | Origin | License |
|---|---|---|---|
| OKF toolkit: skills `okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle`, `okf-backfill-from-history`, agents `bundle-weaver`, `event-analyzer`, and their tests | `skills/okf-*/` (all but `okf-tidy-claude-md`, written in ai1), `agents/`, `test/okf-toolkit/` | [scaccogatto/okf-skills](https://github.com/scaccogatto/okf-skills) by Marco Boffo, through a fork that is now retired; imported at fork version `0.12.0-edv.4` and maintained here since | MIT, [licenses/okf-skills-LICENSE](licenses/okf-skills-LICENSE) and [NOTICE](licenses/okf-skills-NOTICE) |
| Open Knowledge Format v0.2 specification | `skills/okf-maintain-knowledge/reference/SPEC.md` | Google LLC | Apache 2.0, `skills/okf-maintain-knowledge/reference/APACHE-2.0.txt` |
| PyYAML 6.0.3 (pure-Python part) | `vendor/yaml/` | [pypi.org/project/PyYAML](https://pypi.org/project/PyYAML/6.0.3/) | MIT, `vendor/yaml/LICENSE` (details in [vendor/README.md](vendor/README.md)) |
