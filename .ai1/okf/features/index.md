# Features

* [okf](okf.md) - project knowledge: index, upkeep, OKF skills.
* [craft](craft.md) - code craft rules at session start; where things live stays in the bundle.
* [design](design.md) - UI rules at session start and deterministic design checks on edited UI files (ideas from Impeccable).
* [verify](verify.md) - Stop gate: no finishing with code newer than the last passing verify run; `ai1 verify`, `ai1 step-done`.
* [lanes](lanes.md) - quick / plan / deep lanes by task size, with a hook-enforced approval gate.
* [worktrees](worktrees.md) - a worktree per change (any edit to the repo files), with a per-project recipe planned once and saved as the project skill; `ai1 worktree`.
* [proposals](proposals.md) - undecided changes and future features in `.ai1/proposals/`, apart from the bundle until decided, created only on request or acceptance; `/ai1:proposals-write`, `ai1 proposals`.
* [/ai1:core-setup-repo and the CLI](init.md) - per-repo setup.
* [session fork](session-fork.md) - `/ai1:session-fork-conversation` and `ai1 fork`: full or brief fork of the conversation, opened natively per host.
* [issue report](issue-report.md) - `/ai1:core-report-issue` and `ai1 issue`: a problem with ai1 filed on its public repo, cleaned of private data and approved by the person; offered by the `issue-offer` hook when ai1 itself fails.
* [retro](retro.md) - `ai1-retro`, a project skill of the ai1 repo only: every repo's hook log on this machine, read for errors, false positives and cost.
