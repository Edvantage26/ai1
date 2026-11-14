# Third-party code

| What | Where in ai1 | Origin | License |
|---|---|---|---|
| OKF toolkit: skills `okf-maintain-knowledge`, `okf-validate-bundle`, `okf-visualize-bundle` (their scripts rewritten in Node as `ai1 okf validate`, `init` and `visualize`, with the viewer page in `templates/okf-viz.html`) | `skills/okf-*/` (all but `okf-tidy-claude-md`, written in ai1), `src/okf/okf-validate.mjs`, `okf-init.mjs`, `okf-visualize.mjs`, `templates/okf-viz.html` | [scaccogatto/okf-skills](https://github.com/scaccogatto/okf-skills) by Marco Boffo, through a fork that is now retired; imported at fork version `0.12.0-edv.4` and maintained here since | MIT, [licenses/okf-skills-LICENSE](licenses/okf-skills-LICENSE) and [NOTICE](licenses/okf-skills-NOTICE) |
| Open Knowledge Format v0.2 specification | `skills/okf-maintain-knowledge/reference/SPEC.md` | Google LLC | Apache 2.0, `skills/okf-maintain-knowledge/reference/APACHE-2.0.txt` |
| Cognitive load checklist and working memory rule (two sections of Impeccable's critique rubric) | `skills/design-review-usability/reference/cognitive-load.md` | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) by Paul Bakaus, `.claude/skills/impeccable/reference/critique-rubric.md` at commit `1995764b`; header added, headings re-levelled | Apache 2.0, [licenses/impeccable-LICENSE](licenses/impeccable-LICENSE) |
| js-yaml 4.1.0 (`dist/js-yaml.mjs`) | `vendor/js-yaml/` | [npmjs.com/package/js-yaml](https://www.npmjs.com/package/js-yaml/v/4.1.0) | MIT, `vendor/js-yaml/LICENSE` (details in [vendor/README.md](vendor/README.md)) |
