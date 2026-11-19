// Sealed sync of the person's own files (`ai1 local seal|unseal`, `ai1 keys`): their profile,
// subscriptions and contacts from `.ai1/local/` go into `.ai1/contributors/<email>.sealed`, committed, which only
// their own key opens. Only `node:crypto` (bundled with Node on every platform), no external tool:
// X25519 (an ephemeral key per seal) -> HKDF-SHA256 -> AES-256-GCM, the same construction as age.
// The private key lives in the person's ai1 config folder, never in a repo; the sealed file is base64
// text, read the same with LF or CRLF line ends. `state.json` is never sealed.

import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { AI1_DIRECTORY } from './config.mjs';
import { userConfigDirectory } from './skill-customization.mjs';
import { localDirectoryPath, normalizeEmail, PROFILE_FILE_NAME, readPersonProfile, readPersonState, writePersonState } from './person-project.mjs';
import { ensureDirectoryIgnoredByItself } from './project-paths.mjs';
import { readPublishedBlobs } from './published-keys.mjs';
import { ed25519PublicToX25519, listMachineSshKeys, parsePublicKeyLine, publicKeyLineFromBlob, sshKeyFingerprint, SSH_ED25519_TYPE } from './ssh-keys.mjs';

export const SEALED_HEADER = 'ai1-sealed-v2';
export const SEALED_HEADER_V1 = 'ai1-sealed-v1';
export const CONTRIBUTORS_DIRECTORY = `${AI1_DIRECTORY}/contributors`;
export const SEALED_FILE_NAMES = [PROFILE_FILE_NAME, 'subscriptions.json', 'contacts.md', 'routines.json'];
const HKDF_INFO = 'ai1-seal-v1';
const HKDF_INFO_V2 = 'ai1-seal-v2';
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

export function readIdentityIfPresent(pathOptions) {
  return existsSync(identityKeyPath(pathOptions)) ? readIdentity(pathOptions) : null;
}

// ---- Password fallback: the ai1 key closed with the person's password (scrypt -> AES-256-GCM) ----
// One line, `identity-password: <ai1 key fingerprint> <salt> <log2 N> <closed key>`, kept in the person's
// ai1 config folder and copied into every sealed file, so a machine with no usable key gets the ai1 key
// back with the password once (`ai1 local unlock`). Never computed in a hook: scrypt is slow on purpose.

export const MIN_PASSWORD_LENGTH = 12;
const PASSWORD_SCRYPT_LOG_N = 17;
const PASSWORD_SCRYPT_BLOCK_SIZE = 8;
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function identityPasswordPath({ environment = process.env, homeDirectory = homedir() } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), 'identity-password');
}

function derivePasswordKey(passwordText, saltBytes, scryptLogN) {
  const costFactor = 2 ** scryptLogN;
  return scryptSync(String(passwordText).normalize('NFC'), saltBytes, 32, {
    N: costFactor, r: PASSWORD_SCRYPT_BLOCK_SIZE, p: 1, maxmem: 128 * costFactor * PASSWORD_SCRYPT_BLOCK_SIZE * 2,
  });
}

// Five groups of five letters and digits without look-alikes (about 120 bits).
export function generatePassword() {
  const randomValues = randomBytes(25);
  const passwordCharacters = [...randomValues].map((randomValue) => PASSWORD_ALPHABET[randomValue % PASSWORD_ALPHABET.length]);
  return [0, 5, 10, 15, 20].map((groupStart) => passwordCharacters.slice(groupStart, groupStart + 5).join('')).join('-');
}

export function closeIdentityWithPassword(identityPrivateKey, passwordText) {
  if (String(passwordText).length < MIN_PASSWORD_LENGTH) throw new Error(`the password needs at least ${MIN_PASSWORD_LENGTH} characters (leave it empty and ai1 makes one for you)`);
  const saltBytes = randomBytes(16);
  const closedKey = encryptWithKey(derivePasswordKey(passwordText, saltBytes, PASSWORD_SCRYPT_LOG_N), identityPrivateKey.export({ format: 'der', type: 'pkcs8' }));
  return `identity-password: ${keyFingerprint(createPublicKey(identityPrivateKey))} ${saltBytes.toString('base64')} ${PASSWORD_SCRYPT_LOG_N} ${closedKey.toString('base64')}`;
}

function parseIdentityPasswordLine(passwordLine) {
  const [lineName, fingerprint, saltBase64, scryptLogNText, closedKeyBase64] = String(passwordLine || '').trim().split(/\s+/);
  const scryptLogN = Number(scryptLogNText);
  if (lineName !== 'identity-password:' || !closedKeyBase64 || !Number.isInteger(scryptLogN) || scryptLogN < 10 || scryptLogN > 22) return null;
  return { fingerprint, saltBytes: Buffer.from(saltBase64, 'base64'), scryptLogN, closedKey: Buffer.from(closedKeyBase64, 'base64') };
}

export function openIdentityWithPassword(passwordLine, passwordText) {
  const parsedLine = parseIdentityPasswordLine(passwordLine);
  if (!parsedLine) throw new Error('broken identity-password line');
  let pkcs8Bytes;
  try {
    pkcs8Bytes = decryptWithKey(derivePasswordKey(passwordText, parsedLine.saltBytes, parsedLine.scryptLogN), parsedLine.closedKey);
  } catch {
    throw new Error('wrong password');
  }
  return parseIdentityText(pkcs8Bytes.toString('base64'));
}

export function readIdentityPasswordLine(pathOptions) {
  const passwordPath = identityPasswordPath(pathOptions);
  return existsSync(passwordPath) ? readFileSync(passwordPath, 'utf8').trim() : null;
}

export function writeIdentityPasswordLine(passwordLine, pathOptions) {
  const passwordPath = identityPasswordPath(pathOptions);
  mkdirSync(dirname(passwordPath), { recursive: true });
  writeFileSync(passwordPath, `${passwordLine.trim()}\n`, { mode: 0o600 });
  return passwordPath;
}

// The password line that belongs to this ai1 key (the person's config first, then the previous file's).
function passwordLineFor(identityPublicKey, candidateLines) {
  if (!identityPublicKey) return null;
  const identityFingerprint = keyFingerprint(identityPublicKey);
  return candidateLines.find((candidateLine) => parseIdentityPasswordLine(candidateLine)?.fingerprint === identityFingerprint) || null;
}

function deriveKey(sharedSecret, ephemeralPublicDer, recipientPublicDer, hkdfInfo = HKDF_INFO) {
  return Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.concat([ephemeralPublicDer, recipientPublicDer]), hkdfInfo, 32));
}

function encryptWithKey(symmetricKey, plainBytes, additionalData) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', symmetricKey, nonce);
  if (additionalData) cipher.setAAD(additionalData);
  return Buffer.concat([nonce, cipher.update(plainBytes), cipher.final(), cipher.getAuthTag()]);
}

// Throws on a wrong key or a changed byte (the GCM tag does not match).
function decryptWithKey(symmetricKey, sealedBytes, additionalData) {
  const decipher = createDecipheriv('aes-256-gcm', symmetricKey, sealedBytes.subarray(0, NONCE_BYTES));
  if (additionalData) decipher.setAAD(additionalData);
  decipher.setAuthTag(sealedBytes.subarray(sealedBytes.length - TAG_BYTES));
  return Buffer.concat([decipher.update(sealedBytes.subarray(NONCE_BYTES, sealedBytes.length - TAG_BYTES)), decipher.final()]);
}

const toSpkiDer = (publicKey) => publicKey.export({ format: 'der', type: 'spki' });
const wrapBase64 = (base64Text) => base64Text.match(new RegExp(`.{1,${BASE64_LINE_LENGTH}}`, 'g')).join('\n');

// The file key closed for one X25519 public key: ephemeral X25519 -> HKDF-SHA256 -> AES-256-GCM.
function wrapFileKey(fileKey, recipientPublicKey) {
  const ephemeralPair = generateKeyPairSync('x25519');
  const ephemeralPublicDer = toSpkiDer(ephemeralPair.publicKey);
  const wrapKey = deriveKey(diffieHellman({ privateKey: ephemeralPair.privateKey, publicKey: recipientPublicKey }), ephemeralPublicDer, toSpkiDer(recipientPublicKey), HKDF_INFO_V2);
  return { ephemeralPublicDer, wrappedKey: encryptWithKey(wrapKey, fileKey) };
}

function unwrapFileKey({ ephemeralPublicDer, wrappedKey }, privateKey) {
  const ephemeralPublicKey = createPublicKey({ key: ephemeralPublicDer, format: 'der', type: 'spki' });
  const wrapKey = deriveKey(diffieHellman({ privateKey, publicKey: ephemeralPublicKey }), ephemeralPublicDer, toSpkiDer(createPublicKey(privateKey)), HKDF_INFO_V2);
  return decryptWithKey(wrapKey, wrappedKey);
}

// Seals for several recipients (format v2): a random file key encrypts the body (the header is its
// additional data, so no header line can be swapped), and each recipient gets that key closed for them.
// `identityPublicKey`: the ai1 key; `sshRecipients`: [{ publicBlob, origin: 'published'|'machine' }];
// `identityPasswordLine`: the ai1 key closed with the person's password, copied as is.
export function sealForRecipients(plainBytes, { identityPublicKey = null, sshRecipients = [], identityPasswordLine = null } = {}) {
  if (!identityPublicKey && !sshRecipients.length) throw new Error('nobody to seal for: no ai1 key and no ssh-ed25519 key (set a password with `ai1 local password`, or add an SSH key)');
  const fileKey = randomBytes(32);
  const headerLines = [SEALED_HEADER];
  if (identityPublicKey) {
    const { ephemeralPublicDer, wrappedKey } = wrapFileKey(fileKey, identityPublicKey);
    headerLines.push(`recipient: x25519 ${keyFingerprint(identityPublicKey)} ${ephemeralPublicDer.toString('base64')} ${wrappedKey.toString('base64')}`);
  }
  const seenFingerprints = new Set();
  for (const { publicBlob, origin } of sshRecipients) {
    const parsedKey = parsePublicKeyLine(publicKeyLineFromBlob(publicBlob));
    const fingerprint = parsedKey && sshKeyFingerprint(publicBlob);
    if (!parsedKey || parsedKey.keyType !== SSH_ED25519_TYPE || seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);
    const { ephemeralPublicDer, wrappedKey } = wrapFileKey(fileKey, ed25519PublicToX25519(parsedKey.ed25519PublicBytes));
    headerLines.push(`recipient: ${SSH_ED25519_TYPE} ${fingerprint} ${Buffer.from(publicBlob).toString('base64')} ${ephemeralPublicDer.toString('base64')} ${wrappedKey.toString('base64')} ${origin === 'machine' ? 'machine' : 'published'}`);
  }
  if (identityPublicKey) headerLines.push(`identity-public: ${toSpkiDer(identityPublicKey).toString('base64')}`);
  if (identityPasswordLine) headerLines.push(identityPasswordLine.trim());
  const bodyBytes = encryptWithKey(fileKey, plainBytes, Buffer.from(headerLines.join('\n')));
  return [...headerLines, '', wrapBase64(bodyBytes.toString('base64')), ''].join('\n');
}

// One recipient only, the ai1 key.
export function sealBytes(plainBytes, recipientPublicKey) {
  return sealForRecipients(plainBytes, { identityPublicKey: recipientPublicKey });
}

// The public parts of a sealed file (v1 or v2), without opening it.
export function parseSealedText(sealedText) {
  const sealedLines = String(sealedText).split(/\r?\n/).map((sealedLine) => sealedLine.trim());
  const formatHeader = sealedLines[0] || '';
  if (formatHeader !== SEALED_HEADER && formatHeader !== SEALED_HEADER_V1) {
    throw new Error(/^ai1-sealed-v\d+$/.test(formatHeader) ? `this sealed file needs a newer ai1 (${formatHeader}): update ai1` : `not an ai1 sealed file (expected "${SEALED_HEADER}")`);
  }
  const blankIndex = sealedLines.indexOf('');
  if (blankIndex < 0) throw new Error('broken ai1 sealed file');
  const headerLines = sealedLines.slice(0, blankIndex);
  const bodyBytes = Buffer.from(sealedLines.slice(blankIndex + 1).join(''), 'base64');
  const parsedSealed = { formatVersion: 2, headerText: headerLines.join('\n'), bodyBytes, identityRecipient: null, sshRecipients: [], identityPublicKey: null, identityPasswordLine: null };
  if (formatHeader === SEALED_HEADER_V1) {
    const ephemeralLine = headerLines.find((headerLine) => headerLine.startsWith('ephemeral: '));
    if (!ephemeralLine) throw new Error('broken ai1 sealed file');
    return { ...parsedSealed, formatVersion: 1, ephemeralPublicDer: Buffer.from(ephemeralLine.slice('ephemeral: '.length), 'base64') };
  }
  for (const headerLine of headerLines.slice(1)) {
    const [lineName, ...lineFields] = headerLine.split(/\s+/);
    if (lineName === 'recipient:' && lineFields[0] === 'x25519' && lineFields.length >= 4) {
      parsedSealed.identityRecipient = { fingerprint: lineFields[1], ephemeralPublicDer: Buffer.from(lineFields[2], 'base64'), wrappedKey: Buffer.from(lineFields[3], 'base64') };
    } else if (lineName === 'recipient:' && lineFields[0] === SSH_ED25519_TYPE && lineFields.length >= 5) {
      parsedSealed.sshRecipients.push({
        fingerprint: lineFields[1], publicBlob: Buffer.from(lineFields[2], 'base64'), ephemeralPublicDer: Buffer.from(lineFields[3], 'base64'),
        wrappedKey: Buffer.from(lineFields[4], 'base64'), origin: lineFields[5] === 'machine' ? 'machine' : 'published',
      });
    } else if (lineName === 'identity-public:' && lineFields[0]) {
      parsedSealed.identityPublicKey = createPublicKey({ key: Buffer.from(lineFields[0], 'base64'), format: 'der', type: 'spki' });
    } else if (lineName === 'identity-password:') {
      parsedSealed.identityPasswordLine = headerLine;
    }
  }
  return parsedSealed;
}

function openVersion1(parsedSealed, privateKey) {
  const sealKey = deriveKey(
    diffieHellman({ privateKey, publicKey: createPublicKey({ key: parsedSealed.ephemeralPublicDer, format: 'der', type: 'spki' }) }),
    parsedSealed.ephemeralPublicDer,
    toSpkiDer(createPublicKey(privateKey)),
  );
  return decryptWithKey(sealKey, parsedSealed.bodyBytes);
}

// Opens a sealed file with the keys this machine has: the ai1 key, then each usable ssh-ed25519 key
// that is a recipient. Returns { plainBytes, openedWith }; throws a message naming what was tried.
export function openSealedText(sealedText, { identityPrivateKey = null, machineSshKeys = [] } = {}) {
  const parsedSealed = parseSealedText(sealedText);
  const failWith = () => {
    const triedKeys = [identityPrivateKey ? 'the ai1 key' : null, ...machineSshKeys.map((machineKey) => `~/.ssh/${machineKey.keyName}`)].filter(Boolean);
    const openingError = new Error(`this file was sealed for another key: only its owner can open it${triedKeys.length ? ` (tried ${triedKeys.join(', ')})` : ' (this machine has no ai1 key and no usable ssh-ed25519 key)'}`);
    openingError.code = 'AI1_NO_MATCHING_KEY';
    throw openingError;
  };
  if (parsedSealed.formatVersion === 1) {
    if (!identityPrivateKey) return failWith();
    try {
      return { plainBytes: openVersion1(parsedSealed, identityPrivateKey), openedWith: 'the ai1 key' };
    } catch {
      return failWith();
    }
  }
  const candidateOpenings = [];
  if (identityPrivateKey && parsedSealed.identityRecipient?.fingerprint === keyFingerprint(createPublicKey(identityPrivateKey))) {
    candidateOpenings.push({ recipient: parsedSealed.identityRecipient, privateKey: identityPrivateKey, openedWith: 'the ai1 key' });
  }
  for (const machineKey of machineSshKeys) {
    const matchingRecipient = parsedSealed.sshRecipients.find((sshRecipient) => sshRecipient.fingerprint === machineKey.fingerprint);
    if (matchingRecipient) candidateOpenings.push({ recipient: matchingRecipient, privateKey: machineKey.privateKey, openedWith: `~/.ssh/${machineKey.keyName}` });
  }
  for (const { recipient, privateKey, openedWith } of candidateOpenings) {
    let fileKey;
    try {
      fileKey = unwrapFileKey(recipient, privateKey);
    } catch {
      continue;
    }
    try {
      return { plainBytes: decryptWithKey(fileKey, parsedSealed.bodyBytes, Buffer.from(parsedSealed.headerText)), openedWith };
    } catch {
      throw new Error('this sealed file was changed after it was sealed: only its owner can open it (take it again from git history)');
    }
  }
  return failWith();
}

// Opens with the ai1 key only (v1 or v2).
export function unsealText(sealedText, privateKey) {
  return openSealedText(sealedText, { identityPrivateKey: privateKey }).plainBytes;
}

export function sealedFilePath(repoRoot, personEmail) {
  return join(repoRoot, CONTRIBUTORS_DIRECTORY, `${normalizeEmail(personEmail)}.sealed`);
}

function readPreviousSealed(repoRoot, personEmail) {
  const sealedPath = sealedFilePath(repoRoot, personEmail);
  if (!existsSync(sealedPath)) return null;
  try {
    return parseSealedText(readFileSync(sealedPath, 'utf8'));
  } catch {
    return null;
  }
}

// Who a new seal is for, with no network: the ai1 key (this machine's, else the previous file's); the
// published keys last fetched by the CLI (else the previous file's published ones); the previous file's
// machine keys; and this machine's own usable ssh-ed25519 keys (origin machine).
export function collectSealRecipients(repoRoot, personEmail, pathOptions) {
  const previousSealed = readPreviousSealed(repoRoot, personEmail);
  const identityPrivateKey = readIdentityIfPresent(pathOptions);
  const previousRecipients = (previousSealed?.sshRecipients || []).map(({ publicBlob, origin }) => ({ publicBlob, origin }));
  const publishedBlobs = readPublishedBlobs(pathOptions);
  const sshRecipients = publishedBlobs
    ? [...publishedBlobs.map((publicBlob) => ({ publicBlob, origin: 'published' })), ...previousRecipients.filter(({ origin }) => origin === 'machine')]
    : previousRecipients;
  const knownFingerprints = new Set(sshRecipients.map(({ publicBlob }) => sshKeyFingerprint(publicBlob)));
  for (const machineKey of listMachineSshKeys(pathOptions).usableKeys) {
    if (!knownFingerprints.has(machineKey.fingerprint)) sshRecipients.push({ publicBlob: machineKey.publicBlob, origin: 'machine' });
  }
  const identityPublicKey = identityPrivateKey ? createPublicKey(identityPrivateKey) : previousSealed?.identityPublicKey || null;
  return {
    identityPublicKey,
    sshRecipients,
    identityPasswordLine: passwordLineFor(identityPublicKey, [readIdentityPasswordLine(pathOptions), previousSealed?.identityPasswordLine].filter(Boolean)),
  };
}

// Seals the person's local files present now into `.ai1/contributors/<email>.sealed`; returns the names sealed.
export function sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions, { excludedFingerprints = [] } = {}) {
  if (!normalizeEmail(personEmail)) throw new Error('sealing needs your git email (git config user.email): it names your sealed file');
  const sealRecipients = collectSealRecipients(repoRoot, personEmail, pathOptions);
  sealRecipients.sshRecipients = sealRecipients.sshRecipients.filter(({ publicBlob }) => !excludedFingerprints.includes(sshKeyFingerprint(publicBlob)));
  const localFiles = {};
  for (const fileName of SEALED_FILE_NAMES) {
    const localPath = join(localDirectoryPath(sharedRoot), fileName);
    if (existsSync(localPath)) localFiles[fileName] = readFileSync(localPath, 'utf8');
  }
  if (!Object.keys(localFiles).length) throw new Error(`nothing to seal in .ai1/local/ (${SEALED_FILE_NAMES.join(', ')})`);
  const sealedPath = sealedFilePath(repoRoot, personEmail);
  mkdirSync(dirname(sealedPath), { recursive: true });
  writeFileSync(sealedPath, sealForRecipients(Buffer.from(JSON.stringify({ version: 1, files: localFiles })), sealRecipients));
  recordSyncPoint(sharedRoot, { localHash: localFilesHash(sharedRoot), sealedHash: sealedFileHash(repoRoot, personEmail) });
  return { sealedPath, fileNames: Object.keys(localFiles) };
}

// Writes the sealed files that are missing in .ai1/local/; refuses to replace different ones unless forced.
export function unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force = false, ...pathOptions } = {}) {
  const sealedPath = sealedFilePath(repoRoot, personEmail || '');
  if (!normalizeEmail(personEmail) || !existsSync(sealedPath)) throw new Error(`no sealed file for ${personEmail || 'your git email'} at ${CONTRIBUTORS_DIRECTORY}/`);
  const { plainBytes } = openSealedText(readFileSync(sealedPath, 'utf8'), {
    identityPrivateKey: readIdentityIfPresent(pathOptions),
    machineSshKeys: listMachineSshKeys(pathOptions).usableKeys,
  });
  const sealedPayload = JSON.parse(plainBytes.toString('utf8'));
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
