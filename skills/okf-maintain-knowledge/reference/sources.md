# Reading sources other than the repo's code

Open the section of the source you are about to read, when producing or maintaining a bundle.

## Git history (the why the code no longer shows)

Only when creating the bundle or when asked; keep it light.

- The why of a decision is also in docstrings, design docs and the warnings of CLAUDE.md files,
  often more than in commits.
- A short history: read `git log --oneline --no-merges` whole and open at most ~20 commits
  (`git show --stat <sha>`): the largest, those touching dependencies, configuration or the
  architecture, and those whose message says why, instead, replace, drop or revert.
- A long one (thousands of commits): list the candidate decisions first (from those docs and what
  you saw while documenting), then `git log --grep` or `git log -S` per candidate.
- Several repositories: cite a commit as `git:<repo>@<sha>`. Cite the code a decision is about with
  `role: evidence`.
- A big decision whose why nobody can find: list it at the end of `decisions/index.md` for the person.

## A branch the checkout does not have

`git archive origin/<branch> | tar -x -C <tmp dir>` reads the deployed branch without switching the
checkout.

## The project's MCP servers

Their code and their read-only tools say how the team really operates the system (which tables, keys,
containers and checks). Contrast the operations, data and monitoring concepts with them and use their
read-only tools as live checks. If one does not start, read its code and say so.

## A live database

- Say first, in one line, where you connect and with what limits.
- Catalog only (`information_schema`, `pg_catalog`), in a read-only transaction with a statement
  timeout; never read data tables.
- Document a map by domain (not table by table), the relations really declared, partitioning, and dead
  or frozen tables. Statistics are cumulative and may have been reset: "0 writes" means "none since the
  counters start", and a table that is not written may still be read.

## A live service or deploy panel

- Cite it in `sources` as a scope descriptor with the date you read it, and give the concept a
  `stale_after`: that state drifts without any commit.
- Configuration: read the variable names, never their values; confirm an absence inside the container
  (`env | cut -d= -f1`).
- Bound every live read (`--tail N`, `timeout`); if that is not enough, say what you could not check
  instead of waiting.

## A lot of code at once (tens of thousands of lines)

- Split the reading across subagents, each with a brief: revision to read, questions, paths, claims of
  the docs to verify, never copy secrets; and limits: reads inside the given paths only, no live
  systems, no MCP calls, no writes (not even in `/tmp`).
- Their reports sound equally sure when wrong: check 3–5 claims of each in the code before writing
  them, the incidents and security claims first.

## A bundle built in phases (one area at a time, each reviewed)

- Fix the whole layout up front; list in the indexes only the concepts already written (a short
  "pending" note in the root index says what comes later).
- Link only to concepts already written, and add the link when you write the target: `--strict` fails
  on a link to a missing file.
- Keep the plan of the remaining areas in a work file, not in the bundle.
- An area's overview puts its own folders in `sources`; the root overview only names them in its body,
  or the two tie. After writing, run `ai1 okf file-map` on undescribed files next to the ones you cited
  (a folder cited in a body claims all its files) and resolve the ties it warns about.
