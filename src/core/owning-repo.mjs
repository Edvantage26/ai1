// The repository a path belongs to, compared with the repository the session was launched in, read
// from the `.git` entries on disk (no git process, so a PreToolUse hook stays in milliseconds):
// - `launch`: the launch repository itself, or one of its linked worktrees (same common git dir);
// - `submodule`: a submodule of the launch repository, nested ones included (its git dir lives under
//   the launch repository's `.git/modules/`, or, not absorbed, its path is listed in `.gitmodules`);
// - `foreign`: any other repository (a sibling clone, or anything when the launch directory is not a
//   repository).
// `hasAi1` says whether that repository (or its main checkout) has `.ai1/config.json`.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CONFIG_RELATIVE_PATH } from './config.mjs';
import { findMainCheckout, findWorkingTreeTop, readGitDirectories } from './project-roots.mjs';

function isInside(parentPath, childPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

// Paths listed as `path = <dir>` in the launch repository's .gitmodules (repo-relative, `/` separators).
function readSubmodulePaths(launchTreeTop) {
  try {
    return [...readFileSync(join(launchTreeTop, '.gitmodules'), 'utf8').matchAll(/^\s*path\s*=\s*(.+?)\s*$/gm)].map((pathMatch) => pathMatch[1]);
  } catch {
    return [];
  }
}

function isSubmoduleOfLaunch(repoRoot, repoDirectories, launchTreeTop, launchDirectories) {
  if (launchDirectories && isInside(join(launchDirectories.commonDirectory, 'modules'), repoDirectories.commonDirectory)) return true;
  if (!launchTreeTop || !isInside(launchTreeTop, repoRoot)) return false;
  const repoRelativePath = relative(launchTreeTop, repoRoot).split(sep).join('/');
  return readSubmodulePaths(launchTreeTop).includes(repoRelativePath);
}

export function repositoryHasAi1(repoRoot) {
  return existsSync(join(repoRoot, CONFIG_RELATIVE_PATH)) || existsSync(join(findMainCheckout(repoRoot), CONFIG_RELATIVE_PATH));
}

// { repoRoot, relation, hasAi1 } for `targetPath` (absolute, or relative to `workingDirectory`), or
// null when it is in no repository or its `.git` cannot be read.
export function describeOwningRepository(targetPath, launchRoot, workingDirectory = launchRoot) {
  const absolutePath = isAbsolute(targetPath) ? targetPath : resolve(workingDirectory, targetPath);
  const isDirectory = existsSync(absolutePath) && statSync(absolutePath).isDirectory();
  const repoRoot = findWorkingTreeTop(isDirectory ? absolutePath : dirname(absolutePath));
  if (!repoRoot) return null;
  const repoDirectories = readGitDirectories(repoRoot);
  if (!repoDirectories) return null;
  const launchTreeTop = findWorkingTreeTop(launchRoot);
  const launchDirectories = launchTreeTop ? readGitDirectories(launchTreeTop) : null;
  let relation = 'foreign';
  if (launchDirectories && launchDirectories.commonDirectory === repoDirectories.commonDirectory) relation = 'launch';
  else if (isSubmoduleOfLaunch(repoRoot, repoDirectories, launchTreeTop, launchDirectories)) relation = 'submodule';
  return { repoRoot, relation, hasAi1: repositoryHasAi1(repoRoot) };
}
