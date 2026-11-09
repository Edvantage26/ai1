---
name: verify-debug-systematically
description: Verify — Find the root cause of a bug, a failing test or unexpected behaviour before changing code, and stop after repeated failed fixes. Use when a test fails, something behaves unexpectedly or a bug is reported ("no funciona", "falla el test", "sigue fallando", "why does this break", "debug this"), when ai1/fix-loop says several fix attempts in a row have failed, or when the person says "deja de adivinar", "stop guessing", "¿estamos atascados?".
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Debug systematically

A fix without the cause is a guess, and guesses pile up: each one can hide the bug or move it. Find
the cause first; then one fix, proven by a test.

## 1. Investigate the cause

- Read the whole error: message, stack, the first failing assertion, not just the last line.
- Reproduce it reliably, with the smallest command (one test, one request). If it does not reproduce
  every time, that is a finding: look for timing, order or shared state.
- Check what changed: `git diff`, `git log -p` on the files involved, recent dependency updates.
- Trace the bad value back to where it is created, through each boundary (function, process, API,
  database), instead of patching where it shows up.

## 2. Compare with something that works

Find a similar case that works (another test, another input, the last good commit) and list every
difference. `git bisect` when a commit broke it.

## 3. One hypothesis at a time

Write it down in one sentence ("the cache keeps the old value because..."), make the smallest
change or measurement that can prove it wrong, and look. Wrong: drop it, back to step 1 with what
you learned. Several changes at once teach nothing.

## 4. Fix with a test

A test that fails for the reason found, then the fix, then the test passes, then the full suite.
Fix the cause, not the symptom; if the same bad input can come from elsewhere, check there too.

## Red flags: go back to step 1

| You are about to... | Instead |
|---|---|
| try a fix "to see if it works" | name the cause it addresses |
| change several things at once | one change, one check |
| skip the failing test | write it first |
| add a sleep or retry to a flaky test | wait for the condition the test needs (poll with a timeout) |
| try "one more" fix after two failed | stop and question the approach |

## After repeated failed fixes

After 3 failed attempts in a row (ai1/fix-loop counts them and tells you), stop patching. Each fix
that fails somewhere new points to a wrong assumption or a design problem, not a missing tweak. Tell
the person what you tried, what each attempt showed and what you now think the cause is, and agree
on the next step before another fix.

When the cause teaches something about the system (how a component really behaves, a trap), record
it in the knowledge bundle.

## Fixed rules

- No fix without a stated cause; no fix without a test that failed first.
- After 3 failed fix attempts in a row, stop and talk to the person before another fix.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context verify-debug-systematically` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context verify-debug-systematically`
