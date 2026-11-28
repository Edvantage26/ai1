# Techniques by kind of brainstorm

Pick 3-5 angles for the kind; mix in one from another kind when ideas start to repeat. Every kind
can use the common angles at the end.

## Problem (something to solve or fix)

- **First principles**: what is strictly required? Rebuild from there, ignoring how it is done today.
- **Contradiction (TRIZ)**: "improve X without worsening Y": separate in time, space or scale; make
  the harmful part useful.
- **Inversion**: how would we make it worse or fail? Then avoid each cause.
- **How might we…**: restate the problem as 3-5 different questions; each opens other ideas.
- Converge by impact against effort, and what can be tried cheaply first.

## Innovation (a new product, feature or opportunity)

- **Jobs to be done**: what is the person really trying to get done, and what do they hire today?
- **Analogies from other fields**: who solved the same constraint elsewhere (logistics, games,
  biology, finance)? The analogy must share the constraint, not just the words.
- **SCAMPER on what exists**: substitute, combine, adapt, modify, put to other use, eliminate,
  reverse.
- **Flip a constraint or a trend**: what if it were free, instant, offline, 100x bigger, regulated?
- Research competitors and adjacent markets. Converge by new / useful / feasible.

## Software architecture

- **Quality attributes first**: scale, latency, availability, cost, data consistency, security, the
  team's skills, how it is operated. Rank them with the person before any option.
- **Option grid (morphological)**: one row per part (storage, compute, messaging, interface,
  deployment), several options per row; combine across rows into candidate architectures.
- **Reference architectures and known patterns** for this kind of system; what the maintainers of
  the main candidates recommend and where they say it breaks.
- **Failure-first**: for each candidate, how it fails under load, partial outage or data growth;
  read post-mortems of systems that used it.
- **Simplest thing that works** as one candidate, always, to compare against.
- Papers only for research-grade topics (consensus, indexing, ML serving). Converge by trade-off
  against the ranked quality attributes; record the chosen option and the discarded ones with
  their reasons, as a decision.

## Scientific

- **Literature chain**: how the question evolved (`ai1 papers search`, newest and most cited), and
  what the last step left open.
- **Assumption breaking**: what does the field take for granted? What if it were false?
- **Analogies across disciplines** with the same structure (same equations, same constraints).
- **Novelty check** of each kept idea against the literature before ranking.
- Converge by novelty, feasibility and how cheaply it can be tested.

## Business

- **Customer and value**: who pays, for what, and what they use today instead.
- **Constraint flipping** and **analogies** from other industries' business models.
- **Six thinking hats** to evaluate the shortlist: facts, feelings, risks, benefits, alternatives,
  process.
- Converge by impact against effort or by new / useful / feasible.

## Common angles

- Pain and friction: what annoys people most today?
- Removal: what if we dropped a step, a part, a role?
- Leverage: what small change would compound over time?
- Extremes: the cheapest, the most luxurious, the fastest, the most private version.
