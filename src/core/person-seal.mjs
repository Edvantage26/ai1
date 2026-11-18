// Sealed sync of the person's own files (`ai1 local seal|unseal`, `ai1 keys`): their profile,
// subscriptions and contacts from `.ai1/local/` go into `.ai1/people/<email>.sealed`, committed, which only
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
import { localDirectoryPath, normalizeEmail, PROFILE_FILE_NAME } from './person-project.mjs';
import { ensureDirectoryIgnoredByItself } from './project-paths.mjs';

export const SEALED_HEADER = 'ai1-sealed-v1';
export const PEOPLE_DIRECTORY = `${AI1_DIRECTORY}/people`;
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
  return join(repoRoot, PEOPLE_DIRECTORY, `${normalizeEmail(personEmail)}.sealed`);
}

// Seals the person's local files present now into `.ai1/people/<email>.sealed`; returns the names sealed.
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
  return { sealedPath, fileNames: Object.keys(localFiles) };
}

// Writes the sealed files that are missing in .ai1/local/; refuses to replace different ones unless forced.
export function unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force = false, ...pathOptions } = {}) {
  const sealedPath = sealedFilePath(repoRoot, personEmail || '');
  if (!normalizeEmail(personEmail) || !existsSync(sealedPath)) throw new Error(`no sealed file for ${personEmail || 'your git email'} at ${PEOPLE_DIRECTORY}/`);
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
  return { fileNames: Object.keys(sealedPayload.files).filter((fileName) => SEALED_FILE_NAMES.includes(fileName)), replaced: force ? conflictingNames : [] };
}
