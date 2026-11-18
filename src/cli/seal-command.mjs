// `ai1 keys` (the person's own sealing key) and `ai1 local seal|unseal` (their .ai1/local/ files in the
// repo, readable only with that key). See src/core/person-seal.mjs.

import { createPublicKey } from 'node:crypto';
import { existsSync } from 'node:fs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { readGitUserEmail } from '../core/person-project.mjs';
import {
  generateIdentityText, parseIdentityText, writeIdentityFile, readIdentity, identityKeyPath, keyFingerprint, sealLocalFiles, unsealLocalFiles,
} from '../core/person-seal.mjs';

export const SEAL_USAGE = 'ai1 keys init [--force] | ai1 keys import < key.txt | ai1 keys show | ai1 local seal | ai1 local unseal [--force]';

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

export function runLocalCommand(repoRoot, commandArguments, { pathOptions } = {}) {
  const [subcommandName] = commandArguments;
  const sharedRoot = findMainCheckout(repoRoot);
  const personEmail = readGitUserEmail(repoRoot);
  if (subcommandName === 'seal') {
    const { sealedPath, fileNames } = sealLocalFiles(repoRoot, sharedRoot, personEmail, pathOptions);
    return { output: `sealed ${fileNames.join(', ')} into ${sealedPath}: only your key opens it; commit it to carry them to your other clones (state.json is never sealed)`, exitCode: 0 };
  }
  if (subcommandName === 'unseal') {
    const { fileNames, replaced } = unsealLocalFiles(repoRoot, sharedRoot, personEmail, { force: commandArguments.includes('--force'), ...pathOptions });
    return { output: `unsealed ${fileNames.join(', ')} into .ai1/local/${replaced.length ? ` (replaced ${replaced.join(', ')})` : ''}`, exitCode: 0 };
  }
  return { output: `usage: ${SEAL_USAGE}`, exitCode: 1 };
}
