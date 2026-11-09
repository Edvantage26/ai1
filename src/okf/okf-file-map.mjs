// Which bundle concepts describe a repo file. Built from what each concept already says, no new
// field: the top-level `resource` (OKF spec §4.1, the asset the concept describes), `sources[].resource`
// (§5.1, what it derives from) and code paths cited in backticks in the body. Shared by
// okf-file-context (pointer when the agent reads or edits the file) and okf-upkeep (which concepts a
// change probably affects). Cached per project, rebuilt when the bundle changes.

import { join, posix } from 'node:path';
import { readFrontmatterField } from '../core/frontmatter.mjs';
import { readStateText, writeStateText, shortHash } from '../core/session-state.mjs';
import { listBundleConcepts, newestModificationMilliseconds } from './okf-bundle.mjs';

const MAX_CONCEPTS_PER_FILE = 2;
// Strength of where a path is cited; the score of a match is strength * 2, minus 1 for a folder.
const CITATION_STRENGTH = { resource: 3, source: 2, body: 1 };
const PATH_SEGMENT_PATTERN = /^[\w.@-]+$/;
const FILE_EXTENSION_PATTERN = /\.[A-Za-z0-9]+$/;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;
const INLINE_CODE_PATTERN = /`([^`\n]+)`/g;
const FENCED_BLOCK_PATTERN = /^(```|~~~)[\s\S]*?^\1/gm;

// `path:12`, `path#L12` and a leading `./` say where in the file, not which file.
function stripLocation(citedText) {
  return citedText.trim().replace(/#L\d+.*$/, '').replace(/:\d+(:\d+)?$/, '');
}

// A clean repo-relative path (`src/x.mjs`, `src/core/`), or null.
function cleanRepoPath(candidatePath, { minFolderSegments = 1 } = {}) {
  if (!candidatePath || candidatePath.startsWith('..') || candidatePath.startsWith('/')) return null;
  const isFolder = candidatePath.endsWith('/');
  const pathSegments = candidatePath.replace(/\/+$/, '').split('/');
  if (!pathSegments.every((pathSegment) => PATH_SEGMENT_PATTERN.test(pathSegment) && pathSegment !== '.' && pathSegment !== '..')) return null;
  if (isFolder) return pathSegments.length >= minFolderSegments ? { path: `${pathSegments.join('/')}/`, isFolder } : null;
  return { path: pathSegments.join('/'), isFolder };
}

// A `resource` value as a repo path, following the path forms of the OKF spec (§6.2): `/x` is
// bundle-relative, `./x` and `../x` are relative to the concept file. A bare relative path
// (`src/x.mjs`) is read from the repo root: an ai1 convention, the spec would read it from the
// concept. URLs and scope descriptors ("all queries in project X") are not repo paths.
export function resolveResourcePath(resourceValue, bundleRelativePath, conceptRelativePath) {
  const resourceText = stripLocation(String(resourceValue).replace(/^['"]|['"]$/g, ''));
  if (!resourceText || URI_SCHEME_PATTERN.test(resourceText) || /\s/.test(resourceText)) return null;
  const isFolder = resourceText.endsWith('/');
  let repoPath;
  if (resourceText.startsWith('/')) repoPath = posix.join(bundleRelativePath, resourceText);
  else if (resourceText.startsWith('./') || resourceText.startsWith('../')) {
    repoPath = posix.join(posix.dirname(posix.join(bundleRelativePath, conceptRelativePath)), resourceText);
  } else repoPath = posix.normalize(resourceText);
  return cleanRepoPath(isFolder && !repoPath.endsWith('/') ? `${repoPath}/` : repoPath);
}

// Every `resource` in the `sources` block: block mappings (`- id: a` / `  resource: x`), inline
// mappings (`- { id: a, resource: x }`) and plain string items (`- src/x.mjs`).
export function readSourceResources(frontmatterText) {
  const frontmatterLines = (frontmatterText || '').split(/\r?\n/);
  const sourcesLineIndex = frontmatterLines.findIndex((frontmatterLine) => /^sources:\s*$/.test(frontmatterLine));
  if (sourcesLineIndex < 0) return [];
  const sourceResources = [];
  for (const blockLine of frontmatterLines.slice(sourcesLineIndex + 1)) {
    if (/^[^\s-]/.test(blockLine)) break;
    const resourceMatch = /resource:\s*([^,}]+)/.exec(blockLine);
    if (resourceMatch) sourceResources.push(resourceMatch[1].trim());
    else {
      const plainItemMatch = /^\s*-\s*([^:{}\s][^:{}]*)$/.exec(blockLine);
      if (plainItemMatch) sourceResources.push(plainItemMatch[1].trim());
    }
  }
  return sourceResources;
}

// Code paths cited in backticks in the body, outside fenced blocks (trees and examples, not
// citations). Kept only when they look like a repo path: relative, with a `/`, a file with an
// extension or a folder of at least two segments (`src/` or `test/` alone would match too much).
export function readBodyCodePaths(bodyText, bundleConceptPaths) {
  const citedPaths = [];
  for (const inlineCodeMatch of (bodyText || '').replace(FENCED_BLOCK_PATTERN, '').matchAll(INLINE_CODE_PATTERN)) {
    const citedText = stripLocation(inlineCodeMatch[1]).replace(/^\.\//, '');
    if (!citedText.includes('/') || URI_SCHEME_PATTERN.test(citedText)) continue;
    if (citedText.endsWith('.md') && bundleConceptPaths.has(citedText.replace(/^\//, ''))) continue;
    const cleanedPath = cleanRepoPath(citedText, { minFolderSegments: 2 });
    if (cleanedPath && (cleanedPath.isFolder || FILE_EXTENSION_PATTERN.test(cleanedPath.path))) citedPaths.push(cleanedPath);
  }
  return citedPaths;
}

// [{ conceptPath, repoPath, title, citedPaths: [{ path, isFolder, strength }] }], one entry per
// concept that cites at least one repo path.
export function buildFileMap(bundleDirectory, bundleRelativePath) {
  const bundleConcepts = listBundleConcepts(bundleDirectory);
  const bundleConceptPaths = new Set(bundleConcepts.map((bundleConcept) => bundleConcept.relativePath.split('\\').join('/')));
  const fileMap = [];
  for (const bundleConcept of bundleConcepts) {
    const conceptPath = bundleConcept.relativePath.split('\\').join('/');
    const strongestByPath = new Map();
    const addCitedPath = (cleanedPath, strength) => {
      if (!cleanedPath) return;
      const knownPath = strongestByPath.get(cleanedPath.path);
      if (!knownPath || knownPath.strength < strength) strongestByPath.set(cleanedPath.path, { ...cleanedPath, strength });
    };
    const resourceValue = readFrontmatterField(bundleConcept.frontmatterText, 'resource');
    if (resourceValue) addCitedPath(resolveResourcePath(resourceValue, bundleRelativePath, conceptPath), CITATION_STRENGTH.resource);
    for (const sourceResource of readSourceResources(bundleConcept.frontmatterText)) {
      addCitedPath(resolveResourcePath(sourceResource, bundleRelativePath, conceptPath), CITATION_STRENGTH.source);
    }
    for (const bodyPath of readBodyCodePaths(bundleConcept.bodyText, bundleConceptPaths)) addCitedPath(bodyPath, CITATION_STRENGTH.body);
    if (!strongestByPath.size) continue;
    fileMap.push({
      conceptPath,
      repoPath: posix.join(bundleRelativePath, conceptPath),
      title: bundleConcept.title || conceptPath,
      citedPaths: [...strongestByPath.values()],
    });
  }
  return fileMap;
}

// The map from the state directory when the bundle has not changed since it was built.
export function loadFileMap(bundleDirectory, bundleRelativePath, projectRoot, stateDirectory) {
  const cacheKey = `${bundleRelativePath}:${newestModificationMilliseconds(bundleDirectory)}`;
  const cachePath = join(stateDirectory, `${shortHash(projectRoot)}.okf-file-map`);
  try {
    const cachedMap = JSON.parse(readStateText(cachePath) || 'null');
    if (cachedMap?.cacheKey === cacheKey) return cachedMap.fileMap;
  } catch {
    // A corrupt cache is rebuilt below.
  }
  const fileMap = buildFileMap(bundleDirectory, bundleRelativePath);
  writeStateText(cachePath, JSON.stringify({ cacheKey, fileMap }));
  return fileMap;
}

// The concepts that describe a repo file, most specific first, at most two: the best score wins
// (resource > sources > body, a file before a folder), then the longest matched path, then the
// concept that cites fewer paths (the specific one over an overview), then the name.
export function findConceptsForFile(fileMap, relativeFilePath) {
  const filePath = relativeFilePath.split('\\').join('/');
  const conceptMatches = [];
  for (const conceptEntry of fileMap) {
    let bestMatch = null;
    for (const citedPath of conceptEntry.citedPaths) {
      const isMatch = citedPath.isFolder ? filePath.startsWith(citedPath.path) : filePath === citedPath.path;
      if (!isMatch) continue;
      const matchScore = citedPath.strength * 2 - (citedPath.isFolder ? 1 : 0);
      if (!bestMatch || matchScore > bestMatch.matchScore || (matchScore === bestMatch.matchScore && citedPath.path.length > bestMatch.matchedLength)) {
        bestMatch = { matchScore, matchedLength: citedPath.path.length };
      }
    }
    if (bestMatch) conceptMatches.push({ ...conceptEntry, ...bestMatch });
  }
  if (!conceptMatches.length) return [];
  const bestScore = Math.max(...conceptMatches.map((conceptMatch) => conceptMatch.matchScore));
  const bestScoreMatches = conceptMatches.filter((conceptMatch) => conceptMatch.matchScore === bestScore);
  const bestLength = Math.max(...bestScoreMatches.map((conceptMatch) => conceptMatch.matchedLength));
  return bestScoreMatches
    .filter((conceptMatch) => conceptMatch.matchedLength === bestLength)
    .sort((firstMatch, secondMatch) => firstMatch.citedPaths.length - secondMatch.citedPaths.length
      || firstMatch.conceptPath.localeCompare(secondMatch.conceptPath))
    .slice(0, MAX_CONCEPTS_PER_FILE)
    .map(({ conceptPath, repoPath, title }) => ({ conceptPath, repoPath, title }));
}
