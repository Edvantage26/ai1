---
type: Architecture
title: The person within a project (.ai1/local, maintainers, sealed sync)
description: A third configuration scope next to the project and the person - the person within one project - kept in the repo's ignored .ai1/local/, with their role from the committed maintainers list, the state ai1 writes for them, and an optional copy in the repo that only their keys open (their SSH keys, the ai1 key, a password) or, by choice, only compressed (node:crypto only).
tags: [architecture, person, local, maintainers, seal, crypto, ssh, cross-platform]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-19T18:42:51Z'
sources:
  - id: ssh-keys
    resource: src/core/ssh-keys.mjs
    title: ssh-ed25519 keys read with Node, converted to X25519
  - id: published-keys
    resource: src/core/published-keys.mjs
    title: The person's keys published by GitHub/GitLab (CLI only)
  - id: secret-input
    resource: src/cli/secret-input.mjs
    title: Hidden password prompt
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
| Their sealed copy (optional) | `.ai1/contributors/<email>.sealed` (encrypted) or `<email>.packed` (plain mode, only compressed) | yes, by them |
| Their ai1 key, if any | `~/.config/ai1/identity.key` (`$XDG_CONFIG_HOME/ai1/`) | never |
| That key closed with their password | `~/.config/ai1/identity-password` (also inside every `.sealed`) | never as a file |
| Their published SSH keys, last fetched | `~/.config/ai1/published-keys.json` | never |

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

For the person who wants their local files in other clones. `ai1 local seal` puts `profile.json`,
`subscriptions.json`, `contacts.md` and `routines.json` (those present) as JSON into
`.ai1/contributors/<email>.sealed`; `ai1 local unseal` writes the missing ones back and refuses to replace
a different one without `--force`.

**Any of the person's machines opens it** (issue #4, built 2026-11-19; the person: "que mi usuario git
sea desde el pc que sea pueda abrir esa config", without memorising anything as the main path, without
an extra repo and without linking machines). Who a seal is for:

- **Their `ssh-ed25519` keys published by their git host** (`https://github.com/<user>.keys`,
  `https://gitlab.com/<user>.keys`): fetched only by the CLI (`ai1 local sync on`, `ai1 local seal`,
  `ai1 keys published github:<user>`; when no account is set it asks `ssh -T git@github.com` /
  `git@gitlab.com`, timeout, fails open) and kept in `published-keys.json`, so the Stop hook seals for them
  with no network. A fetch replaces only the `published` recipients; a fetch failure keeps the last list.
- **Each machine's own usable `ssh-ed25519` key** (`~/.ssh/*.pub` with an unencrypted private pair),
  added at every seal as a `machine` recipient, so a machine that sealed once opens later versions by SSH.
- **The ai1 key** (`ai1 keys init|import`), optional: the machine's, else the previous file's.
- **A password**, optional fallback: `ai1 local password` closes the ai1 key with it (scrypt N=2^17,
  r=8, ~0.9 s; 12 characters minimum, empty = a generated one shown once; creates the ai1 key silently if
  there is none) into `identity-password`, copied into every sealed file. On a machine no key opens,
  `! ai1 local unlock` (hidden prompt, or stdin) brings the ai1 key back once; later sessions there never
  ask. The password never reaches the agent and is never computed in a hook.
- `ai1 local recipients` lists them; `ai1 local recipients remove <fingerprint>` reseals without one
  (older versions in history still open with it).

Keys read with Node only (`src/core/ssh-keys.mjs`): OpenSSH public lines and `openssh-key-v1` private
files with cipher `none`; Ed25519 -> X25519 as age and libsodium do (public: u = (1+y)/(1-y) mod 2^255-19;
private: SHA-512 of the seed, clamped), checked against libsodium's known answer. Not usable, and named as
such in the notice: passphrase-protected keys (would need bcrypt-pbkdf; the password covers them), RSA and
other types, keys only in `ssh-agent` or on hardware tokens.

Format `ai1-sealed-v2`: a random 32-byte file key encrypts the body with AES-256-GCM, the header lines
being its additional data (no line can be swapped); each recipient line carries that key closed for it
(ephemeral X25519 -> HKDF-SHA256, salt both public keys, info `ai1-seal-v2` -> AES-256-GCM):
`recipient: x25519 <fingerprint> <ephemeral> <closed key>` (the ai1 key),
`recipient: ssh-ed25519 <fingerprint> <public blob> <ephemeral> <closed key> published|machine`,
`identity-public: <spki>`, `identity-password: <fingerprint> <salt> <log2 N> <closed ai1 key>`; then a
blank line and base64 in 64-character lines. SSH fingerprints are the SHA-256 of the OpenSSH blob (16
hex). `ai1-sealed-v1` (one ai1-key recipient) is still read; the next seal writes v2; an unknown
`ai1-sealed-vN` says to update ai1. The reader ignores CR, so git's `autocrlf` on Windows cannot break it.
Only `node:crypto` and `node:zlib`, bundled with Node on every platform; no age, sops, gpg or ssh-keygen
(the person asked for nothing external).

**Plain mode** (the person: "que se elija si es encriptado o solo compresion", told apart "por la
extensión"): `ai1 local sync on --plain` (`profile.json` `sealedMode: "plain"`) writes
`.ai1/contributors/<email>.packed` = `ai1-plain-v1`, blank line, base64 of deflate(JSON): compressed, NOT
encrypted, opened by any clone with the person's git email and no key. It warns every time it is turned on
(ai1 cannot tell a public repo without network). Switching mode writes the new file and removes the other
in the same seal; both present (a merge) -> nothing applied, one message to keep one.

Not covered (open on issue #4): sealing needs nothing secret, so anyone with write access could commit a
file under someone else's email (in plain mode, edit theirs), as before v2.

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
  context: no tokens) to choose `ai1 local seal` or `ai1 local unseal --force`.
- `local-sync-start` opens with the ai1 key or any usable `~/.ssh` key that is a recipient, with no
  question. None: one message per sealed version naming the keys tried, a usable key that is not a
  recipient yet (and how to publish it: `gh ssh-key add`), the keys not usable here and why, and
  `! ai1 local unlock` when the file carries a password (else `ai1 keys import`).
- `local-sync-stop` seals with no ai1 key when anyone is a recipient (previous file, published list, this
  machine's key); nobody at all is told once.
- Cost: no git call unless `.ai1/contributors/` exists or the person turned it on; a fingerprint is
  ~0.04 ms, a seal ~2.2 ms with two SSH recipients, an open ~0.5 ms, listing `~/.ssh` ~0.6 ms (20 KB,
  measured 2026-11-19). No network and no scrypt in a hook.

Risks said to the person: a lost key loses the data (the password or any recipient SSH key gets it
back); a leaked key or password opens every sealed version in the history.

# Validate

`node --test test/ssh-keys.test.mjs test/person-seal.test.mjs test/published-keys.test.mjs`: the
Ed25519 -> X25519 known answer and round trips, which `~/.ssh` keys are usable and why not; v2 with
several recipients, a swapped header line or body byte refused, the v1 fixture (`test/fixtures/person-seal/`,
a test-only key) still opens and is rewritten as v2; password set, unlock once, wrong password; published
keys fetched and replaced, machine keys kept, recipients removed; the hooks for scenarios
`[seal-any-machine:S1..S5]` (plan in `.ai1/work/seal-any-machine/`); plain mode and both files present.
