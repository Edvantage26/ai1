# Features

* [okf](okf.md) - project knowledge: index, upkeep, OKF skills.
* [craft](craft.md) - code craft rules at session start; where things live stays in the bundle.
* [design](design.md) - UI rules at session start, deterministic design checks on edited UI files (ideas from Impeccable and Hallmark), and `/ai1:design-review-usability`: a flow tried as its user would.
* [verify](verify.md) - Stop gate: no finishing with code newer than the last passing verify run; `ai1 verify`, `ai1 step-done`.
* [sizing](sizing.md) - each task sized quick / plan / deep, with a hook-enforced approval gate for deep designs.
* [worktrees](worktrees.md) - a worktree per change (any edit to the repo files), with a per-project recipe planned once and saved as the project skill; `ai1 worktree`.
* [later](later.md) - undecided changes and future features noted down for later in `.ai1/later/` ("later 0003"), apart from the bundle until decided, only on demand (never offered); `/ai1:later-write`, `ai1 later`. Called `proposals` until v0.24.
* [reuse](reuse.md) - repeated work in this repo judged at stop, searched in this repo's own sessions and skills (`ai1 reuse search`), proposed for encapsulation or for completing an existing piece; `/ai1:reuse-encapsulate`.
* [/ai1:core-setup-repo and the CLI](init.md) - per-repo setup.
* [delegate](delegate.md) - an edit of another repo with ai1 refused and delegated to a `claude -p` session there (`ai1 delegate`, `/ai1:session-delegate-change`), stop-ask-resume; changes inside submodules seen from the superproject.
* [session fork](session-fork.md) - `/ai1:session-fork-conversation` and `ai1 fork`: full or brief fork of the conversation, opened natively per host.
* [issue report](issue-report.md) - `/ai1:core-report-issue` and `ai1 issue`: a problem with ai1 filed on its public repo, cleaned of private data and approved by the person; offered by the `issue-offer` hook when ai1 itself fails.
* [storyboard](storyboard.md) - storyboard of the user flow after a visual change (steps, screenshots, before/after, local URL, PDF) in `.ai1/storyboards/`; `/ai1:storyboard-record-flow`, `ai1 storyboard`.
* [maintenance](maintenance.md) - maintenance tasks only for the people who maintain ai1 in the repo (`maintainers`): drift and bundle health hints, periodic checks gated on days and sessions; `ai1 maintain off|snooze`.
* [watches](watches.md) - follow what was shipped to production: offered after a release, health or counts of successes and failures since it, the person's confirmation, one line at session start; `/ai1:watches-follow-release`, `ai1 watch`.
* [routines](routines.md) - the person's own periodic tasks (a skill or a prompt, every hours/days or a weekday) reminded at session start and offered here or in a new conversation; ai1's periodic maintenance as built-in routines; `ai1 routine`, `/ai1:routines-set-routine`.
* [messages](messages.md) - `/ai1:messages-draft-message`: a message to a project contact with the person's own tone; `ai1 contacts`.
* [retro](retro.md) - `ai1-retro`, a project skill of the ai1 repo only: every repo's hook log on this machine, read for errors, false positives and cost.
* [issue report](issue-report.md#triage-in-the-ai1-repo) - `triage-issues`, a project skill of the ai1 repo only: the open issues listed, sized and fixed one worktree each with `Fixes #N` (deep ones designed first).
* [skill design](skill-design.md) - `ai1-skill-design`, a project skill of the ai1 repo only: a new plugin skill that fits its neighbours and has a route by which it is offered, and a review of how the skills fit (`fit-map.mjs`).
* [ai1 config](config.md) - the person's Claude Code config (global CLAUDE.md, user skills, settings keys, ai1 customizations, stack) in a private repo ai1 copies into place on any OS and commits at every session end; `ai1 config`, `/ai1:core-setup-config`.
