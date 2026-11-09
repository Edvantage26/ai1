---
name: ai1-retro
description: Retro of ai1's own hooks across every repo on this machine - errors, likely false positives, slow or context-heavy modules, modules that never fire - with concrete fixes proposed for ai1. Only for the ai1 repo. Use when the person says "haz la retro", "retro de los hooks", "cómo se están portando los hooks", "qué falla en ai1", "revisa los logs de ai1", "ai1 retro", or about once a week while ai1 is being developed.
---

# ai1 retro

ai1 logs every module run in every repo where it is active (`ai1 log`, metadata only). This skill reads
those logs from all repos on this machine, from here, so hook problems are looked at where ai1 is
fixed and never shown in the other repos. Errors are also offered as issues in the repo where they
happen (the `issue-offer` hook); the retro covers what needs judgement.

## 1. Read the logs

```bash
node bin/ai1 log --all --since 168 --json   # the last week; --since <hours> to change it
```

Use `node bin/ai1` from this repo (the installed `ai1` may be older). Per repo and module it gives
runs, decisions, ms, characters added, errors by signature, the rules behind asks, and what the person
answered to each ask (`asks`: approved / refused / unknown, read from the session transcripts). Logs of
repos unused for 7 days are already gone (state files expire), so a quiet repo simply does not appear.

## 2. Sort the findings

Go through every repo and module and keep only what calls for a change in ai1:

| Kind | Signal | What to propose |
|---|---|---|
| Error | any `errors` entry | read the file and line of the signature, reproduce it in a test, fix it; if it came from an issue, link it |
| Likely false positive | a module or rule with 5+ asks and 80%+ approved | find the shape behind it (the rule id, the tool), propose a narrower rule, a better default or an `ignore_rules` example; never just drop the guard |
| Refused often | many `refused` | the guard is doing its job; check its message helps the agent take the right path |
| Slow | avg above 20 ms, or a max far above the average | profile the module; caches and incremental scans are the usual fix |
| Context-heavy | high `chars` per run on SessionStart / UserPromptSubmit | shorter text, or only when something changed (the prompt cache pays for every changed byte) |
| Never fires | an enabled module with only `allow` in a week of real use | fine for guards; for briefs and recalls, ask whether it is needed |

Unknown outcomes (no transcript) are not evidence either way; say how many there were.

## 3. Report and propose

Show the person a short table: repo, module, finding, evidence (the numbers), proposed change (file
and test). Most important first: errors, then false positives, then cost. Then ask which to do.

- Apply nothing without a yes. Each accepted fix follows this repo's rules: a worktree, a test that
  fails before the fix, `npm test`, the OKF concept of the module updated.
- A finding too large for one session: offer to note it down for later (`/ai1:later-write`).
- Never paste repo paths or names from other repos into anything public (issues, commits, the bundle):
  describe the shape, not the project.
