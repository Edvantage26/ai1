# Features

* [okf](okf.md) - project knowledge: index, upkeep, OKF skills.
* [craft](craft.md) - code craft rules at session start; where things live stays in the bundle.
* [design](design.md) - UI rules at session start and deterministic design checks on edited UI files (ideas from Impeccable).
* [verify](verify.md) - Stop gate: no finishing with code newer than the last passing verify run; `ai1 verify`, `ai1 step-done`.
* [lanes](lanes.md) - quick / plan / deep lanes by task size, with a hook-enforced approval gate.
* [worktrees](worktrees.md) - a worktree per significant change, with a per-project recipe planned once and saved as the project skill; `ai1 worktree`.
* [rfc](rfc.md) - proposals and future features in `.ai1/rfc/`, apart from the bundle until decided; `/ai1:rfc-write-proposal`, `ai1 rfc`.
* [/ai1:core-setup-repo and the CLI](init.md) - per-repo setup.
* [session fork](session-fork.md) - `/ai1:session-fork-conversation` and `ai1 fork`: full or brief fork of the conversation, opened natively per host.
