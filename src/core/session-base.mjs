// The HEAD at session start, shared by the modules that need to know what this session changed
// (okf-upkeep, sizing). Recorded once per session; resume/compact must not move the baseline.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { runGit, tryGit } from './git.mjs';
import {
  resolveStateDirectory, sessionStatePath, readStateText, writeStateText, removeExpiredStateFiles, stateModifiedMilliseconds,
} from './session-state.mjs';

export function readGitHead(projectRoot) {
  return tryGit(projectRoot, ['rev-parse', 'HEAD']);
}

function baseHeadStatePath(hookInput, projectRoot, environment) {
  return sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'base');
}

function submoduleBaseStatePath(hookInput, projectRoot, environment) {
  return sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'submodule-base');
}

// HEAD of every initialized submodule (nested ones too), by its path from the repo; {} without submodules.
export function readSubmoduleHeads(projectRoot) {
  if (!existsSync(join(projectRoot, '.gitmodules'))) return {};
  const statusLines = tryGit(projectRoot, ['submodule', 'status', '--recursive']) || '';
  return Object.fromEntries(listLines(statusLines)
    .map((statusLine) => /^[ +U]([0-9a-f]{7,})\s+(\S+)/.exec(statusLine))
    .filter(Boolean)
    .map((statusMatch) => [statusMatch[2], statusMatch[1]]));
}

// The submodule HEADs recorded with the base (written once, like the base itself).
function recordSubmoduleBase(hookInput, projectRoot, environment) {
  const submoduleBasePath = submoduleBaseStatePath(hookInput, projectRoot, environment);
  const recordedText = readStateText(submoduleBasePath);
  if (recordedText !== null) return JSON.parse(recordedText);
  const submoduleHeads = readSubmoduleHeads(projectRoot);
  writeStateText(submoduleBasePath, JSON.stringify(submoduleHeads));
  return submoduleHeads;
}

const MAX_SUBMODULE_DEPTH = 3;

function listLines(gitOutput) {
  return gitOutput.split('\n').filter(Boolean);
}

let expiredStateRemoved = false;

// Several SessionStart modules call this (each can be switched off alone); the base is written once
// and expired state is cleaned once per hook run. Never throws: an unwritable state directory must
// not cost the caller its brief (readSessionBase records the base later, when it can).
export function recordSessionBaseHead(hookInput, projectRoot, environment) {
  try {
    if (!expiredStateRemoved) {
      removeExpiredStateFiles(resolveStateDirectory(environment));
      expiredStateRemoved = true;
    }
    const baseHeadPath = baseHeadStatePath(hookInput, projectRoot, environment);
    if (readStateText(baseHeadPath) === null) {
      const gitHead = readGitHead(projectRoot);
      if (gitHead) {
        writeStateText(baseHeadPath, gitHead);
        recordSubmoduleBase(hookInput, projectRoot, environment);
      }
    }
  } catch (stateError) {
    process.stderr.write(`ai1: could not record the session base: ${stateError.message}\n`);
  }
}

// { baseHead, submoduleBases, sessionStartMilliseconds }, or null outside a git repo. A session that
// started elsewhere takes the current HEAD (and submodule HEADs) as its baseline from now on.
export function readSessionBase(hookInput, projectRoot, environment) {
  const baseHeadPath = baseHeadStatePath(hookInput, projectRoot, environment);
  let baseHead = readStateText(baseHeadPath);
  if (!baseHead) {
    baseHead = readGitHead(projectRoot);
    if (!baseHead) return null;
    writeStateText(baseHeadPath, baseHead);
  }
  let submoduleBases = {};
  try {
    submoduleBases = recordSubmoduleBase(hookInput, projectRoot, environment);
  } catch {
    // Without it, a changed submodule is compared with the commit the parent recorded.
  }
  return { baseHead, submoduleBases, sessionStartMilliseconds: stateModifiedMilliseconds(baseHeadPath) };
}


// Submodule paths of a checkout, from its .gitmodules (none when it has no submodules).
function listSubmodulePaths(repoRoot) {
  if (!existsSync(join(repoRoot, '.gitmodules'))) return new Set();
  const pathLines = tryGit(repoRoot, ['config', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$']) || '';
  return new Set(listLines(pathLines).map((pathLine) => pathLine.slice(pathLine.indexOf(' ') + 1)));
}

// The files a changed submodule stands for, with the submodule path in front: its own changes since
// its HEAD at session start (`submoduleBases`, by path from the top repo) or, unrecorded, since the
// commit the parent recorded at `baseCommit`; nested submodules expanded too. Falls back to the
// submodule path itself when that cannot be told (base commit not present locally).
function expandSubmodule(repoRoot, baseCommit, submodulePath, pathPrefix, depth, submoduleBases) {
  const submoduleRoot = join(repoRoot, submodulePath);
  if (!existsSync(join(submoduleRoot, '.git'))) return [];
  const treeEntry = tryGit(repoRoot, ['ls-tree', baseCommit, '--', submodulePath]) || '';
  const submoduleBase = submoduleBases[`${pathPrefix}${submodulePath}`] || /^160000 commit ([0-9a-f]+)\t/.exec(treeEntry)?.[1];
  if (submoduleBase && tryGit(submoduleRoot, ['cat-file', '-e', `${submoduleBase}^{commit}`]) === null) return [`${pathPrefix}${submodulePath}`];
  // Added during the session: no recorded commit, so only what is changed or new in its checkout.
  return listChangedFiles(submoduleRoot, submoduleBase || 'HEAD', `${pathPrefix}${submodulePath}/`, depth + 1, submoduleBases);
}

function listChangedFiles(repoRoot, baseCommit, pathPrefix, depth, submoduleBases) {
  const submodulePaths = depth < MAX_SUBMODULE_DEPTH ? listSubmodulePaths(repoRoot) : new Set();
  const changedFiles = [];
  for (const changedPath of listLines(runGit(repoRoot, ['diff', '--name-only', baseCommit]))) {
    if (submodulePaths.has(changedPath)) changedFiles.push(...expandSubmodule(repoRoot, baseCommit, changedPath, pathPrefix, depth, submoduleBases));
    else changedFiles.push(`${pathPrefix}${changedPath}`);
  }
  for (const untrackedPath of listLines(runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']))) changedFiles.push(`${pathPrefix}${untrackedPath}`);
  return changedFiles;
}

// Repo-relative paths changed since `baseHead`: tracked changes (committed or not) and untracked
// files that git does not ignore. Deleted files are included; callers check existence. A changed
// submodule is listed by its own changed files (path from this repo), so a superproject with one ai1
// config sees what changed inside its submodules; a repo without submodules gets the plain git lists.
// `sessionBase`: what readSessionBase returns, or a bare commit (submodules then compared with the
// commits the parent recorded there).
export function listFilesChangedSinceBase(projectRoot, sessionBase) {
  const { baseHead, submoduleBases = {} } = typeof sessionBase === 'string' ? { baseHead: sessionBase } : sessionBase;
  return [...new Set(listChangedFiles(projectRoot, baseHead, '', 0, submoduleBases))];
}
