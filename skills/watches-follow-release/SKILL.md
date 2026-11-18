---
name: watches-follow-release
description: >-
  Watches — Follow something just shipped to production with a watch: a check that it is up or the
  count of successes and failures since the release, plus the person's confirmation that they tried
  it. Use after a release or deploy when ai1/watches reminds you, or when the person says "vigila
  esto en producción", "avísame si falla", "¿está funcionando en prod?", "follow this release",
  "watch this in production", or asks about a watch they follow.
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Follow what was shipped to production

Shipping is not the end: the goal is that the system confirms the release works in production, that the
person tried it and it works for them, and - when it is something that happens again and again - how many
times it succeeded and whether any failed.

A **watch** (`.ai1/watches/<id>.json`, committed) says how it is checked. Each person **subscribes** for a
while (their ignored `.ai1/local/`); `ai1 watch run` records results and totals; the session start says
in one line only what changed.

## 1. Offer it, in one line

Right after the release, say what shipped and offer to follow it, e.g. "Esto ya está en producción.
¿Lo sigo unos días para confirmar que funciona y cuántas veces va bien o falla?". Nothing is created
without a yes. If the person says no, drop it for this release.

## 2. Pick how to check it

Look in the code and the knowledge bundle for what the release touched and how its use can be seen from
here (a health endpoint, a log query, a database count, a CLI of the platform). Choose with the person:

- **Health** - is it up: a command whose exit code says it (`curl -fsS <url>/health`).
- **Counts** - something that happens repeatedly (payments, sign-ups, a job): a command that prints, as
  its last line, `{"succeeded": n, "failed": m}` for the events since `$AI1_WATCH_SINCE` (an ISO date ai1
  puts in its environment). Write it as a small script in the repo when a one-liner is not enough.
- **Agent** - needs judgment (read the logs and say whether there are new errors): a prompt; you follow it
  when it is due and record the outcome with `ai1 watch record <id> ok|fail "<what you saw>"`.

Prefer a list of arguments (`--run-json '["node","scripts/checkout-stats.mjs"]'`) over a shell line: it
runs the same on Linux, macOS and Windows. Secrets never go in the watch: the command reads them the way
the repo already does (environment, the person's password manager CLI).

Run the command once yourself before saving it, and show the person its output.

## 3. Save it and subscribe

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" watch add <id> --title "<what>" (--run-json '[...]' | --run "<command line>" | --prompt "<what to check>") [--counts] [--every 1d] [--for 14d]
```

`add` subscribes the person (until `--for`, 14 days by default); `--no-subscribe` only writes the
definition. Teammates follow it with `ai1 watch subscribe <id>`. Tell the person to commit
`.ai1/watches/<id>.json`; `.ai1/local/` is theirs and never committed. Checks run with
`ai1 watch run --due` - offer that when the session start says a check is due, or let the person run it
from their own scheduler.

## 4. Ask for their confirmation

Once they have tried it in production, ask: "¿Lo has probado en producción y te funciona?". On a yes:
`ai1 watch confirm <id> "<what they tried>"`. Until then the session start reminds you, at most once a day.

## 5. Report

`ai1 watch list` shows each watch: who follows it until when, the totals since the release
("6 ok, 2 failed since 2026-11-18") or the checks, and whether the person confirmed it. When a check
fails, say it plainly with the last output, and offer to look into it.

## Fixed rules

- Never create, subscribe or run a watch without the person's yes; the release reminder only asks you to offer.
- No secrets in `.ai1/watches/`: it is committed.
- Results and confirmations are recorded only by `ai1 watch run|record|confirm`, never written by hand.
- A watch follows a release for a while; checks that must run forever belong in the project's monitoring.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context watches-follow-release` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context watches-follow-release`
