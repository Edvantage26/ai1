// The person's `ssh-ed25519` keys as seal recipients (issue #4): OpenSSH public lines and unencrypted
// `openssh-key-v1` private keys read with Node only, and converted to X25519 the way age does for
// `ssh-ed25519` recipients (Edwards y -> Montgomery u for the public key, SHA-512 of the seed for the
// private one). Passphrase-protected, RSA, agent-only and hardware keys are listed as not usable, with why.

import { createHash, createPrivateKey, createPublicKey } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SSH_ED25519_TYPE = 'ssh-ed25519';
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');
const FIELD_PRIME = (1n << 255n) - 19n;
const PRIVATE_KEY_MAGIC = 'openssh-key-v1\0';

// Reads the SSH wire format: uint32 lengths followed by bytes.
function createWireReader(wireBytes) {
  let readOffset = 0;
  const readUint32 = () => {
    if (readOffset + 4 > wireBytes.length) throw new Error('truncated SSH key');
    const readValue = wireBytes.readUInt32BE(readOffset);
    readOffset += 4;
    return readValue;
  };
  const readString = () => {
    const stringLength = readUint32();
    if (readOffset + stringLength > wireBytes.length) throw new Error('truncated SSH key');
    const stringBytes = wireBytes.subarray(readOffset, readOffset + stringLength);
    readOffset += stringLength;
    return stringBytes;
  };
  return { readUint32, readString };
}

export function encodeWireString(stringBytes) {
  const lengthBytes = Buffer.alloc(4);
  lengthBytes.writeUInt32BE(stringBytes.length);
  return Buffer.concat([lengthBytes, Buffer.from(stringBytes)]);
}

// SHA-256 of the OpenSSH public blob, first 16 hex chars: tells the person's keys apart.
export function sshKeyFingerprint(publicBlob) {
  return createHash('sha256').update(publicBlob).digest('hex').slice(0, 16);
}

// "ssh-ed25519 AAAA... comment" -> { keyType, publicBlob, comment, ed25519PublicBytes? }; null when not a key line.
export function parsePublicKeyLine(publicKeyLine) {
  const [keyType, blobBase64, ...commentWords] = String(publicKeyLine).trim().split(/\s+/);
  if (!keyType || !blobBase64 || !/^[A-Za-z0-9+/=]+$/.test(blobBase64)) return null;
  const publicBlob = Buffer.from(blobBase64, 'base64');
  try {
    const wireReader = createWireReader(publicBlob);
    if (wireReader.readString().toString('latin1') !== keyType) return null;
    const parsedKey = { keyType, publicBlob, comment: commentWords.join(' ') };
    if (keyType === SSH_ED25519_TYPE) {
      parsedKey.ed25519PublicBytes = wireReader.readString();
      if (parsedKey.ed25519PublicBytes.length !== 32) return null;
    }
    return parsedKey;
  } catch {
    return null;
  }
}

export function publicKeyLineFromBlob(publicBlob) {
  return `${SSH_ED25519_TYPE} ${Buffer.from(publicBlob).toString('base64')}`;
}

function modularPower(baseValue, exponentValue) {
  let resultValue = 1n;
  let currentBase = baseValue % FIELD_PRIME;
  let remainingExponent = exponentValue;
  while (remainingExponent > 0n) {
    if (remainingExponent & 1n) resultValue = (resultValue * currentBase) % FIELD_PRIME;
    currentBase = (currentBase * currentBase) % FIELD_PRIME;
    remainingExponent >>= 1n;
  }
  return resultValue;
}

function littleEndianToBigInt(littleEndianBytes) {
  return BigInt(`0x${Buffer.from(littleEndianBytes).reverse().toString('hex') || '0'}`);
}

function bigIntToLittleEndian(bigValue) {
  return Buffer.from(bigValue.toString(16).padStart(64, '0'), 'hex').reverse();
}

// Ed25519 public key (32 bytes) -> X25519 public KeyObject: u = (1 + y) / (1 - y) mod 2^255 - 19.
export function ed25519PublicToX25519(ed25519PublicBytes) {
  const edwardsBytes = Buffer.from(ed25519PublicBytes);
  edwardsBytes[31] &= 0x7f;
  const edwardsY = littleEndianToBigInt(edwardsBytes);
  const denominator = (1n - edwardsY + FIELD_PRIME) % FIELD_PRIME;
  if (denominator === 0n) throw new Error('not a usable ssh-ed25519 key');
  const montgomeryU = ((1n + edwardsY) * modularPower(denominator, FIELD_PRIME - 2n)) % FIELD_PRIME;
  return createPublicKey({ key: Buffer.concat([X25519_SPKI_PREFIX, bigIntToLittleEndian(montgomeryU)]), format: 'der', type: 'spki' });
}

// Ed25519 seed (32 bytes) -> X25519 private KeyObject: the first half of SHA-512(seed), clamped as libsodium does.
export function ed25519SeedToX25519(ed25519Seed) {
  const scalarBytes = Buffer.from(createHash('sha512').update(ed25519Seed).digest().subarray(0, 32));
  scalarBytes[0] &= 248;
  scalarBytes[31] &= 127;
  scalarBytes[31] |= 64;
  return createPrivateKey({ key: Buffer.concat([X25519_PKCS8_PREFIX, scalarBytes]), format: 'der', type: 'pkcs8' });
}

// An OpenSSH private key file -> { usable: true, ed25519Seed, publicBlob } or { usable: false, reason }.
export function parsePrivateKeyText(privateKeyText) {
  const pemBody = String(privateKeyText).match(/-----BEGIN OPENSSH PRIVATE KEY-----([\s\S]*?)-----END OPENSSH PRIVATE KEY-----/);
  if (!pemBody) return { usable: false, reason: 'not an OpenSSH private key file' };
  const keyBytes = Buffer.from(pemBody[1].replace(/\s+/g, ''), 'base64');
  if (keyBytes.subarray(0, PRIVATE_KEY_MAGIC.length).toString('latin1') !== PRIVATE_KEY_MAGIC) return { usable: false, reason: 'not an OpenSSH private key file' };
  try {
    const wireReader = createWireReader(keyBytes.subarray(PRIVATE_KEY_MAGIC.length));
    const cipherName = wireReader.readString().toString('latin1');
    wireReader.readString();
    wireReader.readString();
    if (cipherName !== 'none') return { usable: false, reason: 'it has a passphrase (ai1 cannot open it; use your ai1 password instead)' };
    if (wireReader.readUint32() !== 1) return { usable: false, reason: 'the file holds more than one key' };
    const publicBlob = wireReader.readString();
    const privateReader = createWireReader(wireReader.readString());
    if (privateReader.readUint32() !== privateReader.readUint32()) return { usable: false, reason: 'damaged private key' };
    const keyType = privateReader.readString().toString('latin1');
    if (keyType !== SSH_ED25519_TYPE) return { usable: false, reason: `${keyType} keys cannot be used, only ssh-ed25519` };
    privateReader.readString();
    const secretBytes = privateReader.readString();
    if (secretBytes.length !== 64) return { usable: false, reason: 'damaged private key' };
    return { usable: true, ed25519Seed: Buffer.from(secretBytes.subarray(0, 32)), publicBlob: Buffer.from(publicBlob) };
  } catch (parseError) {
    return { usable: false, reason: parseError.message };
  }
}

export function sshDirectoryPath({ homeDirectory = homedir() } = {}) {
  return join(homeDirectory, '.ssh');
}

function describeUnusableType(keyType) {
  if (keyType.startsWith('sk-')) return 'a hardware key (its private part is not on this machine)';
  if (keyType === 'ssh-rsa') return 'an RSA key (only ssh-ed25519 can be used)';
  return `a ${keyType} key (only ssh-ed25519 can be used)`;
}

// This machine's SSH keys from `~/.ssh/*.pub`: usable ones with their X25519 private key, the others with why.
// Reads only small files in one folder, no process: cheap enough for a hook.
export function listMachineSshKeys(pathOptions = {}) {
  const sshDirectory = sshDirectoryPath(pathOptions);
  if (!existsSync(sshDirectory)) return { usableKeys: [], unusableKeys: [] };
  const usableKeys = [];
  const unusableKeys = [];
  let directoryEntries = [];
  try {
    directoryEntries = readdirSync(sshDirectory).filter((entryName) => entryName.endsWith('.pub')).sort();
  } catch {
    return { usableKeys, unusableKeys };
  }
  for (const publicFileName of directoryEntries) {
    const keyName = publicFileName.slice(0, -'.pub'.length);
    let parsedPublic = null;
    try {
      parsedPublic = parsePublicKeyLine(readFileSync(join(sshDirectory, publicFileName), 'utf8'));
    } catch {
      continue;
    }
    if (!parsedPublic) continue;
    const fingerprint = sshKeyFingerprint(parsedPublic.publicBlob);
    if (parsedPublic.keyType !== SSH_ED25519_TYPE) {
      unusableKeys.push({ keyName, fingerprint, reason: describeUnusableType(parsedPublic.keyType) });
      continue;
    }
    const privatePath = join(sshDirectory, keyName);
    if (!existsSync(privatePath)) {
      unusableKeys.push({ keyName, fingerprint, reason: 'no private key file next to it (only in ssh-agent or a hardware token)' });
      continue;
    }
    let parsedPrivate;
    try {
      parsedPrivate = parsePrivateKeyText(readFileSync(privatePath, 'utf8'));
    } catch (readError) {
      parsedPrivate = { usable: false, reason: `cannot read it (${readError.code || readError.message})` };
    }
    if (!parsedPrivate.usable) {
      unusableKeys.push({ keyName, fingerprint, reason: parsedPrivate.reason });
      continue;
    }
    if (!parsedPrivate.publicBlob.equals(parsedPublic.publicBlob)) {
      unusableKeys.push({ keyName, fingerprint, reason: 'its .pub does not match the private key' });
      continue;
    }
    usableKeys.push({
      keyName,
      fingerprint,
      publicBlob: parsedPublic.publicBlob,
      privateKey: ed25519SeedToX25519(parsedPrivate.ed25519Seed),
    });
  }
  return { usableKeys, unusableKeys };
}
