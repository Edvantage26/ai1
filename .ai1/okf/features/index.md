# Features

* [okf](okf.md) - project knowledge: index, upkeep, OKF skills.
* [craft](craft.md) - code craft rules at session start; where things live stays in the bundle.
* [design](design.md) - UI rules at session start and deterministic design checks on edited UI files (ideas from Impeccable).
* [verify](verify.md) - Stop gate: no finishing with code newer than the last passing verify run; `ai1 verify`, `ai1 step-done`.
* [sizing](sizing.md) - each task sized quick / plan / deep, with a hook-enforced approval gate for deep designs.
* [worktrees](worktrees.md) - a worktree per change (any edit to the repo files), with a per-project recipe planned once and saved as the project skill; `ai1 worktree`.
* [later](later.md) - undecided changes and future features noted down for later in `.ai1/later/` ("later 0003"), apart from the bundle until decided, only on request or when picked in an offer; `/ai1:later-write`, `ai1 later`. Called `proposals` until v0.24.
* [/ai1:core-setup-repo and the CLI](init.md) - per-repo setup.
* [session fork](session-fork.md) - `/ai1:session-fork-conversation` and `ai1 fork`: full or brief fork of the conversation, opened natively per host.
* [issue report](issue-report.md) - `/ai1:core-report-issue` and `ai1 issue`: a problem with ai1 filed on its public repo, cleaned of private data and approved by the person; offered by the `issue-offer` hook when ai1 itself fails.
* [storyboard](storyboard.md) - storyboard of the user flow after a visual change (steps, screenshots, before/after, local URL, PDF) in `.ai1/storyboards/`; `/ai1:storyboard-record-flow`, `ai1 storyboard`.
* [retro](retro.md) - `ai1-retro`, a project skill of the ai1 repo only: every repo's hook log on this machine, read for errors, false positives and cost.
