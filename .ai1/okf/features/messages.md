---
type: Component
title: messages feature
description: /ai1:messages-draft-message drafts a message to a contact of the project - who they are from the bundle (.ai1/okf/people/contacts.md, committed), the person's own relation and tone from .ai1/local/contacts.md - shows it and sends only through the tool the person names; ai1 contacts.
tags: [messages, contacts, skills, cli]
generated:
  by: claude-code/claude-opus-5-5
  at: '2026-11-18T08:51:46Z'
sources:
  - id: contacts
    resource: src/messages/contacts.mjs
    title: Contacts parsing and join
  - id: skill
    resource: skills/messages-draft-message/SKILL.md
    title: /ai1:messages-draft-message
  - id: tests
    resource: test/messages.test.mjs
    title: Tests
---

Built 2026-11-18 ([decision](../decisions/person-in-project.md)). The person wanted a skill to send a
message or an email with what is known about each contact and their relation with them, per project
("cada proyecto puede tener sus personas de contacto").

- **Contacts files**: markdown, one `## <Name>` section per contact, optional `email:` and `role:`
  lines, free notes. The shared one is a concept of the bundle (`.ai1/okf/people/contacts.md`, type
  `Stakeholders`); the person's is `.ai1/local/contacts.md` ([person within a
  project](../architecture/person-project-scope.md)). `loadContacts` joins them by name,
  case-insensitive, CRLF or LF.
- **`ai1 contacts [<name>] [--json]`** prints each contact with `project:` and `you:` notes.
- **The skill** finds the contact, drafts in their language and the person's tone, never invents facts,
  shows the draft, and sends only through a tool the person's customization names, after a yes to that
  text. ai1 itself sends nothing ([host tooling stays out](../decisions/host-tooling-out-of-plugin.md)).
  Before creating the shared file it asks whether the repo is public: contacts never go into a public
  repository (ai1 cannot tell without the network).

No hook: the feature only ships the skill and the command; switching it off hides the skill.

# Validate

`node --test test/messages.test.mjs`: parsing, the join (shared + personal, case and CRLF), the CLI
filter. A real session drafting a message was not run (the CLI's login had expired on 2026-11-18).
