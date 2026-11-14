---
name: design-review-usability
description: >-
  Design — Check that a UI flow is intuitive for the profile of user who will use it, not only that it
  works: an agent that knows only the profile and the goal tries the task in the browser, then every
  step is walked with the cognitive-walkthrough questions; findings by severity, on the storyboard. Use
  when the person asks "¿es intuitivo?", "¿lo entenderá un <perfil>?", "revisa la usabilidad",
  "pruébalo como un usuario", "revisa el comportamiento de la interfaz", "is this intuitive",
  "usability review", "test it as a user would", or accepts the offer after a storyboard.
allowed-tools: Bash("${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context *)
---

# Review a flow as its user would

**Goal:** find where the people this flow is for would get lost, before anyone real sees it. Tests say
the code works; this says whether *this* user understands what to do. The agent that built the UI knows
where everything is, so it cannot judge that alone: an agent that knows only the profile does the task.

## 1. Who uses it (the profile)

- Read the `## Users` section of the knowledge concept of type `Product` (and of `PRODUCT.md` at the
  repo root, if present). Each `### <name>` is one profile: who they are, what they already know,
  device, what they come to do.
- No profile, or none that uses this flow: ask the person, in one message, who uses it (role, what
  they know of the domain and of apps like this, device, what they come to do). Record the answer as a
  `### <name>` under `## Users` in the `Product` concept (create the concept if missing, with
  /ai1:okf-maintain-knowledge) before going on.
- Review with the main profile of the flow; with up to 3 when the person names them or the flow is
  shared by clearly different users.

## 2. The goals and the flow

- Write 1-3 goals in the user's words ("reservar una cita para el jueves por la tarde"), never in
  the code's words. Each goal has a clear end the user would recognise.
- The steps: the storyboard's steps if the flow has one (`ai1 storyboard list`; ids in its
  `steps.json`); else write the 3-10 steps the user should take, as in /ai1:storyboard-record-flow.
- Start the app the project's way (in a worktree: `ai1 worktree run <name> <command>`) and note the URL
  where the user would start, not a deep link that skips the first steps.

## 3. The user-agent (observed, not judged)

For each profile, launch one subagent (your Agent tool, general-purpose) with only this brief, filled
in, and nothing else: no code, no repo paths, no step captions, no hints about where things are.

> You are <profile text, word for word>. You are using a web app for the first time. Your goal:
> <goal>. Start at <URL>, in a new browser tab of your own, viewport <1440x900 | 375x812>. Act only
> through what you see on screen, as this person would: do not read the page source, do not use
> developer tools, do not guess URLs. Before each action write one line: what you are looking for,
> what you will do, what you expect. After it, one line: what happened. Stop when the goal is done,
> after 25 actions, or when this person would give up; say which. Return the numbered trace, every
> moment you hesitated or went back, every word you did not understand, and in one line how sure you
> are that the goal was done.

- Run the profiles one after another when the browser tool cannot hold two sessions at once.
- Read the trace yourself. Each hesitation, wrong click, going back, misread word or give-up is a
  candidate finding, tied to the step where it happened.

## 4. Walk every step yourself

For each step, with the profile in mind, answer the four cognitive-walkthrough questions:
1. Will this user try to do the right thing here (do they know this is the next move)?
2. Will they notice that the right control is there?
3. Will they connect that control with what they want to do (its words, icon, place)?
4. After acting, will they see that it worked and that they are closer to the goal?

Then, on each screen: the words (the user's vocabulary or the team's: jargon, internal names, codes),
the states (loading, empty, error, success: is each one there and clear?), a way back or to undo, a
confirmation before what cannot be undone, touch targets and reading on mobile, and the cognitive load
checklist in `reference/cognitive-load.md` (≤4 options at a decision point).

## 5. Findings

Merge what the user-agent did and what the walk found. Each finding: step, profile, severity, what the
user runs into (observed or judged: say which), and one fix proposed.

- **P0** the user cannot finish the goal. **P1** they hesitate or err and recover. **P2** extra effort
  or doubt that does not stop them. **P3** polish.
- Fewer, solid findings beat a long list: drop what this profile would not notice.
- If the flow has a storyboard: `ai1 storyboard note --clear`, then for each finding
  `ai1 storyboard note --step <step-id> --severity P<n> --text "<what the user runs into>" --profile <name> --fix "<fix>" [--viewport mobile]`,
  then `ai1 storyboard build --pdf` and give the person the URL (`ai1 storyboard serve`).
- Without a storyboard: the findings go in your report, by step; offer to record the storyboard.
- Report: the profiles and goals tried, whether each goal was done (and in how many actions), the
  findings by severity, and what was fine. Say that the findings are synthetic and that P0 and P1 are
  worth confirming with one real person of that profile.
- When /impeccable is installed and the person wants a deeper review of one screen (heuristics,
  visual hierarchy), point to `/impeccable critique`; this skill is about the flow and its user.

## 6. Fixes

Propose the fixes; apply none until the person says which. After applying them, run the user-agent
again on the goals that had P0 or P1 findings and say whether they went away.

## Fixed rules

- The user-agent never sees the code, the repo, the storyboard captions or hints: only the profile, the
  goal, the start URL and the viewport.
- Every finding is labelled synthetic in the report and on the storyboard; never present it as what
  real users did.
- No code change from this skill until the person says which fixes to apply.
- No review without a profile: ask the person and record it first.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context design-review-usability` and apply what it prints.

!`"${CLAUDE_PLUGIN_ROOT}/bin/ai1" skill-context design-review-usability`
