// The HEAD at session start, shared by the modules that need to know what this session changed
// (okf-upkeep, lanes). Recorded once per session; resume/compact must not move the baseline.

import { execFileSync } from 'node:child_process';
import {
  resolveStateDirectory, sessionStatePath, readStateText, writeStateText, removeExpiredStateFiles, stateModifiedMilliseconds,
} from './session-state.mjs';

export function readGitHead(projectRoot) {
  try {
    return execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function baseHeadStatePath(hookInput, projectRoot, environment) {
  return sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'base');
}

export function recordSessionBaseHead(hookInput, projectRoot, environment) {
  removeExpiredStateFiles(resolveStateDirectory(environment));
  const baseHeadPath = baseHeadStatePath(hookInput, projectRoot, environment);
  if (readStateText(baseHeadPath) === null) {
    const gitHead = readGitHead(projectRoot);
    if (gitHead) writeStateText(baseHeadPath, gitHead);
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
