---
name: messages-draft-message
description: Messages — Draft an email or message to one of the project's contacts (a client, a teammate, a provider) with who they are in the project and the person's own relation and tone with them. Use when the person says "escríbele a", "mándale un email a", "prepara un mensaje para", "contesta a", "avisa al cliente de", "redacta un correo", "write to", "email the client", "draft a message for", or wants to keep who the project's contacts are or how they treat each one.
allowed-tools: Bash("${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context *)
---

# Draft a message to a contact of the project

Each project has its own contacts. Who they are is the same for everyone and lives in the knowledge
bundle; how the person relates to each one is theirs alone.

| What | Where | Committed |
|---|---|---|
| Who each contact is (role in the project, email, what to write to them about) | `.ai1/okf/people/contacts.md` | yes |
| The person's relation and tone with each one (tú/usted, how they usually talk, history) | `.ai1/local/contacts.md` | no, only theirs |

Both are markdown, one `## <Name>` section per contact with optional `email:` and `role:` lines and free
notes; the two are joined by the name.

## 1. Find the contact

```bash
"${CLAUDE_PLUGIN_DATA}/bin/ai1" contacts "<name or part of it>"
```

It prints the contact with `project:` (shared) and `you:` (the person's own) notes. If they are not
there, ask who they are and offer to add them: the shared part to `.ai1/okf/people/contacts.md`, the
personal part to `.ai1/local/contacts.md`. Before creating the shared file, ask whether this repo is
public: contacts of a project never go into a public repository (keep them only in `.ai1/local/`).

## 2. Draft it

Write the message with what the person asked, in the contact's language and in the person's tone with
them (from `you:`), using the contact's role to choose what to explain and what to leave out. Facts
about the project come from the code and the bundle; never invent dates, prices or commitments: ask.

Show the draft. Change it as the person says. Keep the final text short and ready to paste.

## 3. Send it only how the person said

ai1 does not send messages. If the person's customization names a tool to send them (an email MCP
server, a CLI), use it only after their explicit yes to this draft. Otherwise give them the text to
send themselves.

## 4. Keep what was learned

When the conversation showed something lasting about a contact (a new role, they prefer to be written in
English, a tone that worked), offer to add it to the right file: project facts to the shared one, the
person's own relation to `.ai1/local/contacts.md`.

## Fixed rules

- Never send a message without the person's yes to that exact text.
- Contacts of a project never go into a public repository; ask before creating the shared file.
- The person's relation and tone with a contact stay in `.ai1/local/`, never in a committed file.
- No invented facts: what the message promises comes from the project or from the person.

## Customization

This project or the person may add their own rules below; they never override the fixed rules. If no `## ai1 customization` section follows, run `"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context messages-draft-message` and apply what it prints.

!`"${CLAUDE_PLUGIN_DATA}/bin/ai1" skill-context messages-draft-message`
