// Private data in a text meant for a public issue on the ai1 repo (issue #6): the person's repo names,
// home paths and user name, emails, IPs, hostnames, secrets, and the names this repo keeps as private
// knowledge (contacts, client brands). Deterministic, no network: used by `ai1 issue check` and by the
// `issue-guard` hook before anything reaches github.com/Edvantage26/ai1. Each hit names the placeholder
// that replaces it (`<repo>`, `<host>`...). Only the hits leave this module.

import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { findSecretLines } from './secret-lines.mjs';
import { readFrontmatterField } from './frontmatter.mjs';
import { loadContacts } from '../messages/contacts.mjs';
import { listBundleConcepts } from '../okf/okf-bundle.mjs';
import { findBundleIndex } from '../okf/okf-related.mjs';

export const AI1_REPOSITORY = 'Edvantage26/ai1';
export const PLACEHOLDERS = {
  'repo name': '<repo>', contact: '<contact>', client: '<client>', host: '<host>', email: '<email>',
  ip: '<ip>', 'home path': '<home>', 'user name': '<user>', secret: '<secret>',
};

// Names shorter than this, or common words, are never private names: a repo called `web` or a user
// called `runner` would otherwise block every report.
const MIN_PRIVATE_NAME_LENGTH = 4;
const COMMON_WORDS = new Set([
  'app', 'apps', 'web', 'api', 'docs', 'doc', 'src', 'lib', 'test', 'tests', 'main', 'master', 'user', 'users',
  'admin', 'root', 'runner', 'home', 'dev', 'prod', 'server', 'client', 'frontend', 'backend', 'core', 'data',
  'site', 'www', 'repo', 'project', 'code', 'work', 'tmp', 'temp', 'build', 'dist', 'config', 'scripts', 'tools',
  'plugin', 'plugins', 'agent', 'agents', 'claude', 'node', 'github', 'ubuntu', 'debian', 'linux', 'windows',
  'macos', 'default', 'demo', 'example', 'sample', 'local', 'shared', 'common', 'utils', 'assets', 'public',
  'private', 'ai1', 'edvantage26', 'hooks', 'skills', 'worktree', 'worktrees', 'issue', 'issues',
]);
const PUBLIC_DOMAINS = ['github.com', 'githubusercontent.com', 'github.io', 'gitlab.com', 'bitbucket.org', 'anthropic.com',
  'claude.com', 'claude.ai', 'nodejs.org', 'npmjs.com', 'npmjs.org', 'python.org', 'docker.com', 'microsoft.com', 'apple.com',
  'google.com', 'mozilla.org', 'w3.org', 'wikipedia.org', 'stackoverflow.com', 'json-schema.org', 'semver.org',
  'example.com', 'example.org', 'example.net', 'localhost'];
// Real top-level domains that are not common file extensions (`plan.md`, `x.sh`, `a.py` are files).
const DOMAIN_TLDS = 'com|net|org|io|dev|app|ai|co|es|eu|tv|cloud|me|info|biz|xyz|tech|site|online|de|fr|uk|us|it|nl|pt';
const URL_PATTERN = /https?:\/\/([^\s/)>'"`\]]+)/gi;
const DOMAIN_PATTERN = new RegExp(`(?<![\\w@.-])((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${DOMAIN_TLDS}))(?![\\w-]|\\.[\\w])`, 'gi');
const EMAIL_PATTERN = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;
const IP_PATTERN = /(?<![\w.])(\d{1,3}(?:\.\d{1,3}){3})(?![\w.])/g;
const GENERIC_IPS = new Set(['127.0.0.1', '0.0.0.0']);
const POSIX_HOME_PATTERN = /\/(?:home|Users)\/([^/\s'"`<>()\]]+)/g;
const WINDOWS_HOME_PATTERN = /[A-Za-z]:\\+Users\\+([^\\\s'"`<>()\]]+)/gi;
const ALLOWED_AI1_TEXT = /(?:https?:\/\/)?(?:www\.)?github\.com\/Edvantage26\/ai1\b[^\s)>'"`\]]*|\bEdvantage26\/ai1\b/gi;
const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;
const MAX_SESSION_PATHS = 300;

function foldText(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function isPrivateNameCandidate(name) {
  const foldedName = foldText(name).trim();
  return foldedName.length >= MIN_PRIVATE_NAME_LENGTH && !COMMON_WORDS.has(foldedName);
}

function isPublicHost(hostName) {
  const foldedHost = hostName.toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
  return PUBLIC_DOMAINS.some((publicDomain) => foldedHost === publicDomain || foldedHost.endsWith(`.${publicDomain}`));
}

function isPlaceholder(text) {
  return /^<[^>]*>$/.test(text) || /^[$%]/.test(text);
}

// `owner/name` of a GitHub-style remote URL (ssh or https), or null.
export function parseRemoteSlug(remoteUrl) {
  const slugMatch = /[:/]([^/:\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(String(remoteUrl || '').trim());
  return slugMatch ? { owner: slugMatch[1], name: slugMatch[2] } : null;
}

export function isAi1Slug(remoteSlug) {
  return Boolean(remoteSlug) && `${remoteSlug.owner}/${remoteSlug.name}`.toLowerCase() === AI1_REPOSITORY.toLowerCase();
}

// The config file of a git checkout: `.git/config`, or for a worktree (`.git` is a file) the common
// dir's config (`gitdir:`, then `commondir`).
function gitConfigPath(gitRoot) {
  const dotGitPath = join(gitRoot, '.git');
  if (statSync(dotGitPath).isDirectory()) return join(dotGitPath, 'config');
  const gitDirMatch = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGitPath, 'utf8'));
  if (!gitDirMatch) return null;
  const gitDirectory = resolve(gitRoot, gitDirMatch[1].trim());
  const commonDirFile = join(gitDirectory, 'commondir');
  const commonDirectory = existsSync(commonDirFile) ? resolve(gitDirectory, readFileSync(commonDirFile, 'utf8').trim()) : gitDirectory;
  return join(commonDirectory, 'config');
}

// The remote slugs of a checkout, read from its git config as text (no git process).
export function readRemoteSlugs(gitRoot) {
  try {
    const configPath = gitConfigPath(gitRoot);
    if (!configPath || !existsSync(configPath)) return [];
    return [...readFileSync(configPath, 'utf8').matchAll(/^\s*url\s*=\s*(.+)$/gm)].map((urlMatch) => parseRemoteSlug(urlMatch[1])).filter(Boolean);
  } catch {
    return [];
  }
}

// The top of the git checkout holding a path (walking up to a `.git`), or null. `visitedDirectories`
// caches answers across calls.
export function findGitRoot(targetPath, visitedDirectories = new Map()) {
  let currentDirectory = resolve(targetPath);
  const walkedDirectories = [];
  let gitRoot = null;
  for (;;) {
    if (visitedDirectories.has(currentDirectory)) { gitRoot = visitedDirectories.get(currentDirectory); break; }
    walkedDirectories.push(currentDirectory);
    if (existsSync(join(currentDirectory, '.git'))) { gitRoot = currentDirectory; break; }
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
  }
  for (const walkedDirectory of walkedDirectories) visitedDirectories.set(walkedDirectory, gitRoot);
  return gitRoot;
}

// The private names of one checkout: its folder name and its remotes' owner and name. None for ai1's
// own repo (and its worktrees), whose names are public.
export function listRepoNames(gitRoot) {
  const remoteSlugs = readRemoteSlugs(gitRoot);
  if (remoteSlugs.some(isAi1Slug)) return [];
  return [basename(gitRoot), ...remoteSlugs.flatMap((remoteSlug) => [remoteSlug.owner, remoteSlug.name])];
}

// Absolute paths under a home folder named in the tail of a session transcript (tool calls and their
// results alike: any repo the session touched).
export function listSessionPaths(transcriptPath) {
  if (!transcriptPath || !existsSync(transcriptPath)) return [];
  const transcriptSize = statSync(transcriptPath).size;
  const readLength = Math.min(transcriptSize, TRANSCRIPT_TAIL_BYTES);
  const tailBuffer = Buffer.alloc(readLength);
  const fileDescriptor = openSync(transcriptPath, 'r');
  try {
    readSync(fileDescriptor, tailBuffer, 0, readLength, transcriptSize - readLength);
  } finally {
    closeSync(fileDescriptor);
  }
  const tailText = tailBuffer.toString('utf8');
  const sessionPaths = new Set();
  for (const pathMatch of tailText.matchAll(/\/(?:home|Users)\/[^\s"'\\`<>:;,)]+/g)) {
    sessionPaths.add(pathMatch[0]);
    if (sessionPaths.size >= MAX_SESSION_PATHS) break;
  }
  return [...sessionPaths];
}

function readOperatingSystemUserName() {
  try {
    return userInfo().username;
  } catch {
    return '';
  }
}

function listClientBrandOwners(projectRoot) {
  const bundleIndex = findBundleIndex(projectRoot);
  if (!bundleIndex) return [];
  try {
    return listBundleConcepts(dirname(bundleIndex))
      .map((bundleConcept) => readFrontmatterField(bundleConcept.frontmatterText, 'brand_owner'))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// [{ name, kind }]: what must not appear in a public issue written from this repo.
export function collectPrivateNames({ projectRoot, sharedRoot = projectRoot, sessionPaths = [], homeDirectory = homedir(), userName = readOperatingSystemUserName() }) {
  const privateNames = [];
  const addName = (name, kind) => {
    if (name && isPrivateNameCandidate(name)) privateNames.push({ name: String(name).trim(), kind });
  };
  const visitedDirectories = new Map();
  const gitRoots = new Set();
  for (const candidatePath of [projectRoot, sharedRoot, ...sessionPaths]) {
    if (!candidatePath || !isAbsolute(candidatePath)) continue;
    const gitRoot = findGitRoot(candidatePath, visitedDirectories);
    if (gitRoot) gitRoots.add(gitRoot);
  }
  for (const gitRoot of gitRoots) for (const repoName of listRepoNames(gitRoot)) addName(repoName, 'repo name');
  for (const contact of loadContacts(projectRoot, sharedRoot)) {
    addName(contact.name, 'contact');
    if (contact.email) privateNames.push({ name: contact.email, kind: 'email' });
  }
  for (const brandOwner of listClientBrandOwners(sharedRoot)) addName(brandOwner, 'client');
  addName(userName, 'user name');
  addName(basename(homeDirectory || ''), 'user name');
  const seenNames = new Set();
  return privateNames.filter((privateName) => {
    const nameKey = foldText(privateName.name);
    if (seenNames.has(nameKey)) return false;
    seenNames.add(nameKey);
    return true;
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findHitsInLine(textLine, privateNames) {
  const lineHits = [];
  const addHit = (kind, value) => lineHits.push({ kind, value, placeholder: PLACEHOLDERS[kind] });
  for (const homeMatch of [...textLine.matchAll(POSIX_HOME_PATTERN), ...textLine.matchAll(WINDOWS_HOME_PATTERN)]) {
    if (!isPlaceholder(homeMatch[1])) addHit('home path', homeMatch[0]);
  }
  const emailDomains = new Set();
  for (const emailMatch of textLine.matchAll(EMAIL_PATTERN)) {
    emailDomains.add(emailMatch[1].toLowerCase());
    if (!isPublicHost(emailMatch[1])) addHit('email', emailMatch[0]);
  }
  const urlHosts = new Set();
  for (const urlMatch of textLine.matchAll(URL_PATTERN)) {
    const hostName = urlMatch[1].replace(/^[^@]*@/, '');
    urlHosts.add(hostName.toLowerCase().replace(/:\d+$/, ''));
    if (!isPublicHost(hostName) && !isPlaceholder(hostName)) addHit('host', hostName);
  }
  for (const domainMatch of textLine.matchAll(DOMAIN_PATTERN)) {
    const domainName = domainMatch[1].toLowerCase();
    if (urlHosts.has(domainName) || emailDomains.has(domainName) || isPublicHost(domainName)) continue;
    addHit('host', domainMatch[1]);
  }
  for (const ipMatch of textLine.matchAll(IP_PATTERN)) {
    const isAddress = ipMatch[1].split('.').every((octet) => Number(octet) <= 255);
    if (isAddress && !GENERIC_IPS.has(ipMatch[1])) addHit('ip', ipMatch[1]);
  }
  const foldedLine = foldText(textLine);
  for (const privateName of privateNames) {
    const namePattern = new RegExp(`(?<![\\p{L}\\p{N}_-])${escapeRegExp(foldText(privateName.name))}(?![\\p{L}\\p{N}_-])`, 'u');
    if (namePattern.test(foldedLine)) addHit(privateName.kind, privateName.name);
  }
  return lineHits;
}

// [{ kind, value, where, placeholder }] for a title and a body, each value once (its first place).
export function findPrivateData({ title = '', body = '' }, privateNames = []) {
  const allHits = [];
  const scanText = (text, describeWhere) => {
    const cleanText = String(text || '').replace(ALLOWED_AI1_TEXT, '');
    const textLines = cleanText.split(/\r?\n/);
    textLines.forEach((textLine, lineIndex) => {
      for (const lineHit of findHitsInLine(textLine, privateNames)) allHits.push({ ...lineHit, where: describeWhere(lineIndex + 1) });
    });
    for (const secretLine of findSecretLines(cleanText)) allHits.push({ kind: 'secret', value: '(a token or key)', where: describeWhere(secretLine), placeholder: PLACEHOLDERS.secret });
  };
  scanText(title, () => 'title');
  scanText(body, (lineNumber) => `line ${lineNumber}`);
  const seenHits = new Set();
  return allHits.filter((privateHit) => {
    const hitKey = `${privateHit.kind}\u0000${privateHit.value.toLowerCase()}`;
    if (seenHits.has(hitKey)) return false;
    seenHits.add(hitKey);
    return true;
  });
}

export function formatPrivateHits(privateHits) {
  return privateHits.map((privateHit) => `- ${privateHit.where}: ${privateHit.kind} \`${privateHit.value}\` -> \`${privateHit.placeholder}\``).join('\n');
}
