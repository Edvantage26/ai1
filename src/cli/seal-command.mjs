// `ai1 keys` (the person's own sealing key) and `ai1 local seal|unseal` (their .ai1/local/ files in the
// repo, readable only with that key). See src/core/person-seal.mjs.

import { createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { normalizeEmail, readGitUserEmail, readPersonProfile, writePersonProfile } from '../core/person-project.mjs';
import {
  generateIdentityText, parseIdentityText, writeIdentityFile, readIdentity, readIdentityIfPresent, identityKeyPath, keyFingerprint, sealLocalFiles, unsealLocalFiles, isSealedSyncOn,
  sealedFilePath, parseSealedText, CONTRIBUTORS_DIRECTORY, MIN_PASSWORD_LENGTH, generatePassword, closeIdentityWithPassword, openIdentityWithPassword,
  writeIdentityPasswordLine, localFilesHash, findPersonFile,
} from '../core/person-seal.mjs';
import { readPublishedKeys, refreshPublishedKeys, setKeySources } from '../core/published-keys.mjs';

export const SEAL_USAGE = 'ai1 keys init [--force] | ai1 keys import < key.txt | ai1 keys show | ai1 keys published [github:<user>|gitlab:<user>...] | ai1 local seal | ai1 local unseal [--force] | ai1 local password | ai1 local unlock [--force] | ai1 local recipients [remove <fingerprint>] | ai1 local sync on|off|status';
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
  if (subcommandName === 'published') return { output: describePublishedKeys(pathOptions), exitCode: 0 };
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

// The network part of `ai1 keys published`, `ai1 local seal` and `ai1 local sync on`, run by the CLI
// before the command itself: fetches the person's published ssh-ed25519 keys. Returns notes to print.
export async function refreshPublishedKeysBefore(commandName, commandArguments, { pathOptions, fetchText, runSsh } = {}) {
  const [subcommandName, ...restArguments] = commandArguments;
  if (commandName === 'keys' && subcommandName === 'published') {
    if (!restArguments.length) return [];
    setKeySources(restArguments, pathOptions);
  } else if (!(commandName === 'local' && (subcommandName === 'seal' || (subcommandName === 'sync' && restArguments[0] === 'on')))) {
    return [];
  }
  return (await refreshPublishedKeys(pathOptions, { fetchText, runSsh })).notes;
}

function describePublishedKeys(pathOptions) {
  const { sources, keysBySource } = readPublishedKeys(pathOptions);
  if (!sources.length) return 'no published SSH keys set: `ai1 keys published github:<user>` (or gitlab:<user>; several allowed)';
  return sources.map((sourceText) => {
    const fetchedKeys = keysBySource[sourceText];
    return fetchedKeys ? `${sourceText}: ${fetchedKeys.lines.length} ssh-ed25519 key(s), fetched ${fetchedKeys.fetchedAt}` : `${sourceText}: not fetched yet`;
  }).join('\n');
}

// `ai1 local recipients [remove <fingerprint>]`: who this repo's sealed file opens for.
function manageRecipients(repoRoot, sharedRoot, personEmail, commandArguments, pathOptions) {
  const sealedPath = normalizeEmail(personEmail) ? sealedFilePath(repoRoot, personEmail) : null;
  if (!sealedPath || !existsSync(sealedPath)) return { output: `no sealed file for ${personEmail || 'your git email'} at ${CONTRIBUTORS_DIRECTORY}/`, exitCode: 1 };
  const parsedSealed = parseSealedText(readFileSync(sealedPath, 'utf8'));
  const [, actionName, fingerprintToRemove] = commandArguments;
  if (actionName === 'remove') {
    const removedRecipient = parsedSealed.sshRecipients.find((sshRecipient) => sshRecipient.fingerprint === fingerprintToRemove);
    if (!removedRecipient) return { output: `no ssh-ed25519 recipient ${fingerprintToRemove || '(fingerprint missing)'} in your sealed file (see \`ai1 local recipients\`)`, exitCode: 1 };
    sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions, { excludedFingerprints: [fingerprintToRemove] });
    return {
      output: `resealed without ${fingerprintToRemove}; commit it. Older versions in git history still open with that key.${removedRecipient.origin === 'published' ? ' It is published on your git host: remove it there too, or the next fetch adds it back.' : ''}`,
      exitCode: 0,
    };
  }
  const recipientLines = [
    parsedSealed.formatVersion === 1 ? 'format v1: only the ai1 key (the next seal writes v2)' : null,
    parsedSealed.identityPublicKey ? `ai1 key ${keyFingerprint(parsedSealed.identityPublicKey)}${parsedSealed.identityPasswordLine ? ' (also opens with your password)' : ''}` : null,
    ...parsedSealed.sshRecipients.map((sshRecipient) => `ssh-ed25519 ${sshRecipient.fingerprint} (${sshRecipient.origin === 'machine' ? 'a machine of yours' : 'published on your git host'})`),
  ].filter(Boolean);
  return { output: recipientLines.join('\n'), exitCode: 0 };
}

export function runLocalCommand(repoRoot, commandArguments, { pathOptions, secretText } = {}) {
  const [subcommandName] = commandArguments;
  const sharedRoot = findMainCheckout(repoRoot);
  const personEmail = readGitUserEmail(repoRoot);
  if (subcommandName === 'seal') {
    const { sealedPath, fileNames, isPlainMode } = sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
    return { output: `${isPlainMode ? 'packed' : 'sealed'} ${fileNames.join(', ')} into ${sealedPath}: ${isPlainMode ? 'compressed, NOT encrypted (anyone with the repo reads it)' : 'only your keys open it'}; commit it to carry them to your other clones (state.json is never sealed). From now on ai1 keeps it in sync by itself (ai1 local sync off stops it)`, exitCode: 0 };
  }
  if (subcommandName === 'unseal') {
    const { fileNames, replaced } = unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force: commandArguments.includes('--force'), ...pathOptions });
    return { output: `unsealed ${fileNames.join(', ')} into .ai1/local/${replaced.length ? ` (replaced ${replaced.join(', ')})` : ''}`, exitCode: 0 };
  }
  if (subcommandName === 'recipients') return manageRecipients(repoRoot, sharedRoot, personEmail, commandArguments, pathOptions);
  if (subcommandName === 'password') return setPassword(repoRoot, sharedRoot, personEmail, { secretText, pathOptions });
  if (subcommandName === 'unlock') return unlockWithPassword(repoRoot, sharedRoot, personEmail, { secretText, force: commandArguments.includes('--force'), pathOptions });
  if (subcommandName === 'sync') {
    const [, syncSetting] = commandArguments;
    if (syncSetting === 'off') {
      writePersonProfile(sharedRoot, { ...readPersonProfile(sharedRoot), sealedSync: false });
      return { output: 'sealed sync off: ai1 no longer seals or unseals by itself (ai1 local seal|unseal still work)', exitCode: 0 };
    }
    if (syncSetting === 'on') {
      const sealedMode = commandArguments.includes('--plain') ? 'plain' : 'encrypted';
      const previousMode = readPersonProfile(sharedRoot).sealedMode === 'plain' ? 'plain' : 'encrypted';
      writePersonProfile(sharedRoot, { ...readPersonProfile(sharedRoot), sealedSync: true, sealedMode });
      const outputLines = [sealedMode === 'plain'
        ? `sealed sync on, PLAIN: your .ai1/local/ goes to ${CONTRIBUTORS_DIRECTORY}/<email>.packed only compressed, NOT encrypted - anyone who can read this repo reads your profile, contacts, subscriptions and routines. \`ai1 local sync on\` turns encryption back on.`
        : 'sealed sync on: your .ai1/local/ is sealed (encrypted) at the end of a turn when it changed, and unsealed at session start when a newer copy arrives'];
      if (sealedMode !== previousMode && findPersonFile(repoRoot, personEmail) && localFilesHash(sharedRoot)) {
        const { sealedPath } = sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
        outputLines.push(`switched to ${sealedPath} (the other file is removed); commit both changes`);
      }
      return { output: outputLines.join('\n'), exitCode: 0 };
    }
    if (syncSetting === 'status' || syncSetting === undefined) {
      const syncOn = isSealedSyncOn(repoRoot, sharedRoot, personEmail);
      return { output: `sealed sync: ${syncOn ? `on (${readPersonProfile(sharedRoot).sealedMode === 'plain' ? 'plain, not encrypted' : 'encrypted'})` : 'off'}`, exitCode: 0 };
    }
  }
  return { output: `usage: ${SEAL_USAGE}`, exitCode: 1 };
}
