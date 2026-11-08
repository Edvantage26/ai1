# Vendored dependencies

Bundled so the OKF scripts run with the system `python3` (3.9+) and nothing else: no `uv`, no
`pip install`, no network.

| Package | Version | Source | sha256 of the sdist | License |
|---|---|---|---|---|
| `yaml/` (PyYAML, pure-Python part of `lib/yaml`) | 6.0.3 | https://pypi.org/project/PyYAML/6.0.3/ | `d76623373421df22fb4cf8817020cbb7ef15c725b9d5e45f17e189bfc384190f` | MIT (`yaml/LICENSE`) |

The scripts add this folder to `sys.path` only when it exists, so an environment that installed
PyYAML itself (e.g. `uv run`) keeps working. The C accelerator (`_yaml`) is not included;
`yaml.cyaml` fails to import and PyYAML falls back to pure Python by design.
