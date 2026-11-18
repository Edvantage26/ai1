import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContacts, loadContacts, formatContacts } from '../src/messages/contacts.mjs';
import { createTemporaryProject } from './helpers.mjs';

const SHARED_CONTACTS = ['---', 'type: Stakeholders', 'title: Project contacts', '---', '', '# Contacts', '',
  '## Laura Pérez', 'role: client, product owner', 'email: laura@client.test', 'Approves releases; write to her about scope and dates.', '',
  '## Marc', 'role: hosting provider', ''].join('\n');
const LOCAL_CONTACTS = ['## laura pérez', 'Tuteo, informal; we talk on first-name terms.', '', '## Nora', 'email: nora@friend.test', 'Freelance designer I ask for help.', ''].join('\n');

function createRepoWithContacts() {
  const projectRoot = createTemporaryProject({});
  mkdirSync(join(projectRoot, '.ai1', 'okf', 'people'), { recursive: true });
  mkdirSync(join(projectRoot, '.ai1', 'local'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'people', 'contacts.md'), SHARED_CONTACTS);
  writeFileSync(join(projectRoot, '.ai1', 'local', 'contacts.md'), LOCAL_CONTACTS.replace(/\n/g, '\r\n'));
  return projectRoot;
}

test('contacts: sections, email and role lines, notes; frontmatter and preamble ignored', () => {
  assert.deepEqual(parseContacts(SHARED_CONTACTS), [
    { name: 'Laura Pérez', role: 'client, product owner', email: 'laura@client.test', notes: 'Approves releases; write to her about scope and dates.' },
    { name: 'Marc', role: 'hosting provider', notes: '' },
  ]);
});

test('contacts: the project\'s and the person\'s own joined by name, case-insensitive, CRLF too [person-project:S5]', () => {
  const projectRoot = createRepoWithContacts();
  const contacts = loadContacts(projectRoot);
  assert.deepEqual(contacts.find((contact) => contact.name === 'Laura Pérez'), {
    name: 'Laura Pérez', email: 'laura@client.test', role: 'client, product owner',
    projectNotes: 'Approves releases; write to her about scope and dates.', myNotes: 'Tuteo, informal; we talk on first-name terms.',
  });
  assert.deepEqual(contacts.find((contact) => contact.name === 'Nora'), { name: 'Nora', projectNotes: '', email: 'nora@friend.test', myNotes: 'Freelance designer I ask for help.' });
  assert.match(formatContacts(contacts), /## Laura Pérez - client, product owner <laura@client\.test>\nproject: Approves releases.*\nyou: Tuteo, informal/);
  const cliOutput = execFileSync(process.execPath, [fileURLToPath(new URL('../bin/ai1', import.meta.url)), 'contacts', 'laura'], { cwd: projectRoot, encoding: 'utf8' });
  assert.match(cliOutput, /you: Tuteo, informal/);
  assert.doesNotMatch(cliOutput, /Nora/);
});

test('contacts: none yet says where they go', () => {
  assert.match(formatContacts(loadContacts(createTemporaryProject({}))), /\.ai1\/okf\/people\/contacts\.md \(committed\).*\.ai1\/local\/contacts\.md \(only yours\)/);
});
