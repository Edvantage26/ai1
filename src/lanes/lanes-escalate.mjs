// lanes-escalate (PreToolUse, feature `lanes`): a task the agent sized as quick may grow. When the
// session's changes pass a size threshold (files or lines since the session started) and there is
// no deep-lane plan, the next edit asks the person once whether to go on or stop for a plan.

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, askDecision } from '../core/hook-io.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText } from '../core/session-state.mjs';
import { FILE_EDITING_TOOLS, listEditedProjectPaths } from './lanes-gate.mjs';
import { listActivePlans, JIG_DIRECTORY } from './lanes-work.mjs';

const MODULE_ID = 'lanes-escalate';
export const DEFAULT_MAX_FILES = 6;
export const DEFAULT_MAX_LINES = 300;
const MAX_COUNTED_FILE_BYTES = 1024 * 1024;

function runGit(projectRoot, gitArguments) {
  return execFileSync('git', ['-C', projectRoot, ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function countFileLines(filePath) {
  try {
    if (statSync(filePath).size > MAX_COUNTED_FILE_BYTES) return 0;
    return readFileSync(filePath, 'utf8').split('\n').length;
  } catch {
    return 0;
  }
}

// Files and lines (added + removed) changed since `baseHead`, untracked files included.
export function measureSessionChanges(projectRoot, baseHead, excludedDirectories) {
  const isExcluded = (relativePath) => excludedDirectories.some((directoryPath) => relativePath === directoryPath || relativePath.startsWith(`${directoryPath}/`));
  const changedFiles = new Set();
  let changedLines = 0;
  for (const numstatLine of runGit(projectRoot, ['diff', '--numstat', baseHead]).split('\n').filter(Boolean)) {
    const [addedText, removedText, relativePath] = numstatLine.split('\t');
    if (isExcluded(relativePath)) continue;
    changedFiles.add(relativePath);
    changedLines += (Number(addedText) || 0) + (Number(removedText) || 0);
  }
  for (const relativePath of runGit(projectRoot, ['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean)) {
    if (isExcluded(relativePath)) continue;
    changedFiles.add(relativePath);
    changedLines += countFileLines(join(projectRoot, relativePath));
  }
  return { changedFileCount: changedFiles.size, changedLines };
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: [...FILE_EDITING_TOOLS, 'Bash'],
  feature: 'lanes',
  description: 'Asks the person once when a task without a plan grows past the size of a quick change.',
  run({ hookInput, config, projectRoot, environment, moduleOptions }) {
    if (listEditedProjectPaths(hookInput, projectRoot).length === 0) return allowDecision();
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const escalatedPath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'escalated');
    if (readStateText(escalatedPath) !== null) return allowDecision();
    if (listActivePlans(projectRoot, sessionBase.sessionStartMilliseconds).length > 0) return allowDecision();
    const excludedDirectories = [JIG_DIRECTORY, config.knowledge].filter(Boolean).map((directoryPath) => directoryPath.replace(/^\.\//, '').replace(/\/+$/, ''));
    const { changedFileCount, changedLines } = measureSessionChanges(projectRoot, sessionBase.baseHead, excludedDirectories);
    const maxFiles = moduleOptions.max_files ?? DEFAULT_MAX_FILES;
    const maxLines = moduleOptions.max_lines ?? DEFAULT_MAX_LINES;
    if (changedFileCount < maxFiles && changedLines < maxLines) return allowDecision();
    writeStateText(escalatedPath, `${changedFileCount}:${changedLines}`);
    return askDecision(MODULE_ID, `This session has changed ${changedFileCount} files and ${changedLines} lines without a plan, more than a quick change (${maxFiles} files or ${maxLines} lines). Allow to continue as is; deny to have the agent stop and present a plan first. Asked once per session.`);
  },
};
