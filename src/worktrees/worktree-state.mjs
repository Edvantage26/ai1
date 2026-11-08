// Where the worktree engine keeps its records: one JSON per worktree in
// `<git-common-dir>/ai1-worktrees/`, shared by every checkout of the repo, outside all of them
// (invisible to git status, untouched when a worktree is removed).

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findMainCheckout, findWorkingTreeTop, readGitDirectories } from '../core/project-roots.mjs';

export const WORKTREE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,47}$/;

// { mainRoot, commonDirectory } of the repository containing `startDirectory`.
export function findRepository(startDirectory) {
  const workingTreeTop = findWorkingTreeTop(startDirectory);
  if (!workingTreeTop) throw new Error(`not inside a git repository: ${startDirectory}`);
  const mainRoot = findMainCheckout(workingTreeTop);
  const gitDirectories = readGitDirectories(mainRoot);
  if (!gitDirectories) throw new Error(`cannot read the git metadata of ${mainRoot}`);
  return { mainRoot, commonDirectory: gitDirectories.commonDirectory };
}

export function validateWorktreeName(worktreeName) {
  if (!WORKTREE_NAME_PATTERN.test(worktreeName ?? '')) {
    throw new Error(`invalid worktree name "${worktreeName}": use 1-48 lowercase letters, digits, dots, dashes or underscores, starting with a letter or digit`);
  }
}

export function worktreeStateDirectory(commonDirectory) {
  return join(commonDirectory, 'ai1-worktrees');
}

function worktreeStatePath(commonDirectory, worktreeName) {
  return join(worktreeStateDirectory(commonDirectory), `${worktreeName}.json`);
}

export function readWorktreeState(commonDirectory, worktreeName) {
  const statePath = worktreeStatePath(commonDirectory, worktreeName);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

export function writeWorktreeState(commonDirectory, worktreeState) {
  mkdirSync(worktreeStateDirectory(commonDirectory), { recursive: true });
  writeFileSync(worktreeStatePath(commonDirectory, worktreeState.name), `${JSON.stringify(worktreeState, null, 2)}\n`);
}

export function removeWorktreeState(commonDirectory, worktreeName) {
  const statePath = worktreeStatePath(commonDirectory, worktreeName);
  if (existsSync(statePath)) unlinkSync(statePath);
}

export function listWorktreeStates(commonDirectory) {
  const stateDirectory = worktreeStateDirectory(commonDirectory);
  if (!existsSync(stateDirectory)) return [];
  return readdirSync(stateDirectory)
    .filter((stateFileName) => stateFileName.endsWith('.json'))
    .map((stateFileName) => readWorktreeState(commonDirectory, stateFileName.slice(0, -'.json'.length)))
    .filter(Boolean)
    .sort((firstState, secondState) => firstState.name.localeCompare(secondState.name));
}
