import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWireString } from '../src/core/ssh-keys.mjs';

// Tests that dispatch with the real environment must not fill the person's decision log.
process.env.AI1_DECISION_LOG = '0';

// Creates a throwaway project directory, optionally with a .ai1/config.json.
export function createTemporaryProject(ai1Config) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ai1-test-'));
  if (ai1Config !== undefined) {
    mkdirSync(join(projectRoot, '.ai1'), { recursive: true });
    const configText = typeof ai1Config === 'string' ? ai1Config : JSON.stringify(ai1Config);
    writeFileSync(join(projectRoot, '.ai1', 'config.json'), configText);
  }
  return projectRoot;
}

// An ssh-ed25519 key pair written as OpenSSH files (`<name>` + `<name>.pub`) into `<homeDirectory>/.ssh`,
// built with Node only (no ssh-keygen). A `cipherName` other than 'none' marks it passphrase-protected.
export function writeSshEd25519KeyPair(homeDirectory, keyName = 'id_ed25519', { cipherName = 'none' } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicBytes = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const seedBytes = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const wireUint32 = (numberValue) => {
    const numberBytes = Buffer.alloc(4);
    numberBytes.writeUInt32BE(numberValue);
    return numberBytes;
  };
  const publicBlob = Buffer.concat([encodeWireString('ssh-ed25519'), encodeWireString(publicBytes)]);
  let privateSection = Buffer.concat([
    wireUint32(7), wireUint32(7), encodeWireString('ssh-ed25519'), encodeWireString(publicBytes),
    encodeWireString(Buffer.concat([seedBytes, publicBytes])), encodeWireString('test@machine'),
  ]);
  for (let paddingByte = 1; privateSection.length % 8; paddingByte += 1) privateSection = Buffer.concat([privateSection, Buffer.from([paddingByte])]);
  const keyBytes = Buffer.concat([
    Buffer.from('openssh-key-v1\0', 'latin1'), encodeWireString(cipherName), encodeWireString(cipherName === 'none' ? 'none' : 'bcrypt'),
    encodeWireString(''), wireUint32(1), encodeWireString(publicBlob), encodeWireString(privateSection),
  ]);
  const sshDirectory = join(homeDirectory, '.ssh');
  mkdirSync(sshDirectory, { recursive: true });
  const base64Lines = keyBytes.toString('base64').match(/.{1,70}/g).join('\n');
  writeFileSync(join(sshDirectory, keyName), `-----BEGIN OPENSSH PRIVATE KEY-----\n${base64Lines}\n-----END OPENSSH PRIVATE KEY-----\n`, { mode: 0o600 });
  const publicLine = `ssh-ed25519 ${publicBlob.toString('base64')} test@machine`;
  writeFileSync(join(sshDirectory, `${keyName}.pub`), `${publicLine}\n`);
  return { publicLine, publicBlob, seedBytes, publicBytes };
}

export function bashPayload(projectRoot, commandLine) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: { command: commandLine },
  };
}

// A git checkout named `folderName` with one remote, as files only (no git process).
export function createFakeRepo(folderName, remoteUrl) {
  const repoRoot = join(mkdtempSync(join(tmpdir(), 'ai1-privacy-')), folderName);
  mkdirSync(join(repoRoot, '.git'), { recursive: true });
  writeFileSync(join(repoRoot, '.git', 'config'), `[core]\n\tbare = false\n[remote "origin"]\n\turl = ${remoteUrl}\n`);
  return repoRoot;
}
