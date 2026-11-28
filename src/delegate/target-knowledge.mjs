// The OKF knowledge of another repository, seen from this session: which of its concepts describe one
// of its files (its own file map, as okf-file-context does for the launch repo) and whether a file is
// part of its bundle. Used for hot edits and reads of other repositories with ai1.

import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { findWorkingTreeTop } from '../core/project-roots.mjs';
import { resolveStateDirectory } from '../core/session-state.mjs';
import { resolveBundleDirectory } from '../okf/okf-bundle.mjs';
import { findConceptsForFile, loadFileMap } from '../okf/okf-file-map.mjs';

// Harness files, never described by a concept.
const SKIPPED_PREFIXES = ['.ai1/', '.claude/'];

// { workingTree, relativePath } of a file, `/`-separated, or null outside a repository.
export function locateInWorkingTree(filePath) {
  const workingTree = findWorkingTreeTop(dirname(filePath));
  if (!workingTree) return null;
  return { workingTree, relativePath: relative(workingTree, filePath).split('\\').join('/') };
}

export function isKnowledgeBundleFile(filePath) {
  return Boolean(locateInWorkingTree(filePath)?.relativePath.startsWith(`${KNOWLEDGE_BUNDLE_PATH}/`));
}

// The concepts of the file's own repository that describe it: [{ conceptPath, absolutePath, title }].
export function findTargetConcepts(filePath, environment = process.env) {
  const location = locateInWorkingTree(filePath);
  if (!location || SKIPPED_PREFIXES.some((skippedPrefix) => location.relativePath.startsWith(skippedPrefix))) return [];
  const bundleDirectory = resolveBundleDirectory(location.workingTree);
  if (!existsSync(join(bundleDirectory, 'index.md'))) return [];
  const fileMap = loadFileMap(bundleDirectory, KNOWLEDGE_BUNDLE_PATH, location.workingTree, resolveStateDirectory(environment));
  return findConceptsForFile(fileMap, location.relativePath)
    .map((conceptMatch) => ({ conceptPath: conceptMatch.conceptPath, absolutePath: join(location.workingTree, conceptMatch.repoPath), title: conceptMatch.title }));
}
