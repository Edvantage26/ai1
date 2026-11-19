import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateIdentityText, parseIdentityText, sealBytes, unsealText, writeIdentityFile, identityKeyPath, sealForRecipients, openSealedText, parseSealedText,
  syncLocalFilesAtStop, syncLocalFilesAtStart, mayUseSealedSync,
} from '../src/core/person-seal.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { runKeysCommand, runLocalCommand } from '../src/cli/seal-command.mjs';
import { createTemporaryProject, writeSshEd25519KeyPair } from './helpers.mjs';
import { listMachineSshKeys } from '../src/core/ssh-keys.mjs';

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

test('local seal needs something to seal and a key to seal for (ai1 key or ssh-ed25519)', () => {
  const projectRoot = createRepoFor('ana@x.com');
  const withKey = createPathOptions();
  runKeysCommand(['init'], { pathOptions: withKey });
  assert.throws(() => runLocalCommand(projectRoot, ['seal'], { pathOptions: withKey }), /nothing to seal/);
  mkdirSync(join(projectRoot, '.ai1', 'local'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'local', 'contacts.md'), '## Laura\n');
  assert.throws(() => runLocalCommand(projectRoot, ['seal'], { pathOptions: createPathOptions() }), /nobody to seal for: .*ai1 local password/);
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

test('seal v2: one file for the ai1 key and several ssh-ed25519 keys; each opens it, another key does not', () => {
  const identityPrivateKey = parseIdentityText(generateIdentityText());
  const laptopHome = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const serverHome = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const strangerHome = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const laptopPair = writeSshEd25519KeyPair(laptopHome);
  const serverPair = writeSshEd25519KeyPair(serverHome);
  writeSshEd25519KeyPair(strangerHome);
  const sealedText = sealForRecipients(Buffer.from('my contacts'), {
    identityPublicKey: createPublicKey(identityPrivateKey),
    sshRecipients: [{ publicBlob: laptopPair.publicBlob, origin: 'published' }, { publicBlob: serverPair.publicBlob, origin: 'machine' }, { publicBlob: laptopPair.publicBlob, origin: 'published' }],
  });
  const parsedSealed = parseSealedText(sealedText);
  assert.equal(parsedSealed.sshRecipients.length, 2, 'a repeated key is sealed for once');
  assert.deepEqual(parsedSealed.sshRecipients.map((sshRecipient) => sshRecipient.origin), ['published', 'machine']);
  assert.equal(unsealText(sealedText, identityPrivateKey).toString('utf8'), 'my contacts');
  for (const homeDirectory of [laptopHome, serverHome]) {
    const openedSealed = openSealedText(sealedText, { machineSshKeys: listMachineSshKeys({ homeDirectory }).usableKeys });
    assert.equal(openedSealed.plainBytes.toString('utf8'), 'my contacts');
    assert.equal(openedSealed.openedWith, '~/.ssh/id_ed25519');
  }
  assert.throws(() => openSealedText(sealedText, { machineSshKeys: listMachineSshKeys({ homeDirectory: strangerHome }).usableKeys }), /only its owner can open it \(tried ~\/\.ssh\/id_ed25519\)/);
  assert.throws(() => openSealedText(sealedText), /no ai1 key and no usable ssh-ed25519 key/);
  assert.equal(openSealedText(sealedText.replace(/\n/g, '\r\n'), { identityPrivateKey }).plainBytes.toString('utf8'), 'my contacts', 'CRLF line ends still open');
});

test('seal v2: a changed header line or body byte is refused; a newer format asks to update ai1', () => {
  const identityPrivateKey = parseIdentityText(generateIdentityText());
  const sealedText = sealForRecipients(Buffer.from('notes'), { identityPublicKey: createPublicKey(identityPrivateKey), identityPasswordLine: 'identity-password: c2FsdA== 17 AAAA' });
  const swappedHeader = sealedText.replace('identity-password: c2FsdA== 17 AAAA', 'identity-password: c2FsdA== 17 BBBB');
  assert.throws(() => unsealText(swappedHeader, identityPrivateKey), /changed after it was sealed/);
  const sealedLines = sealedText.split('\n');
  const bodyIndex = sealedLines.indexOf('') + 1;
  sealedLines[bodyIndex] = `${sealedLines[bodyIndex].slice(0, -2)}${sealedLines[bodyIndex].endsWith('AA') ? 'BB' : 'AA'}`;
  assert.throws(() => unsealText(sealedLines.join('\n'), identityPrivateKey), /changed after it was sealed/);
  assert.throws(() => unsealText(sealedText.replace('ai1-sealed-v2', 'ai1-sealed-v9'), identityPrivateKey), /needs a newer ai1 \(ai1-sealed-v9\): update ai1/);
});

test('seal v2: a v1 file still opens, and the next seal writes v2 for the same key [seal-any-machine:S5]', () => {
  const pathOptions = createPathOptions();
  const fixtureIdentityText = readFileSync(join(FIXTURES_DIRECTORY, 'test-only-identity.key'), 'utf8');
  writeIdentityFile(fixtureIdentityText, pathOptions);
  const projectRoot = createRepoFor('ana@x.com');
  mkdirSync(join(projectRoot, '.ai1', 'contributors'), { recursive: true });
  const sealedPath = join(projectRoot, '.ai1', 'contributors', 'ana@x.com.sealed');
  writeFileSync(sealedPath, readFileSync(join(FIXTURES_DIRECTORY, 'ana@x.com.sealed'), 'utf8'));
  assert.match(readFileSync(sealedPath, 'utf8'), /^ai1-sealed-v1\n/);
  assert.match(runLocalCommand(projectRoot, ['unseal'], { pathOptions }).output, /unsealed contacts\.md/);
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'local', 'contacts.md'), 'utf8'), '## Laura\nTuteo.\n');
  runLocalCommand(projectRoot, ['seal'], { pathOptions });
  assert.match(readFileSync(sealedPath, 'utf8'), /^ai1-sealed-v2\n/);
  const resealedPayload = JSON.parse(unsealText(readFileSync(sealedPath, 'utf8'), parseIdentityText(fixtureIdentityText)).toString('utf8'));
  assert.equal(resealedPayload.files['contacts.md'], '## Laura\nTuteo.\n');
});

test('seal v2: a machine with no ai1 key opens by SSH and reseals keeping every recipient, adding its own key [seal-any-machine:S3]', () => {
  const projectRoot = createRepoFor('ana@x.com');
  const firstMachine = createPathOptions();
  runKeysCommand(['init'], { pathOptions: firstMachine });
  const secondMachine = createPathOptions();
  const secondMachinePair = writeSshEd25519KeyPair(secondMachine.homeDirectory);
  const thirdMachine = createPathOptions();
  const thirdMachinePair = writeSshEd25519KeyPair(thirdMachine.homeDirectory);
  mkdirSync(join(projectRoot, '.ai1', 'contributors'), { recursive: true });
  const sealedPath = join(projectRoot, '.ai1', 'contributors', 'ana@x.com.sealed');
  const firstMachineKey = parseIdentityText(readFileSync(identityKeyPath(firstMachine), 'utf8'));
  writeFileSync(sealedPath, sealForRecipients(Buffer.from(JSON.stringify({ version: 1, files: { 'contacts.md': '## Laura\n' } })), {
    identityPublicKey: createPublicKey(firstMachineKey), sshRecipients: [{ publicBlob: secondMachinePair.publicBlob, origin: 'published' }],
  }));
  assert.match(runLocalCommand(projectRoot, ['unseal'], { pathOptions: secondMachine }).output, /unsealed contacts\.md/);
  writeFileSync(join(projectRoot, '.ai1', 'local', 'contacts.md'), '## Laura\nFrom the second machine.\n');
  runLocalCommand(projectRoot, ['seal'], { pathOptions: thirdMachine });
  const resealed = parseSealedText(readFileSync(sealedPath, 'utf8'));
  assert.ok(resealed.identityPublicKey, 'the ai1 key stays a recipient though this machine has none');
  assert.deepEqual(resealed.sshRecipients.map(({ origin }) => origin), ['published', 'machine']);
  assert.ok(resealed.sshRecipients[1].publicBlob.equals(thirdMachinePair.publicBlob));
  for (const machineOptions of [firstMachine, secondMachine, thirdMachine]) {
    const openedSealed = openSealedText(readFileSync(sealedPath, 'utf8'), {
      identityPrivateKey: existsSync(identityKeyPath(machineOptions)) ? parseIdentityText(readFileSync(identityKeyPath(machineOptions), 'utf8')) : null,
      machineSshKeys: listMachineSshKeys(machineOptions).usableKeys,
    });
    assert.match(JSON.parse(openedSealed.plainBytes.toString('utf8')).files['contacts.md'], /From the second machine/);
  }
});
