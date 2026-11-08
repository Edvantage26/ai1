// The two roots a hook works with when git worktrees are in play, read from the `.git` entries on
// disk (no git process, so it is cheap on every hook event):
// - tree root: the checkout the agent is working in. Claude Code keeps CLAUDE_PROJECT_DIR at the
//   launch checkout after EnterWorktree and passes the worktree in the hook input's `cwd`, so the
//   tree root follows `cwd` when it is a linked worktree of the same repository.
// - shared root: the main checkout of the repository, where state that every worktree shares lives
//   (`.ai1/` plans and approvals). Equal to the tree root outside linked worktrees.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// Nearest directory at or above `startDirectory` that holds a `.git` entry, or null.
export function findWorkingTreeTop(startDirectory) {
  let currentDirectory = resolve(startDirectory);
  for (;;) {
    if (existsSync(join(currentDirectory, '.git'))) return currentDirectory;
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
}

// { gitDirectory, commonDirectory, isLinkedWorktree } for a working tree top, or null when its
// `.git` cannot be read. A submodule's `.git` file has no `commondir`, so it is not a linked worktree.
export function readGitDirectories(workingTreeTop) {
  const gitEntryPath = join(workingTreeTop, '.git');
  try {
    if (statSync(gitEntryPath).isDirectory()) {
      return { gitDirectory: gitEntryPath, commonDirectory: gitEntryPath, isLinkedWorktree: false };
    }
    const gitdirMatch = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(gitEntryPath, 'utf8'));
    if (!gitdirMatch) return null;
    const gitDirectory = resolve(workingTreeTop, gitdirMatch[1]);
    const commondirPath = join(gitDirectory, 'commondir');
    if (!existsSync(commondirPath)) return { gitDirectory, commonDirectory: gitDirectory, isLinkedWorktree: false };
    const commonDirectory = resolve(gitDirectory, readFileSync(commondirPath, 'utf8').trim());
    return { gitDirectory, commonDirectory, isLinkedWorktree: true };
  } catch {
    return null;
  }
}

// Main checkout of the repository that `workingTreeTop` belongs to (itself when it is the main one).
export function findMainCheckout(workingTreeTop) {
  const gitDirectories = readGitDirectories(workingTreeTop);
  if (!gitDirectories?.isLinkedWorktree) return workingTreeTop;
  return basename(gitDirectories.commonDirectory) === '.git' ? dirname(gitDirectories.commonDirectory) : workingTreeTop;
}

export function resolveProjectRoots(hookInput = {}, environment = process.env) {
  const launchRoot = resolve(environment.CLAUDE_PROJECT_DIR || hookInput.cwd || process.cwd());
  let projectRoot = launchRoot;
  if (hookInput.cwd && resolve(hookInput.cwd) !== launchRoot) {
    const cwdTreeTop = findWorkingTreeTop(hookInput.cwd);
    const launchTreeTop = findWorkingTreeTop(launchRoot);
    if (cwdTreeTop && launchTreeTop && cwdTreeTop !== launchTreeTop) {
      const cwdGitDirectories = readGitDirectories(cwdTreeTop);
      const launchGitDirectories = readGitDirectories(launchTreeTop);
      const isSameRepository = cwdGitDirectories && launchGitDirectories
        && cwdGitDirectories.commonDirectory === launchGitDirectories.commonDirectory;
      if (isSameRepository) projectRoot = cwdTreeTop;
    }
  }
  const projectTreeTop = findWorkingTreeTop(projectRoot);
  const sharedRoot = projectTreeTop && projectTreeTop === projectRoot ? findMainCheckout(projectTreeTop) : projectRoot;
  return { projectRoot, sharedRoot };
}
