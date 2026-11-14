# Vendored dependencies

Bundled so the OKF toolkit (`ai1 okf validate|init|visualize` and the okf-upkeep hook) runs on Node
alone: no `npm install`, no network.

| Package | Version | Source | Integrity of the npm tarball | License |
|---|---|---|---|---|
| `js-yaml/js-yaml.mjs` (`dist/js-yaml.mjs` of the package, unchanged) | 4.1.0 | https://www.npmjs.com/package/js-yaml/v/4.1.0 | `sha512-wpxZs9NoxZaJESJGIZTyDEaYpl0FKSA+FB9aJiyemKhMwkxQg63h4T1KJgUGHpTqPDNRcmmYLugrRjJlBtWvRA==` | MIT (`js-yaml/LICENSE`) |

`src/okf/okf-yaml.mjs` wraps it with the schema the OKF toolkit reads frontmatter with (YAML 1.1
booleans, timestamps kept as text, a duplicate key keeps the last value).
