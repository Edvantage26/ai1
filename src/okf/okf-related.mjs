// Related repositories: other repositories whose knowledge this one needs, listed in `related` of
// .ai1/config.json (structured and validated, never read from prose). Each fact lives in the repository
// that changes it; this repo only links to it. Used by okf-file-context (a read of another repository
// with its own bundle: offer to relate it, or point to its bundle), okf-index (the list at session start)
// and `ai1 status` (candidates found in the docs, for setup). Everything here reads the disk only.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { findMainCheckout, findWorkingTreeTop, readGitDirectories } from '../core/project-roots.mjs';

const BUNDLE_CANDIDATES = ['.ai1/okf', '.okf'];
const MIN_CANDIDATE_NAME_LENGTH = 4;
const MAX_PARENT_ENTRIES = 300;
const MAX_CANDIDATES = 10;
const ROOT_DOCS = ['CLAUDE.md', 'README.md', 'PROJECT.md'];

// `owner/name` from a remote URL (https, ssh or scp-like), lower case, or null.
export function remoteIdentity(remoteUrl) {
  const identityMatch = /[/:]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(String(remoteUrl || '').trim());
  return identityMatch ? `${identityMatch[1]}/${identityMatch[2]}`.toLowerCase() : null;
}

// The `origin` URL of a checkout, read from its git config on disk.
export function readOriginUrl(repoRoot) {
  const gitDirectories = readGitDirectories(repoRoot);
  if (!gitDirectories) return null;
  try {
    const configText = readFileSync(join(gitDirectories.commonDirectory, 'config'), 'utf8');
    return /\[remote "origin"\][^[]*?\burl\s*=\s*(\S+)/.exec(configText)?.[1] || null;
  } catch {
    return null;
  }
}

// The bundle index of a repository: the given bundle folder, else .ai1/okf, else .okf; its main
// checkout's when the worktree has none. Null when there is none.
export function findBundleIndex(repoRoot, bundleFolder) {
  const bundleFolders = bundleFolder ? [bundleFolder] : BUNDLE_CANDIDATES;
  for (const candidateRoot of [...new Set([repoRoot, findMainCheckout(repoRoot)])]) {
    for (const candidateFolder of bundleFolders) {
      const indexPath = join(candidateRoot, candidateFolder, 'index.md');
      if (existsSync(indexPath)) return indexPath;
    }
  }
  return null;
}

// Each entry with where it is on this machine: { entry, repoRoot (main checkout) | null, bundleIndex | null }.
export function resolveRelatedEntries(projectRoot, relatedEntries = []) {
  return relatedEntries.map((relatedEntry) => {
    let repoRoot = null;
    if (relatedEntry.path) {
      const entryPath = isAbsolute(relatedEntry.path) ? relatedEntry.path : resolve(projectRoot, relatedEntry.path);
      const treeTop = existsSync(entryPath) ? findWorkingTreeTop(entryPath) : null;
      repoRoot = treeTop ? findMainCheckout(treeTop) : null;
    }
    return { entry: relatedEntry, repoRoot, bundleIndex: repoRoot ? findBundleIndex(repoRoot, relatedEntry.bundle) : null };
  });
}

// The `related` entry for the repository at `repoRoot`, or null: same main checkout as its `path`, or
// its `origin` is the entry's `remote`.
export function findRelatedEntry(projectRoot, relatedEntries, repoRoot) {
  const mainCheckout = findMainCheckout(repoRoot);
  const originIdentity = remoteIdentity(readOriginUrl(mainCheckout));
  return resolveRelatedEntries(projectRoot, relatedEntries).find((resolvedEntry) => resolvedEntry.repoRoot === mainCheckout
    || (originIdentity && resolvedEntry.entry.remote && remoteIdentity(`/${resolvedEntry.entry.remote}`) === originIdentity))?.entry || null;
}

function readDocsText(projectRoot, bundleDirectory) {
  const docTexts = [];
  for (const docName of ROOT_DOCS) {
    try {
      docTexts.push(readFileSync(join(projectRoot, docName), 'utf8'));
    } catch {
      // not every repo has every doc
    }
  }
  const pendingDirectories = bundleDirectory && existsSync(bundleDirectory) ? [bundleDirectory] : [];
  while (pendingDirectories.length) {
    const currentDirectory = pendingDirectories.pop();
    for (const directoryEntry of readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = join(currentDirectory, directoryEntry.name);
      if (directoryEntry.isDirectory()) pendingDirectories.push(entryPath);
      else if (directoryEntry.name.endsWith('.md')) docTexts.push(readFileSync(entryPath, 'utf8'));
    }
  }
  return docTexts.join('\n');
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Whether the docs name `repoName` as a repository, not as an ordinary word or an inner folder: as a code
// span of its own (`name` or `owner/name`), as a sibling path (`../name`), as a link text, or, for a compound name (with - or _), anywhere as
// a whole word.
export function isNamedAsRepository(docsText, repoName) {
  const escapedName = escapeRegExp(repoName);
  const repositoryForms = [
    `\`(?:[\\w.-]+/)?${escapedName}\``,
    `(^|[^\\w.])\\.\\./${escapedName}(?=[/\\s)\`'"]|$)`,
    `\\[${escapedName}\\]`,
  ];
  if (/[-_]/.test(repoName)) repositoryForms.push(`(^|[^\\w-])${escapedName}([^\\w-]|$)`);
  return new RegExp(repositoryForms.join('|'), 'im').test(docsText);
}

// Repositories the docs name that are not in `related` yet, each shaped as an entry to add:
// git repositories next to this one named as a whole word, and remote URLs with this repo's owner.
export function listRelatedCandidates(projectRoot, relatedEntries = [], bundleDirectory = null) {
  const docsText = readDocsText(projectRoot, bundleDirectory);
  if (!docsText) return [];
  const mainCheckout = findMainCheckout(projectRoot);
  const ownIdentity = remoteIdentity(readOriginUrl(mainCheckout));
  const ownOwner = ownIdentity ? ownIdentity.split('/')[0] : null;
  const resolvedEntries = resolveRelatedEntries(projectRoot, relatedEntries);
  const relatedRoots = new Set(resolvedEntries.map((resolvedEntry) => resolvedEntry.repoRoot).filter(Boolean));
  const relatedRemotes = new Set(resolvedEntries.map((resolvedEntry) => resolvedEntry.entry.remote && remoteIdentity(`/${resolvedEntry.entry.remote}`)).filter(Boolean));
  const candidates = new Map();
  const parentDirectory = dirname(mainCheckout);
  let siblingEntries = [];
  try {
    siblingEntries = readdirSync(parentDirectory, { withFileTypes: true }).slice(0, MAX_PARENT_ENTRIES);
  } catch {
    // an unreadable parent only means no sibling candidates
  }
  for (const siblingEntry of siblingEntries) {
    const siblingName = siblingEntry.name;
    const siblingRoot = join(parentDirectory, siblingName);
    if (!siblingEntry.isDirectory() || siblingName.length < MIN_CANDIDATE_NAME_LENGTH || siblingRoot === mainCheckout) continue;
    if (!existsSync(join(siblingRoot, '.git')) || relatedRoots.has(findMainCheckout(siblingRoot))) continue;
    if (!isNamedAsRepository(docsText, siblingName)) continue;
    const siblingRemote = remoteIdentity(readOriginUrl(siblingRoot));
    if (siblingRemote && relatedRemotes.has(siblingRemote)) continue;
    candidates.set(siblingRemote || siblingName, { name: siblingName, path: `../${siblingName}`, ...(siblingRemote ? { remote: siblingRemote } : {}), has_bundle: Boolean(findBundleIndex(siblingRoot)) });
  }
  if (ownOwner) {
    for (const urlMatch of docsText.matchAll(/(?:https?:\/\/|git@)[\w.-]+[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?=[\s)/#'"`>\]]|$)/g)) {
      const urlIdentity = `${urlMatch[1]}/${urlMatch[2]}`.toLowerCase();
      if (urlMatch[1].toLowerCase() !== ownOwner || urlIdentity === ownIdentity || relatedRemotes.has(urlIdentity) || candidates.has(urlIdentity)) continue;
      candidates.set(urlIdentity, { name: urlMatch[2], path: null, remote: urlIdentity, has_bundle: null });
    }
  }
  return [...candidates.values()].slice(0, MAX_CANDIDATES);
}

export function describeBundleLocation(projectRoot, resolvedEntry) {
  if (resolvedEntry.bundleIndex) return `\`${resolvedEntry.bundleIndex}\``;
  if (resolvedEntry.entry.read_without_clone) return `not cloned here; read it with \`${resolvedEntry.entry.read_without_clone}\``;
  return resolvedEntry.entry.path ? `not found at \`${resolvedEntry.entry.path}\` on this machine` : `remote \`${resolvedEntry.entry.remote}\`, not cloned here`;
}

export function repositoryLabel(repoRoot) {
  return basename(repoRoot);
}
