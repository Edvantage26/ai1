---
name: ideas-brainstorm-topic
description: >-
  Ideas — Brainstorm with the person on a problem, an innovation or a software architecture, grounding
  ideas on how others did it (web, and scientific papers when the topic needs them), generating from
  several angles and converging to a few explained options. Use when the person says "hagamos un
  brainstorming", "lluvia de ideas", "ideas para innovar en", "qué arquitectura usamos para",
  "¿cómo podríamos…?", "dame opciones para", "let's brainstorm", "ideas for", "explore options for".
  Not for designing one chosen direction into a build plan (that is /ai1:sizing-design-before-code).
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *) Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" papers *)
---

# Brainstorm grounded in research

Goal: many diverse ideas first, grounded in what others already tried, then a few the person can
choose from with their reasons and sources. You are a creative partner: you bring ideas too. If the
person wants only to be asked ("solo pregúntame", "facilitate"), you only ask and record.

LLM ideas tend to be novel but less feasible, repeat each other (most of a large batch are
duplicates) and LLM judges rank them barely better than chance. So: research grounds them, several
angles spread them, deduplication trims them, and **the person decides**, never you.

## 1. Open the brainstorm

Pick a slug `brainstorm-<topic>` and create `.ai1/work/<slug>/plan.md` (an existing one with that slug:
read it and `ideas.md`, and resume where they say). The sizing plan machinery lists it and puts it
back in context after a compaction:

```markdown
---
title: "Brainstorm: <topic in a few words>"
size: plan
status: active
---
# Goal
<what the person wants to get out of it, in their words>
# Kind
<problem | innovation | architecture | scientific | business>
# Constraints and criteria
<what any idea must respect; how the good ones will be chosen>
# Phase
<frame | research | diverge | converge> - next move: <one line>
```

and `ideas.md` next to it: one line per idea, `- [ ] I<n> <idea> (angle: <x>; source: <link or "own">)`,
marked `[x]` kept or `[-]` rejected with the reason after converging. Update **Phase** whenever it
changes and add every idea as it appears, yours and the person's.

## 2. Frame (one question at a time)

Read first what the repo, the knowledge bundle and the conversation already answer; never ask that.
Then ask only what would change which ideas are good, one question per message, starting with *why*
they want it: the goal, who it is for, the constraints (budget, team, time, stack, regulation) and
how a good idea will be judged. Goals before options: do not show ideas while framing. Name the
**kind** of brainstorm and the techniques you will use ([techniques.md](techniques.md)); the person can
change them.

## 3. Research before generating

Write the topic as queries that do not name the project, then hand them to one subagent with this
brief: "Find how others approached this: 3-6 sources, primary first (maintainers' docs, engineering
write-ups and post-mortems, well-known repositories, competitors' products), each with date and
link; plus 2 analogies from other fields that share the same constraints, not only the vocabulary.
Agreement between independent sources is signal; vendor pages overstate, post-mortems understate.
Return the approaches, who uses each, what went well or wrong; no page dumps." If no web search
tool is available, say so and mark what follows as not checked.

When the kind is scientific, or the topic rests on research results (an algorithm, a model, a
measurable effect), also run

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" papers search "<query in English>"            # OpenAlex, all fields
"${CLAUDE_PLUGIN_DATA}/bin/ai1" papers search "<query>" --source semantic-scholar   # CS and biomedicine
```

and cite papers only from its output (title, year, DOI or URL), never from memory. A 429 means the
free shared budget ran out: say so, and that a free key in `OPENALEX_API_KEY` /
`SEMANTIC_SCHOLAR_API_KEY` lifts it.

Bring back in a few lines what was found, with links, and **one finding the conversation has not
touched yet**. Do the same later whenever a new angle appears: research it before answering.

## 4. Diverge

Generate from the angles of the kind ([techniques.md](techniques.md)), several of them, never one:
for a wide topic, one subagent per angle in parallel, each given the plan, the research summary and
its angle, asked for "6 ideas, each with how likely you think a typical answer is (0-1); include
some unlikely ones". Ask the person for theirs too. Add every idea to `ideas.md`; no judging in this
phase. Keep going while ideas keep being new; switch angle when they start to repeat.

## 5. Converge

When the person asks to choose, or ideas stop being new:

1. Merge duplicates (same mechanism, different words) and say how many were merged.
2. Check every idea against the constraints; reject with a one-line reason each, kept in `ideas.md`.
3. For scientific ideas, check novelty with `ai1 papers search`: an idea already published is
   reported as such, with the paper.
4. Rank the rest by the kind's criteria comparing them in pairs (is A better than B for this goal?),
   not with absolute scores.
5. Show the top 3: what it is, why it fits, the main risk, the evidence (links), and what would test
   it cheaply. Then the person chooses; record it under **Phase** as `chosen: I<n> - <why>`.

## 6. Close

Set `status: done` in the plan once the person has chosen or stops. Offer in one line what comes
next, done only on a yes. A chosen direction to build here is sized like any task: a clear,
contained one becomes a plan (`.ai1/work/<slug>/plan.md`, `size: plan`, naming this folder); one with
design choices or a risky area goes to `/ai1:sizing-design-before-code`, which starts its design
from this folder (the chosen idea as direction, the runners-up as approaches, the research already
done). An architecture or product decision worth keeping goes
to the knowledge bundle with `/ai1:okf-maintain-knowledge`.

## Fixed rules

- On demand only: never start a brainstorm on a task the person did not ask to brainstorm.
- The person chooses; you rank and argue, never decide.
- Every claim about what others did carries a link; papers come only from `ai1 papers search` output.
- No idea is dropped silently: rejected ones keep their reason in `ideas.md`.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context ideas-brainstorm-topic` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context ideas-brainstorm-topic`
