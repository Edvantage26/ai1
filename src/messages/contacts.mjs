// Contacts (feature `messages`): who the project's contacts are, shared in the knowledge bundle
// (`.ai1/okf/people/contacts.md`, committed), joined by name with the person's own relation and tone with
// each one (`.ai1/local/contacts.md`, ignored). Both are markdown: one `## <Name>` section per contact,
// optional `email:` and `role:` lines, the rest free notes.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { localDirectoryPath } from '../core/person-project.mjs';

export const SHARED_CONTACTS_PATH = `${KNOWLEDGE_BUNDLE_PATH}/people/contacts.md`;
export const LOCAL_CONTACTS_FILE_NAME = 'contacts.md';
const FIELD_LINE_PATTERN = /^\s*[-*]?\s*(email|role)\s*:\s*(.+?)\s*$/i;

// [{ name, email?, role?, notes }] from `## <Name>` sections; text before the first section is ignored.
export function parseContacts(markdownText) {
  const { bodyText } = splitFrontmatter(String(markdownText || ''));
  const contacts = [];
  for (const textLine of bodyText.split(/\r?\n/)) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(textLine);
    if (headingMatch) { contacts.push({ name: headingMatch[1], notes: [] }); continue; }
    const currentContact = contacts[contacts.length - 1];
    if (!currentContact) continue;
    const fieldMatch = FIELD_LINE_PATTERN.exec(textLine);
    if (fieldMatch && !currentContact[fieldMatch[1].toLowerCase()]) currentContact[fieldMatch[1].toLowerCase()] = fieldMatch[2];
    else if (textLine.trim()) currentContact.notes.push(textLine.trim());
  }
  return contacts.map((contact) => ({ ...contact, notes: contact.notes.join('\n') }));
}

function readContactsFile(filePath) {
  return existsSync(filePath) ? parseContacts(readFileSync(filePath, 'utf8')) : [];
}

// Shared and personal entries joined by name (case-insensitive): { name, email?, role?, projectNotes, myNotes }.
export function loadContacts(repoRoot, sharedRoot = repoRoot) {
  const mergedContacts = new Map();
  const contactKey = (contactName) => contactName.trim().toLowerCase();
  for (const sharedContact of readContactsFile(join(repoRoot, SHARED_CONTACTS_PATH))) {
    mergedContacts.set(contactKey(sharedContact.name), { name: sharedContact.name, email: sharedContact.email, role: sharedContact.role, projectNotes: sharedContact.notes, myNotes: '' });
  }
  for (const localContact of readContactsFile(join(localDirectoryPath(sharedRoot), LOCAL_CONTACTS_FILE_NAME))) {
    const existingContact = mergedContacts.get(contactKey(localContact.name)) || { name: localContact.name, projectNotes: '' };
    mergedContacts.set(contactKey(localContact.name), {
      ...existingContact,
      email: existingContact.email || localContact.email,
      role: existingContact.role || localContact.role,
      myNotes: localContact.notes,
    });
  }
  return [...mergedContacts.values()].map((contact) => Object.fromEntries(Object.entries(contact).filter(([, fieldValue]) => fieldValue !== undefined)));
}

export function formatContacts(contacts) {
  if (!contacts.length) return `no contacts yet: the project's in ${SHARED_CONTACTS_PATH} (committed), your relation with each in .ai1/local/${LOCAL_CONTACTS_FILE_NAME} (only yours)`;
  return contacts.map((contact) => [
    `## ${contact.name}${contact.role ? ` - ${contact.role}` : ''}${contact.email ? ` <${contact.email}>` : ''}`,
    ...(contact.projectNotes ? [`project: ${contact.projectNotes.replace(/\n/g, ' ')}`] : []),
    ...(contact.myNotes ? [`you: ${contact.myNotes.replace(/\n/g, ' ')}`] : []),
  ].join('\n')).join('\n\n');
}
