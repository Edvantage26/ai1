// The HEAD at session start, shared by the modules that need to know what this session changed
// (okf-upkeep, sizing). Recorded once per session; resume/compact must not move the baseline.

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
      if (gitHead) writeStateText(baseHeadPath, gitHead);
    }
  } catch (stateError) {
    process.stderr.write(`ai1: could not record the session base: ${stateError.message}\n`);
  }
}

// { baseHead, sessionStartMilliseconds }, or null outside a git repo. A session that started
// elsewhere takes the current HEAD as its baseline from now on.
export function readSessionBase(hookInput, projectRoot, environment) {
  const baseHeadPath = baseHeadStatePath(hookInput, projectRoot, environment);
  let baseHead = readStateText(baseHeadPath);
  if (!baseHead) {
    baseHead = readGitHead(projectRoot);
    if (!baseHead) return null;
    writeStateText(baseHeadPath, baseHead);
  }
  return { baseHead, sessionStartMilliseconds: stateModifiedMilliseconds(baseHeadPath) };
}

// Repo-relative paths changed since `baseHead`: tracked changes (committed or not) and untracked
// files that git does not ignore. Deleted files are included; callers check existence.
export function listFilesChangedSinceBase(projectRoot, baseHead) {
  const trackedChanges = runGit(projectRoot, ['diff', '--name-only', baseHead]).split('\n');
  const untrackedFiles = runGit(projectRoot, ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...trackedChanges, ...untrackedFiles])].filter(Boolean);
}
