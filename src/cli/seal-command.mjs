// `ai1 keys` (the person's own sealing key) and `ai1 local seal|unseal` (their .ai1/local/ files in the
// repo, readable only with that key). See src/core/person-seal.mjs.

import { createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { normalizeEmail, readGitUserEmail, readPersonProfile, writePersonProfile } from '../core/person-project.mjs';
import {
  generateIdentityText, parseIdentityText, writeIdentityFile, readIdentity, readIdentityIfPresent, identityKeyPath, keyFingerprint, sealLocalFiles, unsealLocalFiles, isSealedSyncOn,
  sealedFilePath, parseSealedText, CONTRIBUTORS_DIRECTORY, MIN_PASSWORD_LENGTH, generatePassword, closeIdentityWithPassword, openIdentityWithPassword,
  writeIdentityPasswordLine, localFilesHash,
} from '../core/person-seal.mjs';

export const SEAL_USAGE = 'ai1 keys init [--force] | ai1 keys import < key.txt | ai1 keys show | ai1 local seal | ai1 local unseal [--force] | ai1 local password | ai1 local unlock [--force] | ai1 local sync on|off|status';
// Subcommands of `ai1 local` that read a password (from the terminal, hidden, or from stdin).
export const PASSWORD_SUBCOMMANDS = ['password', 'unlock'];

export function runKeysCommand(commandArguments, { readStandardInput, pathOptions } = {}) {
  const [subcommandName] = commandArguments;
  if (subcommandName === 'init') {
    if (existsSync(identityKeyPath(pathOptions)) && !commandArguments.includes('--force')) {
      return { output: `you already have an ai1 key at ${identityKeyPath(pathOptions)}; --force replaces it (what it sealed can then only be opened with the old one)`, exitCode: 1 };
    }
    const identityText = generateIdentityText();
    const keyPath = writeIdentityFile(identityText, pathOptions);
    return {
      output: [
        `wrote your ai1 key to ${keyPath} (never commit it)`,
        'Keep this line in your password manager; on another machine run `ai1 keys import` and paste it:',
        identityText,
        'Lose it and nobody can open what you sealed. If it leaks, every sealed version in the repo history can be read.',
      ].join('\n'),
      exitCode: 0,
    };
  }
  if (subcommandName === 'import') {
    const identityText = String(readStandardInput()).trim();
    parseIdentityText(identityText);
    return { output: `imported your ai1 key to ${writeIdentityFile(identityText, pathOptions)}`, exitCode: 0 };
  }
  if (subcommandName === 'show') {
    return { output: `ai1 key ${keyFingerprint(createPublicKey(readIdentity(pathOptions)))} at ${identityKeyPath(pathOptions)}`, exitCode: 0 };
  }
  return { output: `usage: ${SEAL_USAGE}`, exitCode: 1 };
}

// The ai1 key this person's sealed file in this repo was sealed for, when this machine does not have it.
function missingIdentityFingerprint(repoRoot, personEmail, pathOptions) {
  const sealedPath = normalizeEmail(personEmail) ? sealedFilePath(repoRoot, personEmail) : null;
  if (!sealedPath || !existsSync(sealedPath) || readIdentityIfPresent(pathOptions)) return null;
  try {
    const { identityPublicKey } = parseSealedText(readFileSync(sealedPath, 'utf8'));
    return identityPublicKey ? keyFingerprint(identityPublicKey) : null;
  } catch {
    return null;
  }
}

// `ai1 local password`: closes the ai1 key with the person's password (creating the key silently when
// there is none), keeps it in their ai1 config and reseals this repo's file so it carries it.
function setPassword(repoRoot, sharedRoot, personEmail, { secretText, pathOptions }) {
  if (missingIdentityFingerprint(repoRoot, personEmail, pathOptions)) {
    return { output: 'your sealed file here belongs to an ai1 key this machine does not have: run `! ai1 local unlock` with your current password first, then change it', exitCode: 1 };
  }
  const typedPassword = String(secretText ?? '').trim();
  if (typedPassword && typedPassword.length < MIN_PASSWORD_LENGTH) {
    return { output: `the password needs at least ${MIN_PASSWORD_LENGTH} characters (leave it empty and ai1 makes one for you)`, exitCode: 1 };
  }
  const passwordText = typedPassword || generatePassword();
  if (!readIdentityIfPresent(pathOptions)) writeIdentityFile(generateIdentityText(), pathOptions);
  const identityPrivateKey = readIdentityIfPresent(pathOptions);
  const passwordLine = closeIdentityWithPassword(identityPrivateKey, passwordText);
  writeIdentityPasswordLine(passwordLine, pathOptions);
  const outputLines = [typedPassword ? 'password set' : `your ai1 password (shown once; keep it where you keep your passwords): ${passwordText}`];
  if (existsSync(sealedFilePath(repoRoot, personEmail || '')) && localFilesHash(sharedRoot)) {
    sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
    outputLines.push('resealed your file here with it; commit it. Your other repos get it at their next seal.');
  } else {
    outputLines.push('your sealed files get it at their next seal.');
  }
  outputLines.push('On a machine where no SSH key opens your file: `! ai1 local unlock`.');
  return { output: outputLines.join('\n'), exitCode: 0 };
}

// `ai1 local unlock`: the password gives this machine the ai1 key back, then the file is unsealed.
function unlockWithPassword(repoRoot, sharedRoot, personEmail, { secretText, force, pathOptions }) {
  const sealedPath = normalizeEmail(personEmail) ? sealedFilePath(repoRoot, personEmail) : null;
  if (!sealedPath || !existsSync(sealedPath)) return { output: `no sealed file for ${personEmail || 'your git email'} at ${CONTRIBUTORS_DIRECTORY}/`, exitCode: 1 };
  const passwordLine = parseSealedText(readFileSync(sealedPath, 'utf8')).identityPasswordLine;
  if (!passwordLine) return { output: 'your sealed file has no password: open it with an SSH key it was sealed for or your ai1 key (`ai1 keys import`), then set one with `ai1 local password`', exitCode: 1 };
  const identityPrivateKey = openIdentityWithPassword(passwordLine, String(secretText ?? '').trim());
  const unlockedFingerprint = keyFingerprint(createPublicKey(identityPrivateKey));
  const presentIdentity = readIdentityIfPresent(pathOptions);
  if (presentIdentity && keyFingerprint(createPublicKey(presentIdentity)) !== unlockedFingerprint && !force) {
    return { output: `this machine already has another ai1 key (${keyFingerprint(createPublicKey(presentIdentity))}, the password opens ${unlockedFingerprint}); --force replaces it (what only the old one opens is then lost here)`, exitCode: 1 };
  }
  writeIdentityFile(identityPrivateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), pathOptions);
  writeIdentityPasswordLine(passwordLine, pathOptions);
  const { fileNames } = unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force, ...pathOptions });
  return { output: `unlocked: this machine has your ai1 key now (no password again here); unsealed ${fileNames.join(', ')} into .ai1/local/`, exitCode: 0 };
}

export function runLocalCommand(repoRoot, commandArguments, { pathOptions, secretText } = {}) {
  const [subcommandName] = commandArguments;
  const sharedRoot = findMainCheckout(repoRoot);
  const personEmail = readGitUserEmail(repoRoot);
  if (subcommandName === 'seal') {
    const { sealedPath, fileNames } = sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
    return { output: `sealed ${fileNames.join(', ')} into ${sealedPath}: only your key opens it; commit it to carry them to your other clones (state.json is never sealed). From now on ai1 keeps it in sync by itself (ai1 local sync off stops it)`, exitCode: 0 };
  }
  if (subcommandName === 'unseal') {
    const { fileNames, replaced } = unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force: commandArguments.includes('--force'), ...pathOptions });
    return { output: `unsealed ${fileNames.join(', ')} into .ai1/local/${replaced.length ? ` (replaced ${replaced.join(', ')})` : ''}`, exitCode: 0 };
  }
  if (subcommandName === 'password') return setPassword(repoRoot, sharedRoot, personEmail, { secretText, pathOptions });
  if (subcommandName === 'unlock') return unlockWithPassword(repoRoot, sharedRoot, personEmail, { secretText, force: commandArguments.includes('--force'), pathOptions });
  if (subcommandName === 'sync') {
    const [, syncSetting] = commandArguments;
    if (syncSetting === 'on' || syncSetting === 'off') {
      writePersonProfile(sharedRoot, { ...readPersonProfile(sharedRoot), sealedSync: syncSetting === 'on' });
      return { output: syncSetting === 'on'
        ? 'sealed sync on: your .ai1/local/ is sealed at the end of a turn when it changed, and unsealed at session start when a newer copy arrives'
        : 'sealed sync off: ai1 no longer seals or unseals by itself (ai1 local seal|unseal still work)', exitCode: 0 };
    }
    if (syncSetting === 'status' || syncSetting === undefined) return { output: `sealed sync: ${isSealedSyncOn(repoRoot, sharedRoot, personEmail) ? 'on' : 'off'}`, exitCode: 0 };
  }
  return { output: `usage: ${SEAL_USAGE}`, exitCode: 1 };
}
