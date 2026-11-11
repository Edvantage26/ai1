---
name: verify-evaluate-llm-prompts
description: Verify — Evaluate and improve an LLM step (extraction, classification, judge, verifier) with evidence before blaming the model - start simple; if it fails, find the cause of each failure, then compare models or prompts as a tournament. Use when writing, iterating or comparing prompts or models, when someone says "el modelo falla", "el LLM se equivoca", "prueba otro modelo", "compara modelos", "mejora el prompt", "el juez no es fiable", "why does the model fail", "try a better model", "compare models", "improve this prompt", or when a bigger model is proposed to fix errors.
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Evaluate LLM prompts with evidence

Most "the model got it wrong" turns out to be the pipeline around it: what the model saw, what it was
told, or how the test was built. A bigger model hides those causes and costs more. The effort grows
with the trouble: start simple, and go further only when the simple version is not good enough.

One case set runs through it all: the 10 to 20 cases of step 1 seed the **dev** set, which grows to
20 to 100 (hard cases included) as you iterate.

## 1. Start simple

1. A first prompt that states the task, its rules and the vocabulary or schema it must use, with the
   whole unit of context (checklist in step 2), on one reasonable, cheap model.
2. Run it on 10 to 20 real cases and read every output. Without labels, check them yourself or with a
   fresh-context subagent (see "Labels").
3. Good enough for what it is used for: stop, note the prompt, model and result, build nothing more.
   Not good enough, or a wrong answer is costly: step 2.

## 2. Diagnose the failures before blaming the model

Checklist:
- **Context**: does the model see everything a person would need to do it right? The whole unit (the
  full section, not a page or a cut), and the related items that live with it (siblings in the same
  section, not ones passed in from elsewhere).
- **Instructions**: does the prompt state every rule you expect it to follow? Are there examples of the
  hard cases?
- **Vocabulary and schema**: does it get the names, terms and schema it must use, with descriptions?
  Without them it invents names.
- **Test setup**: units start at a full sentence or section, not mid-sentence; the output schema is
  specific enough to fill (a too generic one comes back empty); answers parse; the same data for every
  model.
- **Reference labels**: are they reliable? Settle doubtful ones against the source; the reviewer may
  have judged without the full context.

Method:
1. **Read every failure**, input and output, not just the metric.
2. **Log each one** in a failure log (a file or a table):

   | case | output | note | failure mode | cause | evidence |
   |---|---|---|---|---|---|

   `note`: free text on the first thing that went wrong. `failure mode`: what fails, grouped from the
   notes once you have read a batch. `cause`, from this fixed list: `context` | `instructions` |
   `vocabulary/schema` | `test setup` (cuts, parsing, schema, data) | `wrong reference label` |
   `model limit`. Show the person about 10 failures with their notes before fixing the failure modes.
   Stop reading when new cases bring no new failure modes.
3. **Count causes**, fix the most frequent, re-run the **same** dev cases. Repeat.
4. **Only when the first five causes are ruled out**, compare models (step 4).

## 3. Measure while you iterate

- **Test set**: once you iterate or choose, keep 20 to 30 % of the cases apart as **test**, never used
  to choose or iterate; the final choice is confirmed on it once. A large dev-test gap means you tuned
  to the dev set.
- **Noise**: run the dev cases 2 or 3 times to see how much one run varies (even at temperature 0).
- **Record each run**: exact model version (pinned, not "latest"), prompt version, cases, settings.
- **Budget**: state the cost limit of each run first; a testing API key, never the production one.
- **Metric**: the outcome that matters (the verdict the rule produces), not the literal text. Pass/fail
  checks rather than 1-5 scales ("4 of 5 facts present"); report the share of cases that pass every
  check. Parse failures counted apart, not as model errors.

## 4. Choose models or prompts: a tournament

1. **Round 1**: every candidate on the current dev cases.
2. **Each round**: drop only the clear losers, then grow the set (double it, say) for the survivors.
   All survivors run the same cases; earlier cases stay in.
3. **Compare paired** against the current leader, on the cases where the two disagree. Drop a
   candidate only when the leader wins at least this many of those cases (exact sign test, p < 0.05):

   | disagreements | 6 | 8 | 10 | 12 | 15 | 20 |
   |---|---|---|---|---|---|---|
   | leader wins at least | 6 | 8 | 9 | 10 | 12 | 15 |

   With 5 or fewer disagreements nobody is dropped: it stays one more round.
4. **Cost**: among the candidates you cannot tell apart from the best, keep the cheapest.
5. **Stop** when one is left, the rest cannot be told apart (take the cheapest) or the budget runs out.
   Close finalists get 2 or 3 format variants of the prompt before one is dropped: formatting alone
   can swing a score. Confirm the winner once on the test set.
6. **One variable at a time**: a tournament of models uses one prompt; of prompts, one model.

## 5. Labels, judges and confidence signals

- **Labels**: a domain expert decides what is correct; with several labellers, measure their agreement
  and settle the criteria first.
- **Without expert labels**: a labelling subagent with fresh context (not the session that wrote the
  prompt) labels **blind** - the full source unit, no candidate output, no model names -, quotes the
  source for each label and marks the doubtful ones. Not the candidates' model; better, two labellers
  from different families, their disagreements to the person. The person checks 10 to 20 at random
  plus every doubtful one before use; conclusions say "against agent labels, N checked by a person".
- **Judges**: a check in code wherever one works. Otherwise one judge per failure mode, validated
  against checked labels and reported by how many real failures it catches (TPR) and how many good
  outputs it passes (TNR), not by agreement, which looks high when failures are rare. Judges favour
  the first option, the longer answer and their own model family: no judging its own family, swap the
  order in pairwise comparisons.
- **Confidence signals** (stated confidence, self-consistency, a cheap judge, a decision model's
  probability): not a trigger until measured to separate right from wrong on your data; they often do
  no better than chance.

## Keep what you learn

The failure log and the rounds stay with the experiment; the result and the lessons (causes, what fixed
them, which model and why) go to the project knowledge (the OKF bundle if there is one). In production,
sample real traces now and then and re-run the dev set on every change of the pipeline.

## Why

In a real extraction pipeline, rounds were lost on more expensive models and almost no failure was the
model's: missing context, unstated rules, no vocabulary (34 % of names right without it, 95 % with
it), a badly built test, wrong labels; confidence signals scored like chance. Method: the error
analysis of Hamel Husain and Shreya Shankar; the tournament is successive halving with paired tests.

## Fixed rules

- Start simple; the full method only when the simple version is not good enough.
- No change of model before the failures have been read and each given a cause.
- The same cases and setup for every candidate; the test set only confirms, never chooses.
- Labels and judges are checked before they are trusted: agent labels blind and sampled by the person,
  judges against checked labels.
- Test runs use a testing key and a stated budget, never a production key.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context verify-evaluate-llm-prompts` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context verify-evaluate-llm-prompts`
