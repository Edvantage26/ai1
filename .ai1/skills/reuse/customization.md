- A development script that encapsulates repeated work goes in `scripts/<name>.mjs`, in Node with no
  dependencies (the repo's rule: no second language, nothing to install), with its entry in
  `package.json` (`npm run <name>`), its test in `test/` and a mention in the OKF concept of the
  feature it serves, so the next person finds it where they add to that feature.
