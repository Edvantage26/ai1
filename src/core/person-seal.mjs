// Sealed sync of the person's own files (`ai1 local seal|unseal`, `ai1 keys`): their profile,
// subscriptions and contacts from `.ai1/local/` go into `.ai1/contributors/<email>.sealed`, committed, which only
// their own key opens. Only `node:crypto` (bundled with Node on every platform), no external tool:
// X25519 (an ephemeral key per seal) -> HKDF-SHA256 -> AES-256-GCM, the same construction as age.
// The private key lives in the person's ai1 config folder, never in a repo; the sealed file is base64
// text, read the same with LF or CRLF line ends. `state.json` is never sealed.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AI1_DIRECTORY } from './config.mjs';
import { userConfigDirectory } from './skill-customization.mjs';
import { localDirectoryPath, normalizeEmail, PROFILE_FILE_NAME, readPersonProfile, readPersonState, writePersonState } from './person-project.mjs';
import { ensureDirectoryIgnoredByItself } from './project-paths.mjs';

export const SEALED_HEADER = 'ai1-sealed-v1';
export const CONTRIBUTORS_DIRECTORY = `${AI1_DIRECTORY}/contributors`;
export const SEALED_FILE_NAMES = [PROFILE_FILE_NAME, 'subscriptions.json', 'contacts.md'];
const HKDF_INFO = 'ai1-seal-v1';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const BASE64_LINE_LENGTH = 64;

export function identityKeyPath({ environment = process.env, homeDirectory = homedir() } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), 'identity.key');
}

// A new private key as one base64 line (PKCS#8 DER): what the person keeps in their password manager.
export function generateIdentityText() {
  const { privateKey } = generateKeyPairSync('x25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
}

export function parseIdentityText(identityText) {
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(String(identityText).trim(), 'base64'), format: 'der', type: 'pkcs8' });
    if (privateKey.asymmetricKeyType !== 'x25519') throw new Error('not an X25519 key');
    return privateKey;
  } catch (parseError) {
    throw new Error(`not an ai1 identity key (${parseError.message})`);
  }
}

// Short id of a public key, to tell keys apart without showing them.
export function keyFingerprint(publicKey) {
  return createHash('sha256').update(publicKey.export({ format: 'der', type: 'spki' })).digest('hex').slice(0, 16);
}

// Mode 0600 where the platform has it; on Windows the person's profile folder protects it.
export function writeIdentityFile(identityText, pathOptions) {
  const keyPath = identityKeyPath(pathOptions);
  mkdirSync(dirname(keyPath), { recursive: true });
  writeFileSync(keyPath, `${identityText.trim()}\n`, { mode: 0o600 });
  return keyPath;
}

export function readIdentity(pathOptions) {
  const keyPath = identityKeyPath(pathOptions);
  if (!existsSync(keyPath)) throw new Error(`no ai1 key at ${keyPath}: create one with \`ai1 keys init\`, or bring yours with \`ai1 keys import\``);
  return parseIdentityText(readFileSync(keyPath, 'utf8'));
}

function deriveKey(sharedSecret, ephemeralPublicDer, recipientPublicDer) {
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.concat([ephemeralPublicDer, recipientPublicDer]), HKDF_INFO, 32));
}

export function sealBytes(plainBytes, recipientPublicKey) {
  const ephemeralPair = generateKeyPairSync('x25519');
  const ephemeralPublicDer = ephemeralPair.publicKey.export({ format: 'der', type: 'spki' });
  const recipientPublicDer = recipientPublicKey.export({ format: 'der', type: 'spki' });
  const sealKey = deriveKey(diffieHellman({ privateKey: ephemeralPair.privateKey, publicKey: recipientPublicKey }), ephemeralPublicDer, recipientPublicDer);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', sealKey, nonce);
  const sealedBytes = Buffer.concat([nonce, cipher.update(plainBytes), cipher.final(), cipher.getAuthTag()]);
  const wrapBase64 = (base64Text) => base64Text.match(new RegExp(`.{1,${BASE64_LINE_LENGTH}}`, 'g')).join('\n');
  return [SEALED_HEADER, `recipient: ${keyFingerprint(recipientPublicKey)}`, `ephemeral: ${ephemeralPublicDer.toString('base64')}`, '', wrapBase64(sealedBytes.toString('base64')), ''].join('\n');
}

export function unsealText(sealedText, privateKey) {
  const sealedLines = String(sealedText).split(/\r?\n/).map((sealedLine) => sealedLine.trim());
  if (sealedLines[0] !== SEALED_HEADER) throw new Error(`not an ai1 sealed file (expected "${SEALED_HEADER}")`);
  const ephemeralLine = sealedLines.find((sealedLine) => sealedLine.startsWith('ephemeral: '));
  const blankIndex = sealedLines.indexOf('');
  if (!ephemeralLine || blankIndex < 0) throw new Error('broken ai1 sealed file');
  const ephemeralPublicDer = Buffer.from(ephemeralLine.slice('ephemeral: '.length), 'base64');
  const sealedBytes = Buffer.from(sealedLines.slice(blankIndex + 1).join(''), 'base64');
  const recipientPublicKey = createPublicKey(privateKey);
  const sealKey = deriveKey(
    diffieHellman({ privateKey, publicKey: createPublicKey({ key: ephemeralPublicDer, format: 'der', type: 'spki' }) }),
    ephemeralPublicDer,
    recipientPublicKey.export({ format: 'der', type: 'spki' }),
  );
  try {
    const decipher = createDecipheriv('aes-256-gcm', sealKey, sealedBytes.subarray(0, NONCE_BYTES));
    decipher.setAuthTag(sealedBytes.subarray(sealedBytes.length - TAG_BYTES));
    return Buffer.concat([decipher.update(sealedBytes.subarray(NONCE_BYTES, sealedBytes.length - TAG_BYTES)), decipher.final()]);
  } catch {
    throw new Error('this file was sealed for another key: only its owner can open it');
  }
}

export function sealedFilePath(repoRoot, personEmail) {
  return join(repoRoot, CONTRIBUTORS_DIRECTORY, `${normalizeEmail(personEmail)}.sealed`);
}

// Seals the person's local files present now into `.ai1/contributors/<email>.sealed`; returns the names sealed.
export function sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions) {
  if (!normalizeEmail(personEmail)) throw new Error('sealing needs your git email (git config user.email): it names your sealed file');
  const privateKey = readIdentity(pathOptions);
  const localFiles = {};
  for (const fileName of SEALED_FILE_NAMES) {
    const localPath = join(localDirectoryPath(sharedRoot), fileName);
    if (existsSync(localPath)) localFiles[fileName] = readFileSync(localPath, 'utf8');
  }
  if (!Object.keys(localFiles).length) throw new Error(`nothing to seal in .ai1/local/ (${SEALED_FILE_NAMES.join(', ')})`);
  const sealedPath = sealedFilePath(repoRoot, personEmail);
  mkdirSync(dirname(sealedPath), { recursive: true });
  writeFileSync(sealedPath, sealBytes(Buffer.from(JSON.stringify({ version: 1, files: localFiles })), createPublicKey(privateKey)));
  recordSyncPoint(sharedRoot, { localHash: localFilesHash(sharedRoot), sealedHash: sealedFileHash(repoRoot, personEmail) });
  return { sealedPath, fileNames: Object.keys(localFiles) };
}

// Writes the sealed files that are missing in .ai1/local/; refuses to replace different ones unless forced.
export function unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force = false, ...pathOptions } = {}) {
  const sealedPath = sealedFilePath(repoRoot, personEmail || '');
  if (!normalizeEmail(personEmail) || !existsSync(sealedPath)) throw new Error(`no sealed file for ${personEmail || 'your git email'} at ${CONTRIBUTORS_DIRECTORY}/`);
  const sealedPayload = JSON.parse(unsealText(readFileSync(sealedPath, 'utf8'), readIdentity(pathOptions)).toString('utf8'));
  const localDirectory = localDirectoryPath(sharedRoot);
  const conflictingNames = Object.entries(sealedPayload.files).filter(([fileName, fileText]) => {
    const localPath = join(localDirectory, fileName);
    return existsSync(localPath) && readFileSync(localPath, 'utf8') !== fileText;
  }).map(([fileName]) => fileName);
  if (conflictingNames.length && !force) throw new Error(`.ai1/local/ already has different ${conflictingNames.join(', ')}: compare them, then run again with --force to replace them`);
  ensureDirectoryIgnoredByItself(localDirectory);
  for (const [fileName, fileText] of Object.entries(sealedPayload.files)) {
    if (SEALED_FILE_NAMES.includes(fileName)) writeFileSync(join(localDirectory, fileName), fileText);
  }
  recordSyncPoint(sharedRoot, { localHash: localFilesHash(sharedRoot), sealedHash: sealedFileHash(repoRoot, personEmail) });
  return { fileNames: Object.keys(sealedPayload.files).filter((fileName) => SEALED_FILE_NAMES.includes(fileName)), replaced: force ? conflictingNames : [] };
}

// ---- Automatic sync (hooks local-sync-start and local-sync-stop) ----
// The last point both sides agreed on is kept in state.json `sealedSync` as two fingerprints: the person's
// local files and the sealed file in the repo. At Stop, local files that changed since then are sealed
// again; at SessionStart, a sealed file that changed since then (a pull from another machine) is unsealed.
// When both changed, nothing is overwritten: the person is told once and chooses.

function hashText(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

// Fingerprint of the local files that are sealed (null when there are none).
export function localFilesHash(sharedRoot) {
  const localFiles = {};
  for (const fileName of SEALED_FILE_NAMES) {
    const localPath = join(localDirectoryPath(sharedRoot), fileName);
    if (existsSync(localPath)) localFiles[fileName] = readFileSync(localPath, 'utf8').replace(/\r\n/g, '\n');
  }
  return Object.keys(localFiles).length ? hashText(JSON.stringify(localFiles)) : null;
}

// Fingerprint of the person's sealed file in this checkout, the same with LF or CRLF (null when missing).
export function sealedFileHash(repoRoot, personEmail) {
  const sealedPath = normalizeEmail(personEmail) ? sealedFilePath(repoRoot, personEmail) : null;
  return sealedPath && existsSync(sealedPath) ? hashText(readFileSync(sealedPath, 'utf8').replace(/\r/g, '')) : null;
}

function readSyncPoint(sharedRoot) {
  const syncPoint = readPersonState(sharedRoot).sealedSync;
  return syncPoint && typeof syncPoint === 'object' ? syncPoint : {};
}

function recordSyncPoint(sharedRoot, syncChanges) {
  const personState = readPersonState(sharedRoot);
  writePersonState(sharedRoot, { ...personState, sealedSync: { ...readSyncPoint(sharedRoot), ...syncChanges } });
}

// Cheap check before anything else (no git call): nobody in this repo seals and the person did not turn it on.
export function mayUseSealedSync(repoRoot, sharedRoot) {
  return readPersonProfile(sharedRoot).sealedSync === true || existsSync(join(repoRoot, CONTRIBUTORS_DIRECTORY));
}

// On once the person sealed in this repo (their sealed file exists) or turned it on; `ai1 local sync off` wins.
export function isSealedSyncOn(repoRoot, sharedRoot, personEmail) {
  const syncSetting = readPersonProfile(sharedRoot).sealedSync;
  if (syncSetting === false || !normalizeEmail(personEmail)) return false;
  return syncSetting === true || existsSync(sealedFilePath(repoRoot, personEmail));
}

// A message for the person once per situation (the same conflict or missing key is not repeated).
function noticeOnce(sharedRoot, situationKey, noticeText) {
  if (readSyncPoint(sharedRoot).noticed === situationKey) return { action: 'none' };
  recordSyncPoint(sharedRoot, { noticed: situationKey });
  return { action: 'notice', text: noticeText };
}

function conflictNotice(sharedRoot, localHash, sealedHash) {
  return noticeOnce(sharedRoot, `conflict:${localHash}:${sealedHash}`,
    'ai1: your .ai1/local/ changed here and a newer sealed copy of it arrived in the repo; nothing was overwritten. '
    + 'Keep this one: `ai1 local seal`; take the repo\'s: `ai1 local unseal --force`.');
}

export function syncLocalFilesAtStop({ repoRoot, sharedRoot, personEmail, pathOptions }) {
  if (!isSealedSyncOn(repoRoot, sharedRoot, personEmail) || !existsSync(identityKeyPath(pathOptions))) return { action: 'none' };
  const localHash = localFilesHash(sharedRoot);
  const syncPoint = readSyncPoint(sharedRoot);
  if (!localHash || localHash === syncPoint.localHash) return { action: 'none' };
  const sealedHash = sealedFileHash(repoRoot, personEmail);
  if (sealedHash && sealedHash !== syncPoint.sealedHash) return conflictNotice(sharedRoot, localHash, sealedHash);
  sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
  return { action: 'sealed' };
}

export function syncLocalFilesAtStart({ repoRoot, sharedRoot, personEmail, pathOptions }) {
  if (!isSealedSyncOn(repoRoot, sharedRoot, personEmail)) return { action: 'none' };
  const sealedHash = sealedFileHash(repoRoot, personEmail);
  const syncPoint = readSyncPoint(sharedRoot);
  if (!sealedHash || sealedHash === syncPoint.sealedHash) return { action: 'none' };
  if (!existsSync(identityKeyPath(pathOptions))) {
    return noticeOnce(sharedRoot, `no-key:${sealedHash}`, `ai1: the repo has your sealed .ai1/local/ (${CONTRIBUTORS_DIRECTORY}/${normalizeEmail(personEmail)}.sealed) but this machine has no ai1 key: run \`ai1 keys import\` and paste the line you kept.`);
  }
  const localHash = localFilesHash(sharedRoot);
  if (localHash && localHash !== syncPoint.localHash) return conflictNotice(sharedRoot, localHash, sealedHash);
  try {
    unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force: true, ...pathOptions });
  } catch (unsealError) {
    return noticeOnce(sharedRoot, `unseal-failed:${sealedHash}`, `ai1: could not open your sealed .ai1/local/: ${unsealError.message}`);
  }
  return { action: 'unsealed' };
}
