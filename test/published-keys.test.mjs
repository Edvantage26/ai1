import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSealedText, openSealedText } from '../src/core/person-seal.mjs';
import { probeKeySources, readPublishedBlobs, readPublishedKeys } from '../src/core/published-keys.mjs';
import { listMachineSshKeys, sshKeyFingerprint } from '../src/core/ssh-keys.mjs';
import { refreshPublishedKeysBefore, runKeysCommand, runLocalCommand } from '../src/cli/seal-command.mjs';
import { createTemporaryProject, writeSshEd25519KeyPair } from './helpers.mjs';

const emptyGitConfigPath = join(mkdtempSync(join(tmpdir(), 'ai1-gitconfig-')), 'gitconfig');
writeFileSync(emptyGitConfigPath, '');
process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';

function createPathOptions() {
  return { environment: { XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'ai1-config-')) }, homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')) };
}

function createRepoWithContacts(personEmail) {
  const projectRoot = createTemporaryProject({});
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', personEmail], { stdio: 'ignore' });
  mkdirSync(join(projectRoot, '.ai1', 'local'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'local', 'contacts.md'), '## Laura\n');
  return projectRoot;
}

const noSsh = () => '';

test('published keys: fetched for the account set, only ssh-ed25519 kept, sealed for them; a fetch failure keeps the list', async () => {
  const pathOptions = createPathOptions();
  const laptopPair = writeSshEd25519KeyPair(mkdtempSync(join(tmpdir(), 'ai1-home-')));
  const serverPair = writeSshEd25519KeyPair(mkdtempSync(join(tmpdir(), 'ai1-home-')));
  const fetchedUrls = [];
  const fetchText = async (keysUrl) => {
    fetchedUrls.push(keysUrl);
    return `${laptopPair.publicLine}\nssh-rsa ${Buffer.from('\0\0\0\x07ssh-rsa', 'latin1').toString('base64')}\n${serverPair.publicLine}\n`;
  };
  const refreshNotes = await refreshPublishedKeysBefore('keys', ['published', 'github:ana'], { pathOptions, fetchText, runSsh: noSsh });
  assert.deepEqual(fetchedUrls, ['https://github.com/ana.keys']);
  assert.match(refreshNotes.join('\n'), /github:ana: 2 ssh-ed25519 key\(s\), 1 other key\(s\) skipped/);
  assert.equal(readPublishedBlobs(pathOptions).length, 2);
  assert.match(runKeysCommand(['published'], { pathOptions }).output, /github:ana: 2 ssh-ed25519 key\(s\), fetched /);

  const projectRoot = createRepoWithContacts('ana@x.com');
  runLocalCommand(projectRoot, ['seal'], { pathOptions });
  const sealedText = readFileSync(join(projectRoot, '.ai1', 'contributors', 'ana@x.com.sealed'), 'utf8');
  assert.deepEqual(parseSealedText(sealedText).sshRecipients.map(({ fingerprint, origin }) => [fingerprint, origin]), [
    [sshKeyFingerprint(laptopPair.publicBlob), 'published'], [sshKeyFingerprint(serverPair.publicBlob), 'published'],
  ]);

  const failingNotes = await refreshPublishedKeysBefore('local', ['seal'], { pathOptions, fetchText: async () => { throw new Error('offline'); }, runSsh: noSsh });
  assert.match(failingNotes.join('\n'), /could not fetch the keys of github:ana \(offline\); kept the previous list/);
  assert.equal(readPublishedBlobs(pathOptions).length, 2);
  assert.deepEqual(await refreshPublishedKeysBefore('local', ['unseal'], { pathOptions, fetchText, runSsh: noSsh }), [], 'only seal, sync on and keys published fetch');
  assert.match(runKeysCommand(['published'], { pathOptions: createPathOptions() }).output, /no published SSH keys set/);
  await assert.rejects(refreshPublishedKeysBefore('keys', ['published', 'bitbucket:ana'], { pathOptions }), /not a key source: bitbucket:ana/);
});

test('published keys: a key removed on GitHub leaves at the next fetch; machine keys stay; recipients lists and removes [seal-any-machine:S3]', async () => {
  const pathOptions = createPathOptions();
  const machinePair = writeSshEd25519KeyPair(pathOptions.homeDirectory);
  const oldPair = writeSshEd25519KeyPair(mkdtempSync(join(tmpdir(), 'ai1-home-')));
  const newPair = writeSshEd25519KeyPair(mkdtempSync(join(tmpdir(), 'ai1-home-')));
  let publishedText = `${oldPair.publicLine}\n`;
  const fetchText = async () => publishedText;
  await refreshPublishedKeysBefore('keys', ['published', 'gitlab:ana'], { pathOptions, fetchText, runSsh: noSsh });
  const projectRoot = createRepoWithContacts('ana@x.com');
  runLocalCommand(projectRoot, ['seal'], { pathOptions });
  publishedText = `${newPair.publicLine}\n`;
  await refreshPublishedKeysBefore('local', ['seal'], { pathOptions, fetchText, runSsh: noSsh });
  runLocalCommand(projectRoot, ['seal'], { pathOptions });
  const sealedPath = join(projectRoot, '.ai1', 'contributors', 'ana@x.com.sealed');
  const recipientsAfter = parseSealedText(readFileSync(sealedPath, 'utf8')).sshRecipients.map(({ fingerprint, origin }) => [fingerprint, origin]);
  assert.deepEqual(recipientsAfter, [[sshKeyFingerprint(newPair.publicBlob), 'published'], [sshKeyFingerprint(machinePair.publicBlob), 'machine']]);
  assert.ok(openSealedText(readFileSync(sealedPath, 'utf8'), { machineSshKeys: listMachineSshKeys(pathOptions).usableKeys }), 'this machine opens by its own key');

  const listedRecipients = runLocalCommand(projectRoot, ['recipients'], { pathOptions }).output;
  assert.match(listedRecipients, new RegExp(`ssh-ed25519 ${sshKeyFingerprint(newPair.publicBlob)} \\(published on your git host\\)`));
  assert.match(listedRecipients, /\(a machine of yours\)/);
  const removeOutput = runLocalCommand(projectRoot, ['recipients', 'remove', sshKeyFingerprint(newPair.publicBlob)], { pathOptions }).output;
  assert.match(removeOutput, /resealed without .*remove it there too/);
  assert.equal(parseSealedText(readFileSync(sealedPath, 'utf8')).sshRecipients.length, 1);
  assert.match(runLocalCommand(projectRoot, ['recipients', 'remove', 'nope'], { pathOptions }).output, /no ssh-ed25519 recipient nope/);
});

test('published keys: with no account set, the CLI asks the git hosts over SSH who the person is', async () => {
  assert.deepEqual(probeKeySources({ runSsh: (sshTarget) => (sshTarget === 'git@github.com' ? "Hi ana-dev! You've successfully authenticated, but GitHub does not provide shell access." : 'Permission denied (publickey).') }), ['github:ana-dev']);
  assert.deepEqual(probeKeySources({ runSsh: (sshTarget) => (sshTarget === 'git@gitlab.com' ? 'Welcome to GitLab, @ana.dev!' : '') }), ['gitlab:ana.dev']);
  const pathOptions = createPathOptions();
  const noAccountNotes = await refreshPublishedKeysBefore('local', ['sync', 'on'], { pathOptions, fetchText: async () => '', runSsh: noSsh });
  assert.match(noAccountNotes.join('\n'), /ai1 keys published github:<user>/);
  const probedNotes = await refreshPublishedKeysBefore('local', ['sync', 'on'], { pathOptions, fetchText: async () => '', runSsh: (sshTarget) => (sshTarget === 'git@github.com' ? 'Hi ana!' : '') });
  assert.match(probedNotes.join('\n'), /found your account: github:ana/);
  assert.deepEqual(readPublishedKeys(pathOptions).sources, ['github:ana']);
});
