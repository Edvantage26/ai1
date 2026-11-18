---
type: Architecture
title: The person within a project (.ai1/local, maintainers, sealed sync)
description: A third configuration scope next to the project and the person - the person within one project - kept in the repo's ignored .ai1/local/, with their role from the committed maintainers list, the state ai1 writes for them, and an optional sealed copy in the repo that only their key opens (node:crypto only).
tags: [architecture, person, local, maintainers, seal, crypto, cross-platform]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T16:52:08Z'
sources:
  - id: person-project
    resource: src/core/person-project.mjs
    title: .ai1/local, git email, role
  - id: person-seal
    resource: src/core/person-seal.mjs
    title: Sealing with node:crypto
  - id: seal-command
    resource: src/cli/seal-command.mjs
    title: ai1 keys, ai1 local seal|unseal
  - id: setup-repo
    resource: src/cli/setup-repo.mjs
    title: ai1 init --role
  - id: tests
    resource: test/person-project.test.mjs
    title: Role and local folder tests
---

Built 2026-11-18 ([decision](../decisions/person-in-project.md)). Until then ai1 had two scopes: the
project (committed, for everyone) and the person (`~/.config/ai1/`, in every repo). Some things are
neither: a person's role, subscriptions, contacts and the state ai1 keeps for them **in one project**.

# Where things live

| What | Where | Committed |
|---|---|---|
| Who maintains ai1 here | `maintainers` in `.ai1/config.json` (git emails) | yes |
| Watch definitions | `.ai1/watches/<id>.json` ([watches](../features/watches.md)) | yes |
| The project's contacts | `.ai1/okf/people/contacts.md` ([messages](../features/messages.md)); never in a public repo | yes |
| The person's role here, muted tasks | `.ai1/local/profile.json` | no |
| Their subscriptions | `.ai1/local/subscriptions.json` | no |
| Their routines | `.ai1/local/routines.json` ([routines](../features/routines.md)) | no |
| Their relation and tone with each contact | `.ai1/local/contacts.md` | no |
| What ai1 writes for them (notices, results) | `.ai1/local/state.json` | never, not even sealed |
| Their sealed copy (optional) | `.ai1/contributors/<email>.sealed` | yes, by them |
| Their sealing key | `~/.config/ai1/identity.key` (`$XDG_CONFIG_HOME/ai1/`) | never |

The sealed copies live in `.ai1/contributors/` (renamed from `people/` before release, 2026-11-18): it holds
the data of those who work in the repo, apart from the project's contacts in `.ai1/okf/people/`.

`.ai1/local/` lives in the **main checkout** (the `sharedRoot` of the
[hook runtime](hook-runtime.md)), so every worktree shares it, and ignores itself with its own
`.gitignore` (`ensureDirectoryIgnoredByItself`, now in `src/core/project-paths.mjs`, also used for
`.ai1/work/`). A new clone starts empty unless the person unseals.

# Role

`resolvePersonRole` (`src/core/person-project.mjs`): `profile.json` `role` (`maintainer` |
`developer`) wins; otherwise, without a `maintainers` list everyone is a maintainer (what ai1 did
before the list), with a list the person is a maintainer when their `git config user.email` is in it
(compared lower-cased). No email with a list: developer. The email is read once per process
(`tryGit`, several SessionStart modules ask). It is a selector, not an identity: anyone can set it.

`ai1 init --role maintainer` adds the email to `maintainers` (creating the list makes everyone else a
developer by default); `--role developer` writes only the local profile. `/ai1:core-setup-repo` asks
"¿Quieres llevar este plugin como arquitecto o solo como desarrollador?". `ai1 status` shows the role
and where it came from. Maintainers get the [maintenance tasks](../features/maintenance.md).

# Sealed sync

For the person who wants their local files in other clones: `ai1 keys init` writes an X25519 key
(PKCS#8 DER, one base64 line) and prints it once to keep in a password manager; `ai1 keys import`
reads it from stdin on another machine. `ai1 local seal` puts `profile.json`, `subscriptions.json`,
`contacts.md` and `routines.json` (those present) as JSON into `.ai1/contributors/<email>.sealed`; `ai1 local unseal` writes the
missing ones back and refuses to replace a different one without `--force`.

Format `ai1-sealed-v1`: an ephemeral X25519 key per seal, ECDH with the person's public key, HKDF-SHA256
(salt: both public keys, info `ai1-seal-v1`), AES-256-GCM with a random 12-byte nonce; header lines,
then base64 in 64-character lines. The reader ignores CR, so git's `autocrlf` on Windows cannot break it
(no `.gitattributes` needed). Another key fails with "this file was sealed for another key: only its
owner can open it". Only `node:crypto`, bundled with Node on every platform; no age, sops or gpg (the
person asked for nothing external). Not the SSH key: Node cannot read OpenSSH keys without a parser,
and passphrase keys need bcrypt.

# Automatic sync

Asked by the person on 2026-11-18 ("algo que sea más automático"). Once they sealed in a repo (their
`.ai1/contributors/<email>.sealed` exists) or ran `ai1 local sync on`, ai1 keeps both sides in step by
itself; `ai1 local sync off` stops it (`profile.json` `sealedSync`), `ai1 local sync status` says which.

- The last agreed point is two fingerprints in `state.json` `sealedSync`: the local files (CRLF
  normalised) and the sealed file (CR removed). `ai1 local seal|unseal` record it too.
- `local-sync-stop` (Stop, core): local files changed since that point -> sealed again, left for the
  person to commit.
- `local-sync-start` (SessionStart, core): the sealed file changed since that point (a pull) -> unsealed
  into `.ai1/local/`.
- Both changed: nothing is overwritten; the person gets one message (`systemMessage`, never the agent's
  context: no tokens) to choose `ai1 local seal` or `ai1 local unseal --force`. A machine without the key,
  or a key that does not open it, is told once too.
- Cost: no git call unless `.ai1/contributors/` exists or the person turned it on; a fingerprint is
  ~0.04 ms, a seal ~1.2 ms, an unseal ~0.5 ms (20 KB, measured 2026-11-18).

Risks said to the person at `ai1 keys init`: a lost key loses the data; a leaked key opens every
sealed version in the history.

# Validate

`node --test test/person-project.test.mjs test/person-seal.test.mjs`: roles (listed, case, no list,
no email, profile override), init writes the list once, a committed fixture (`test/fixtures/person-seal/`,
a test-only key) opens with LF and CRLF, another key and a tampered file are refused, seal on one clone
and unseal on another with the imported key.
