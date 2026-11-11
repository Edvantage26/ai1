---
name: core-report-issue
description: Core — Report a problem with ai1 itself (a hook that blocks or misfires, a wrong message, a skill or `ai1` command that fails, a missing feature) as an issue on the public Edvantage26/ai1 repository - gathers the versions and features, writes a minimal reproduction with nothing private in it, checks for duplicates, and creates it only after the person approves the exact text. Use when the person says "esto de ai1 va mal", "reporta un bug del plugin", "abre un issue en ai1", "report this to ai1", "file a bug against the harness", or when ai1 behaves wrongly and they want the maintainers to know.
---

# Report an issue on ai1

The issue goes to **github.com/Edvantage26/ai1, a public repo**: whatever you publish is visible to
anyone and stays indexed even if deleted. Never create it without the person's yes to the exact text,
except in auto mode below.

## Auto mode (`AI1_REPORT_ERRORS=auto`)

Only when the `issue-offer` hook says the person chose automatic reports of ai1's own errors:

1. `ai1 issue auto-body` prints the title (first line) and the body. Use them **exactly**: they hold
   only versions, OS, features and the errors' module, class and plugin file:line. Add nothing - no
   description, no context from the session or the repo. Anything more needs the normal flow below.
2. Look for a duplicate (step 2): if the same module and error are already reported, comment instead
   (`gh issue comment <n> -R Edvantage26/ai1 --body "Seen again on ai1 <version>."`).
3. Otherwise create it (step 5, `--label bug`), with the body written to a file first.
4. Tell the person in one line what was filed or commented, with the link.

Only for problems with ai1 (its hooks, skills, `ai1` CLI, config). A bug in the person's own code
or in Claude Code is not an ai1 issue: say so instead.

## 1. Gather the facts

```bash
ai1 issue env
```

It prints the ai1, Claude Code and Node versions, OS, host and this repo's enabled features (no
paths). If it reports config entries unknown to this version, the plugin is probably out of date:
suggest `claude plugin update ai1@ai1` and a restart first, and report only if the problem stays.

From the conversation, take what went wrong: which hook, skill or command (the `ai1/<module>`
prefix of a hook message names it), the exact message, what the agent or person was doing, and
what was expected. Ask the person only for what is missing; one question at a time.

When ai1 itself failed (a module threw, the hook crashed), `ai1 issue env` lists those errors under
"ai1 errors in this repo": module, error class and the plugin file and line, how often and when.
Quote them in the reproduction; they hold nothing private. This is also how the agent is told to offer
a report (the `issue-offer` hook), once per error and version.

For a hook that misfires or is slow, `ai1 log --since 2` shows what each module decided and how
long it took (metadata only: module, event, decision, ms, characters added; no commands or paths).
Quote the lines of the module at fault.

## 2. Look for a duplicate

```bash
gh issue list -R Edvantage26/ai1 --state all --search "<2-4 key words>" --limit 10
```

If one matches, show it and propose a comment on it (`gh issue comment <number> -R Edvantage26/ai1
--body-file <file>`) instead of a new issue. Skip this step if `gh` is not installed or not logged in.

## 3. Write the draft

Write it to `.ai1/work/issue-<slug>.md` (git-ignored) or the temp dir in a repo without `.ai1/`:

```markdown
## What happened
One or two sentences, with the exact message in a code block.

## Expected
What should have happened.

## To reproduce
Minimal steps on a generic repo: the config needed, the command or edit that triggers it.

## Environment
<output of ai1 issue env>
```

Title: short and specific, prefixed with the module (`sizing: gate blocks a quick task after ...`).

**Clean it before showing it.** Replace or remove: absolute paths and user names (`/home/<user>/...`
-> `<repo>/...`), hostnames, IPs, URLs and names of private services, company or client names,
tokens, keys and any secret, and code or file contents from the person's repo beyond the minimum
that reproduces the problem (rewrite it generically). When in doubt, leave it out and ask.

## 4. Approve

Show the person the title and the full body, say it will be public, and ask: create, edit or
cancel. Apply edits and show it again.

## 5. Create it

With `gh` logged in (`gh auth status`):

```bash
gh issue create -R Edvantage26/ai1 --title "<title>" --body-file <draft> --label bug
```

Use `--label enhancement` for a missing feature; if the label is refused (no triage rights), retry
without `--label`. Without `gh`:

```bash
ai1 issue url --title "<title>" --body-file <draft>
```

It prints a prefilled "new issue" link for the person to open and submit; when the body is too long
for a link it carries only the title and the person pastes the body from the file.

Report the issue URL. Delete the draft afterwards.
