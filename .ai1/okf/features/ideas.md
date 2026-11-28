---
type: Component
title: ideas feature
description: /ai1:ideas-brainstorm-topic runs a brainstorm on demand (problem, innovation, software architecture, scientific, business) grounded in web research and, for scientific topics, papers from `ai1 papers search`; ideas kept in .ai1/work/<slug>/ so they survive compaction; the person chooses.
tags: [ideas, brainstorming, research, papers, skills, cli]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-28T06:53:55Z'
sources:
  - id: skill
    resource: skills/ideas-brainstorm-topic/SKILL.md
    title: /ai1:ideas-brainstorm-topic
  - id: techniques
    resource: skills/ideas-brainstorm-topic/techniques.md
    title: Techniques by kind of brainstorm
  - id: papers
    resource: src/ideas/papers-search.mjs
    title: ai1 papers search
  - id: tests
    resource: test/papers-search.test.mjs
    title: Tests of ai1 papers search
---

Built 2026-11-28. The person wanted a brainstorming mode that, while the conversation explores the
best solution, keeps looking on the internet for how others did it, adapts to the subject and
searches scientific papers when the topic needs it; "no son solo para problemas, también para
innovar o diseños de arquitectura de software".

- **On demand only.** ai1 rejected forced brainstorming on every task ([sizing](sizing.md),
  [prior art](../decisions/prior-art.md)); the route is the description plus one line in
  `/ai1:sizing-design-before-code` that offers it when the direction itself is still open. Boundary:
  the brainstorm explores and chooses a direction, the design skill turns the chosen one into a plan.
- **Flow.** Frame (one question at a time, goals before options, the kind named) -> research (one
  subagent, primary sources, analogies that share the constraint; papers only for scientific topics)
  -> diverge (several angles from `techniques.md`, ideas asked with their likelihood for diversity)
  -> converge (merge duplicates, a reason for every rejection, novelty check for scientific ideas,
  pairwise comparison, top 3 with evidence) -> the person chooses; hand-off to the design skill or to
  the bundle as a decision, on a yes.
- **State.** `.ai1/work/brainstorm-<topic>/plan.md` with `size: plan`, `status: active`, so the
  sizing brief lists it and re-injects it after a compaction with no new hook; `ideas.md` next to it
  holds every idea with its angle, source and kept/rejected reason.
- **`ai1 papers search "<q>" [--source openalex|semantic-scholar] [--limit 10] [--json]`.** Web fetch
  passes pages through a summarizing model, so DOIs and abstracts can be lost or invented; the CLI
  prints the API's fields as they are (title, year, authors, venue, DOI/URL, citations, 400-char
  abstract). OpenAlex by default (no key, every field, indexes arXiv and PubMed; abstracts rebuilt
  from its inverted index); Semantic Scholar on request. One source per call, so no merging. 15 s
  timeout; any failure exits 1 with `no source answered - <source>: <reason>`.
- **Keys.** Without a key OpenAlex shares a $0.10/day budget per IP (~100 searches) and Semantic
  Scholar's shared pool answers 429 often (both seen live 2026-11-28; a burst got a 429 from OpenAlex
  too). Optional free keys come from the environment (`OPENALEX_API_KEY`, `SEMANTIC_SCHOLAR_API_KEY`),
  never from a file; no contact email is sent.
- **Why each step** (research behind it in [prior art](../decisions/prior-art.md#brainstorming-and-idea-generation-2026-11-28)):
  LLM ideas are more novel but less feasible than experts', mostly duplicate at scale, and LLM judges
  rank them near chance (Si et al. 2024), so research grounds them, angles spread them, dedup trims
  them and the person decides.

Validate: `npm test` (`test/papers-search.test.mjs` stubs the fetch; `test/ideas-brainstorm-topic.test.mjs`
pins the skill text); live, `ai1 papers search "retrieval augmented generation" --limit 2`.
