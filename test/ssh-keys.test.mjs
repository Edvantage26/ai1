import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPublicKey } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ed25519PublicToX25519, ed25519SeedToX25519, listMachineSshKeys, parsePrivateKeyText, parsePublicKeyLine, sshKeyFingerprint,
} from '../src/core/ssh-keys.mjs';
import { writeSshEd25519KeyPair } from './helpers.mjs';

const rawX25519 = (keyObject) => keyObject.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');

test('ssh keys: Ed25519 -> X25519 matches libsodium crypto_sign_ed25519_{pk,sk}_to_curve25519 (known answer)', () => {
  // libsodium test/default/ed25519_convert: seed 4211...edee, its Ed25519 public key and the X25519 pair it gives.
  const ed25519Seed = Buffer.from('421151a459faeade3d247115f94aedae42318124095afabe4d1451a559faedee', 'hex');
  const x25519Private = ed25519SeedToX25519(ed25519Seed);
  assert.equal(x25519Private.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('hex'), '8052030376d47112be7f73ed7a019293dd12ad910b654455798b4667d73de166');
  assert.equal(rawX25519(createPublicKey(x25519Private)), 'f1814f0e8ff1043d8a44d25babff3cedcae6c22c3edaa48f857ae70de2baae50');
});

test('ssh keys: the converted public key is the public half of the converted private key, for any key', () => {
  for (let attemptNumber = 0; attemptNumber < 20; attemptNumber += 1) {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-ssh-'));
    const { publicBytes, seedBytes } = writeSshEd25519KeyPair(homeDirectory);
    assert.equal(rawX25519(ed25519PublicToX25519(publicBytes)), rawX25519(createPublicKey(ed25519SeedToX25519(seedBytes))));
  }
});

test('ssh keys: parse the public line and the unencrypted OpenSSH private key', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-ssh-'));
  const { publicLine, publicBlob } = writeSshEd25519KeyPair(homeDirectory);
  const parsedPublic = parsePublicKeyLine(publicLine);
  assert.equal(parsedPublic.keyType, 'ssh-ed25519');
  assert.equal(parsedPublic.comment, 'test@machine');
  assert.ok(parsedPublic.publicBlob.equals(publicBlob));
  assert.equal(sshKeyFingerprint(publicBlob).length, 16);
  assert.equal(parsePublicKeyLine('not a key'), null);
  assert.equal(parsePublicKeyLine('ssh-ed25519 AAAA'), null);
  assert.equal(parsePrivateKeyText('hello').usable, false);
});

test('ssh keys: this machine\'s keys - usable ed25519 ones, and why the others are not', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-ssh-'));
  const usablePair = writeSshEd25519KeyPair(homeDirectory, 'id_ed25519');
  writeSshEd25519KeyPair(homeDirectory, 'id_locked', { cipherName: 'aes256-ctr' });
  writeSshEd25519KeyPair(homeDirectory, 'id_agent_only');
  writeFileSync(join(homeDirectory, '.ssh', 'id_agent_only'), '');
  writeFileSync(join(homeDirectory, '.ssh', 'id_rsa.pub'), `ssh-rsa ${Buffer.concat([Buffer.from([0, 0, 0, 7]), Buffer.from('ssh-rsa')]).toString('base64')} me@host\n`);
  const { usableKeys, unusableKeys } = listMachineSshKeys({ homeDirectory });
  assert.deepEqual(usableKeys.map((usableKey) => usableKey.keyName), ['id_ed25519']);
  assert.equal(usableKeys[0].fingerprint, sshKeyFingerprint(usablePair.publicBlob));
  const reasonByName = Object.fromEntries(unusableKeys.map((unusableKey) => [unusableKey.keyName, unusableKey.reason]));
  assert.match(reasonByName.id_locked, /passphrase/);
  assert.match(reasonByName.id_rsa, /RSA/);
  assert.match(reasonByName.id_agent_only, /not an OpenSSH private key file/);
  assert.deepEqual(listMachineSshKeys({ homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-ssh-')) }), { usableKeys: [], unusableKeys: [] });
});
