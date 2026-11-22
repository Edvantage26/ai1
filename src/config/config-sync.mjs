// The operations on the person's config repo, shared by the `ai1 config` CLI and the hooks:
// - applyFromRepo: repo -> targets (no network), at session start and after a pull.
// - captureAndCommit: targets -> repo and a local commit, at session end; a file with a line that looks
//   like a secret is left out of the commit and named.
// - pullFromRemote / pushToRemote: the network, only from the CLI (never from a hook).
// Many sessions run at once (agent managers start several), so every write holds a lock file; a session
// that cannot take it skips and the next one picks the change up.

import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { runGit, tryGit } from '../core/git.mjs';
import { findSecretLines } from '../core/secret-lines.mjs';
import { configDirectory, configRepoDirectory, hasConfigRepo, planConfigSync, readConfigOptions, readConfigState, runConfigSync, writeConfigState } from './config-repo.mjs';
import { planSettingsSync, runSettingsSync } from './config-settings.mjs';

const LOCK_STALE_MILLISECONDS = 60 * 1000;

export function configLockPath(pathOptions = {}) {
  return join(configDirectory(pathOptions), 'config-repo.lock');
}

// Runs `work` holding the lock; returns { locked: false } when another session holds it.
export function withConfigLock(pathOptions, work) {
  const lockPath = configLockPath(pathOptions);
  mkdirSync(configDirectory(pathOptions), { recursive: true });
  try {
    if (existsSync(lockPath) && Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MILLISECONDS) rmSync(lockPath, { force: true });
  } catch {
    // Another session removed it first.
  }
  let lockHandle;
  try {
    lockHandle = openSync(lockPath, 'wx');
  } catch {
    return { locked: false };
  }
  try {
    return { locked: true, ...work() };
  } finally {
    closeSync(lockHandle);
    rmSync(lockPath, { force: true });
  }
}

export function isConfigSyncOn(pathOptions = {}) {
  return hasConfigRepo(pathOptions) && readConfigState(pathOptions).off !== true;
}

// Repo -> targets. { done, conflicts, backups, settingsConflicts }.
export function applyFromRepo(pathOptions = {}) {
  const repoDirectory = configRepoDirectory(pathOptions);
  const fileOutcome = runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions, directions: ['apply'] });
  const settingsPlan = planSettingsSync(repoDirectory, { pathOptions });
  const settingsOutcome = runSettingsSync(repoDirectory, settingsPlan, { pathOptions, directions: ['apply'] });
  return { ...fileOutcome, settingsConflicts: settingsOutcome.conflicts, settingsDone: settingsOutcome.done };
}

// The lines a file adds to the commit (all of it when new to git).
function addedLines(repoDirectory, repoPath) {
  const diffText = tryGit(repoDirectory, ['diff', '--cached', '--unified=0', '--no-color', '--', repoPath]) || '';
  return diffText.split('\n').filter((diffLine) => diffLine.startsWith('+') && !diffLine.startsWith('+++')).map((diffLine) => diffLine.slice(1)).join('\n');
}

function describeChangedPaths(changedPaths) {
  const shown = changedPaths.slice(0, 4).join(', ');
  return changedPaths.length > 4 ? `${shown} and ${changedPaths.length - 4} more` : shown;
}

// Stages everything, leaves out files whose added lines look like a secret (unless `include` names them),
// and commits. { committed, message, heldBack: [path], changedPaths }.
export function commitRepoChanges(repoDirectory, { message, include = [] } = {}) {
  runGit(repoDirectory, ['add', '--all']);
  const changedPaths = (tryGit(repoDirectory, ['diff', '--cached', '--name-only']) || '').split('\n').filter(Boolean);
  const heldBack = changedPaths.filter((repoPath) => !include.includes(repoPath) && existsSync(join(repoDirectory, repoPath)) && findSecretLines(addedLines(repoDirectory, repoPath)).length > 0);
  for (const repoPath of heldBack) runGit(repoDirectory, ['reset', '--quiet', '--', repoPath]);
  const committedPaths = changedPaths.filter((repoPath) => !heldBack.includes(repoPath));
  if (!committedPaths.length) return { committed: false, heldBack, changedPaths };
  const commitMessage = message || `config: ${describeChangedPaths(committedPaths)}`;
  runGit(repoDirectory, ['commit', '--quiet', '-m', commitMessage]);
  return { committed: true, message: commitMessage, heldBack, changedPaths: committedPaths };
}

// Targets -> repo, then a local commit. { done, conflicts, settingsConflicts, commit }.
export function captureAndCommit(pathOptions = {}, { message, include } = {}) {
  const repoDirectory = configRepoDirectory(pathOptions);
  const fileOutcome = runConfigSync(repoDirectory, planConfigSync(repoDirectory, { pathOptions }), { pathOptions, directions: ['capture'] });
  const settingsOutcome = runSettingsSync(repoDirectory, planSettingsSync(repoDirectory, { pathOptions }), { pathOptions, directions: ['capture'] });
  const commit = commitRepoChanges(repoDirectory, { message, include });
  return { done: fileOutcome.done, conflicts: fileOutcome.conflicts, settingsConflicts: settingsOutcome.conflicts, commit };
}

export function hasRemote(repoDirectory) {
  return Boolean(tryGit(repoDirectory, ['remote']));
}

// Fetch and rebase the local commits on the remote. { pulled, error }: a rebase that stops is aborted,
// nothing is left half done.
export function pullFromRemote(repoDirectory) {
  if (!hasRemote(repoDirectory)) return { pulled: false, error: 'no remote' };
  try {
    runGit(repoDirectory, ['pull', '--rebase', '--quiet']);
    return { pulled: true };
  } catch (pullError) {
    tryGit(repoDirectory, ['rebase', '--abort']);
    return { pulled: false, error: String(pullError.stderr || pullError.message).trim().split('\n').slice(-3).join(' ') };
  }
}

export function pushToRemote(repoDirectory) {
  if (!hasRemote(repoDirectory)) return { pushed: false, error: 'no remote' };
  try {
    runGit(repoDirectory, ['push', '--quiet', '-u', 'origin', 'HEAD']);
    return { pushed: true };
  } catch (pushError) {
    return { pushed: false, error: String(pushError.stderr || pushError.message).trim().split('\n').slice(-3).join(' ') };
  }
}

// Commits not on the remote yet (null without a remote or upstream).
export function countUnpushedCommits(repoDirectory) {
  const countText = tryGit(repoDirectory, ['rev-list', '--count', '@{upstream}..HEAD']);
  return countText === null ? null : Number(countText);
}

// The whole sync from the CLI: pull, apply, capture, commit, and push when autoPush.
export function syncConfig(pathOptions = {}, { message, include } = {}) {
  const repoDirectory = configRepoDirectory(pathOptions);
  return withConfigLock(pathOptions, () => {
    const preCommit = commitRepoChanges(repoDirectory, { message: 'config: local changes before sync' });
    const pull = pullFromRemote(repoDirectory);
    const applied = pull.error && pull.error !== 'no remote' ? null : applyFromRepo(pathOptions);
    const captured = captureAndCommit(pathOptions, { message, include });
    const push = readConfigOptions(repoDirectory).autoPush && !pull.error ? pushToRemote(repoDirectory) : null;
    writeConfigState({ ...readConfigState(pathOptions), lastSyncAt: new Date().toISOString() }, pathOptions);
    return { preCommit, pull, applied, captured, push };
  });
}
