import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateIdentityText, parseIdentityText, sealBytes, unsealText, writeIdentityFile, identityKeyPath,
  syncLocalFilesAtStop, syncLocalFilesAtStart, mayUseSealedSync,
} from '../src/core/person-seal.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { runKeysCommand, runLocalCommand } from '../src/cli/seal-command.mjs';
import { createTemporaryProject } from './helpers.mjs';

const emptyGitConfigPath = join(mkdtempSync(join(tmpdir(), 'ai1-gitconfig-')), 'gitconfig');
writeFileSync(emptyGitConfigPath, '');
process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const FIXTURES_DIRECTORY = fileURLToPath(new URL('./fixtures/person-seal/', import.meta.url));

// A person's ai1 config folder of their own (XDG_CONFIG_HOME), so the real one is never touched.
function createPathOptions() {
  return { environment: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'ai1-config-')) }, homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')) };
}

function createRepoFor(personEmail) {
  const projectRoot = createTemporaryProject({});
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', personEmail], { stdio: 'ignore' });
  return projectRoot;
}

test('seal: a fixed file sealed once opens with its key, with LF or CRLF line ends (same format on every platform)', () => {
  const privateKey = parseIdentityText(readFileSync(join(FIXTURES_DIRECTORY, 'test-only-identity.key'), 'utf8'));
  const sealedText = readFileSync(join(FIXTURES_DIRECTORY, 'ana@x.com.sealed'), 'utf8');
  const expectedPayload = { version: 1, files: { 'contacts.md': '## Laura\nTuteo.\n' } };
  assert.deepEqual(JSON.parse(unsealText(sealedText, privateKey).toString('utf8')), expectedPayload);
  assert.deepEqual(JSON.parse(unsealText(sealedText.replace(/\n/g, '\r\n'), privateKey).toString('utf8')), expectedPayload);
});

test('seal: another key cannot open it; a tampered file is refused', () => {
  const ownerKey = parseIdentityText(generateIdentityText());
  const otherKey = parseIdentityText(generateIdentityText());
  const sealedText = sealBytes(Buffer.from('secret notes'), createPublicKey(ownerKey));
  assert.equal(unsealText(sealedText, ownerKey).toString('utf8'), 'secret notes');
  assert.throws(() => unsealText(sealedText, otherKey), /sealed for another key: only its owner can open it/);
  const sealedLines = sealedText.split('\n');
  sealedLines[4] = `${sealedLines[4].slice(0, -2)}${sealedLines[4].endsWith('AA') ? 'BB' : 'AA'}`;
  assert.throws(() => unsealText(sealedLines.join('\n'), ownerKey), /only its owner can open it/);
  assert.throws(() => unsealText('hello', ownerKey), /not an ai1 sealed file/);
  assert.throws(() => parseIdentityText('bm90IGEga2V5'), /not an ai1 identity key/);
});

test('local seal and unseal carry the person\'s files to another clone; another person\'s key cannot [person-project:S6]', () => {
  const anaPaths = createPathOptions();
  assert.match(runKeysCommand(['init'], { pathOptions: anaPaths }).output, /Keep this line in your password manager/);
  assert.equal(runKeysCommand(['init'], { pathOptions: anaPaths }).exitCode, 1, 'an existing key is not replaced without --force');
  const firstClone = createRepoFor('Ana@x.com');
  mkdirSync(join(firstClone, '.ai1', 'local'), { recursive: true });
  writeFileSync(join(firstClone, '.ai1', 'local', 'profile.json'), '{ "role": "maintainer" }\n');
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nTuteo.\n');
  writeFileSync(join(firstClone, '.ai1', 'local', 'state.json'), '{}\n');
  assert.match(runLocalCommand(firstClone, ['seal'], { pathOptions: anaPaths }).output, /sealed profile\.json, contacts\.md into .*ana@x\.com\.sealed/);
  const sealedText = readFileSync(join(firstClone, '.ai1', 'contributors', 'ana@x.com.sealed'), 'utf8');
  assert.doesNotMatch(sealedText, /Laura|maintainer/);

  const secondClone = createRepoFor('ana@x.com');
  mkdirSync(join(secondClone, '.ai1', 'contributors'), { recursive: true });
  writeFileSync(join(secondClone, '.ai1', 'contributors', 'ana@x.com.sealed'), sealedText.replace(/\n/g, '\r\n'));
  const otherMachinePaths = createPathOptions();
  const identityText = readFileSync(identityKeyPath(anaPaths), 'utf8');
  runKeysCommand(['import'], { readStandardInput: () => identityText, pathOptions: otherMachinePaths });
  assert.match(runLocalCommand(secondClone, ['unseal'], { pathOptions: otherMachinePaths }).output, /unsealed profile\.json, contacts\.md/);
  assert.equal(readFileSync(join(secondClone, '.ai1', 'local', 'contacts.md'), 'utf8'), '## Laura\nTuteo.\n');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(secondClone, '.ai1', 'local', 'state.json'), 'utf8'))), ['sealedSync'], 'state.json is never sealed: only this clone\'s sync point is there');

  writeFileSync(join(secondClone, '.ai1', 'local', 'contacts.md'), '## Laura\nUsted.\n');
  assert.throws(() => runLocalCommand(secondClone, ['unseal'], { pathOptions: otherMachinePaths }), /already has different contacts\.md: .*--force/);
  assert.match(runLocalCommand(secondClone, ['unseal', '--force'], { pathOptions: otherMachinePaths }).output, /replaced contacts\.md/);

  const bobPaths = createPathOptions();
  writeIdentityFile(generateIdentityText(), bobPaths);
  assert.throws(() => runLocalCommand(secondClone, ['unseal', '--force'], { pathOptions: bobPaths }), /only its owner can open it/);
});

test('local seal needs a key and something to seal', () => {
  const projectRoot = createRepoFor('ana@x.com');
  assert.throws(() => runLocalCommand(projectRoot, ['seal'], { pathOptions: createPathOptions() }), /no ai1 key at .*ai1 keys init/);
  const withKey = createPathOptions();
  runKeysCommand(['init'], { pathOptions: withKey });
  assert.throws(() => runLocalCommand(projectRoot, ['seal'], { pathOptions: withKey }), /nothing to seal/);
});

// Two clones of one repo for the same person, each with its own .ai1/local/, sharing the sealed file by copy (a push and a pull).
function createSyncedClones() {
  const pathOptions = createPathOptions();
  runKeysCommand(['init'], { pathOptions });
  const firstClone = createRepoFor('ana@x.com');
  const secondClone = createRepoFor('ana@x.com');
  mkdirSync(join(firstClone, '.ai1', 'local'), { recursive: true });
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nTuteo.\n');
  runLocalCommand(firstClone, ['seal'], { pathOptions });
  const carrySealedFile = (fromClone, toClone) => {
    mkdirSync(join(toClone, '.ai1', 'contributors'), { recursive: true });
    writeFileSync(join(toClone, '.ai1', 'contributors', 'ana@x.com.sealed'), readFileSync(join(fromClone, '.ai1', 'contributors', 'ana@x.com.sealed'), 'utf8'));
  };
  const syncArguments = (cloneRoot) => ({ repoRoot: cloneRoot, sharedRoot: cloneRoot, personEmail: 'ana@x.com', pathOptions });
  return { pathOptions, firstClone, secondClone, carrySealedFile, syncArguments };
}

test('sealed sync: a change is sealed at stop and unsealed in the other clone at session start; nothing to do stays quiet', () => {
  const { firstClone, secondClone, carrySealedFile, syncArguments } = createSyncedClones();
  assert.deepEqual(syncLocalFilesAtStop(syncArguments(firstClone)), { action: 'none' }, 'nothing changed since the seal');
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nTuteo, informal.\n');
  assert.deepEqual(syncLocalFilesAtStop(syncArguments(firstClone)), { action: 'sealed' });
  carrySealedFile(firstClone, secondClone);
  assert.deepEqual(syncLocalFilesAtStart(syncArguments(secondClone)), { action: 'unsealed' });
  assert.equal(readFileSync(join(secondClone, '.ai1', 'local', 'contacts.md'), 'utf8'), '## Laura\nTuteo, informal.\n');
  assert.deepEqual(syncLocalFilesAtStart(syncArguments(secondClone)), { action: 'none' });
  assert.deepEqual(syncLocalFilesAtStop(syncArguments(secondClone)), { action: 'none' }, 'what was unsealed is not sealed back');
});

test('sealed sync: changes on both sides are told once and nothing is overwritten', () => {
  const { firstClone, secondClone, carrySealedFile, syncArguments } = createSyncedClones();
  carrySealedFile(firstClone, secondClone);
  syncLocalFilesAtStart(syncArguments(secondClone));
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nFrom the first clone.\n');
  syncLocalFilesAtStop(syncArguments(firstClone));
  writeFileSync(join(secondClone, '.ai1', 'local', 'contacts.md'), '## Laura\nFrom the second clone.\n');
  carrySealedFile(firstClone, secondClone);
  const conflictOutcome = syncLocalFilesAtStart(syncArguments(secondClone));
  assert.equal(conflictOutcome.action, 'notice');
  assert.match(conflictOutcome.text, /nothing was overwritten\. Keep this one: `ai1 local seal`; take the repo's: `ai1 local unseal --force`/);
  assert.deepEqual(syncLocalFilesAtStart(syncArguments(secondClone)), { action: 'none' }, 'told once');
  assert.deepEqual(syncLocalFilesAtStop(syncArguments(secondClone)), { action: 'none' }, 'the stop does not seal over it either');
  assert.equal(readFileSync(join(secondClone, '.ai1', 'local', 'contacts.md'), 'utf8'), '## Laura\nFrom the second clone.\n');
});

test('sealed sync: a machine without the key is told once; sync off stops it; a repo where nobody seals is skipped', () => {
  const { firstClone, secondClone, carrySealedFile, syncArguments } = createSyncedClones();
  carrySealedFile(firstClone, secondClone);
  const keylessArguments = { ...syncArguments(secondClone), pathOptions: createPathOptions() };
  assert.match(syncLocalFilesAtStart(keylessArguments).text, /this machine has no ai1 key: run `ai1 keys import`/);
  assert.deepEqual(syncLocalFilesAtStart(keylessArguments), { action: 'none' });
  assert.match(runLocalCommand(firstClone, ['sync', 'off']).output, /sealed sync off/);
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nChanged.\n');
  assert.deepEqual(syncLocalFilesAtStop(syncArguments(firstClone)), { action: 'none' });
  assert.equal(runLocalCommand(firstClone, ['sync', 'status']).output, 'sealed sync: off');
  const quietRepo = createRepoFor('bob@x.com');
  assert.equal(mayUseSealedSync(quietRepo, quietRepo), false);
});

test('sealed sync hooks: the stop hook seals through the dispatcher and says nothing to the agent', () => {
  const { pathOptions, firstClone } = createSyncedClones();
  writeFileSync(join(firstClone, '.ai1', 'local', 'contacts.md'), '## Laura\nVia the hook.\n');
  const sealedBefore = readFileSync(join(firstClone, '.ai1', 'contributors', 'ana@x.com.sealed'), 'utf8');
  const hookOutput = runHookEvent('Stop', { session_id: 'session-1', cwd: firstClone }, {
    environment: { ...pathOptions.environment, CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: pathOptions.homeDirectory,
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  });
  assert.notEqual(readFileSync(join(firstClone, '.ai1', 'contributors', 'ana@x.com.sealed'), 'utf8'), sealedBefore);
  assert.doesNotMatch(JSON.stringify(hookOutput || {}), /sealed|additionalContext/);
});
