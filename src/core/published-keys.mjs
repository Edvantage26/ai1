// The person's `ssh-ed25519` keys published by their git host (`https://github.com/<user>.keys`,
// `https://gitlab.com/<user>.keys`), as seal recipients. Fetched only by the CLI (`ai1 local sync on`,
// `ai1 local seal`, `ai1 keys published`) and kept in the person's ai1 config folder, so a hook seals
// for them with no network. Which accounts: `ai1 keys published github:<user>`; when none is set, the CLI
// asks `ssh -T git@github.com` / `git@gitlab.com` who the person is (timeout, fails open).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { userConfigDirectory } from './skill-customization.mjs';
import { parsePublicKeyLine, SSH_ED25519_TYPE } from './ssh-keys.mjs';

export const PUBLISHED_KEY_HOSTS = { github: 'https://github.com', gitlab: 'https://gitlab.com' };
const SSH_PROBES = [
  { hostName: 'github', sshTarget: 'git@github.com', userPattern: /Hi ([A-Za-z0-9-]+)!/ },
  { hostName: 'gitlab', sshTarget: 'git@gitlab.com', userPattern: /Welcome to GitLab, @([A-Za-z0-9_.-]+)!/ },
];
const FETCH_TIMEOUT_MILLISECONDS = 8000;
const SSH_PROBE_TIMEOUT_MILLISECONDS = 8000;

export function publishedKeysPath({ environment = process.env, homeDirectory = homedir() } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), 'published-keys.json');
}

export function readPublishedKeys(pathOptions) {
  const keysPath = publishedKeysPath(pathOptions);
  if (!existsSync(keysPath)) return { sources: [], keysBySource: {} };
  try {
    const storedKeys = JSON.parse(readFileSync(keysPath, 'utf8'));
    return { sources: Array.isArray(storedKeys.sources) ? storedKeys.sources : [], keysBySource: storedKeys.keysBySource || {} };
  } catch {
    return { sources: [], keysBySource: {} };
  }
}

function writePublishedKeys(publishedKeys, pathOptions) {
  const keysPath = publishedKeysPath(pathOptions);
  mkdirSync(dirname(keysPath), { recursive: true });
  writeFileSync(keysPath, `${JSON.stringify(publishedKeys, null, 2)}\n`);
}

// "github:ana" -> { hostName, userName }; null when not a known host or not a valid user name.
export function parseKeySource(sourceText) {
  const [hostName, userName] = String(sourceText).split(':');
  if (!PUBLISHED_KEY_HOSTS[hostName] || !/^[A-Za-z0-9_.-]+$/.test(userName || '')) return null;
  return { hostName, userName };
}

export function setKeySources(sourceTexts, pathOptions) {
  const invalidSources = sourceTexts.filter((sourceText) => !parseKeySource(sourceText));
  if (invalidSources.length) throw new Error(`not a key source: ${invalidSources.join(', ')} (use github:<user> or gitlab:<user>)`);
  const publishedKeys = readPublishedKeys(pathOptions);
  const keysBySource = Object.fromEntries(Object.entries(publishedKeys.keysBySource).filter(([sourceText]) => sourceTexts.includes(sourceText)));
  writePublishedKeys({ sources: sourceTexts, keysBySource }, pathOptions);
}

// The published public blobs from every source last fetched; null when nothing was ever fetched.
export function readPublishedBlobs(pathOptions) {
  const { sources, keysBySource } = readPublishedKeys(pathOptions);
  const fetchedSources = sources.filter((sourceText) => keysBySource[sourceText]);
  if (!fetchedSources.length) return null;
  return fetchedSources.flatMap((sourceText) => keysBySource[sourceText].lines.map((keyLine) => parsePublicKeyLine(keyLine)?.publicBlob).filter(Boolean));
}

// Asks the git hosts over SSH who the person is; [] when SSH is missing, refused or slow.
export function probeKeySources({ runSsh = defaultRunSsh } = {}) {
  const foundSources = [];
  for (const { hostName, sshTarget, userPattern } of SSH_PROBES) {
    const probeOutput = runSsh(sshTarget);
    const userMatch = probeOutput && probeOutput.match(userPattern);
    if (userMatch) foundSources.push(`${hostName}:${userMatch[1]}`);
  }
  return foundSources;
}

function defaultRunSsh(sshTarget) {
  try {
    return execFileSync('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', sshTarget], {
      encoding: 'utf8', timeout: SSH_PROBE_TIMEOUT_MILLISECONDS, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (sshError) {
    // GitHub answers with exit code 1 and the greeting on stderr.
    return `${sshError.stdout || ''}${sshError.stderr || ''}`;
  }
}

// Fetches every source and keeps its ssh-ed25519 lines. Returns notes for the person: what was kept,
// what was skipped (RSA...), what could not be fetched (the previous list stays).
export async function refreshPublishedKeys(pathOptions, { fetchText = defaultFetchText, runSsh } = {}) {
  let publishedKeys = readPublishedKeys(pathOptions);
  const refreshNotes = [];
  if (!publishedKeys.sources.length) {
    const probedSources = probeKeySources({ runSsh });
    if (!probedSources.length) return { notes: ['no published SSH keys: set your account with `ai1 keys published github:<user>` (or gitlab:<user>) to seal for them'] };
    setKeySources(probedSources, pathOptions);
    publishedKeys = readPublishedKeys(pathOptions);
    refreshNotes.push(`found your account: ${probedSources.join(', ')} (change it with \`ai1 keys published\`)`);
  }
  for (const sourceText of publishedKeys.sources) {
    const { hostName, userName } = parseKeySource(sourceText);
    let fetchedText;
    try {
      fetchedText = await fetchText(`${PUBLISHED_KEY_HOSTS[hostName]}/${userName}.keys`);
    } catch (fetchError) {
      refreshNotes.push(`could not fetch the keys of ${sourceText} (${fetchError.message}); kept the previous list`);
      continue;
    }
    const parsedKeys = String(fetchedText).split(/\r?\n/).map((keyLine) => parsePublicKeyLine(keyLine)).filter(Boolean);
    const ed25519Keys = parsedKeys.filter((parsedKey) => parsedKey.keyType === SSH_ED25519_TYPE);
    const skippedCount = parsedKeys.length - ed25519Keys.length;
    publishedKeys.keysBySource[sourceText] = { fetchedAt: new Date().toISOString(), lines: ed25519Keys.map((parsedKey) => `${parsedKey.keyType} ${parsedKey.publicBlob.toString('base64')}`) };
    refreshNotes.push(`${sourceText}: ${ed25519Keys.length} ssh-ed25519 key(s)${skippedCount ? `, ${skippedCount} other key(s) skipped (only ssh-ed25519 can seal)` : ''}`);
  }
  writePublishedKeys(publishedKeys, pathOptions);
  return { notes: refreshNotes };
}

async function defaultFetchText(keysUrl) {
  const keysResponse = await fetch(keysUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MILLISECONDS) });
  if (!keysResponse.ok) throw new Error(`HTTP ${keysResponse.status}`);
  return keysResponse.text();
}
