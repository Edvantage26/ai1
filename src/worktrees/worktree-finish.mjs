// `ai1 worktree finish`: integrates a finished worktree into its base branch and cleans up.
// Order: clean worktree -> bring the base into the branch (rebase, or merge to keep hashes) ->
// recipe `pre-finish` and the OKF checks on the integrated result -> fast-forward the base (and
// record what it wrote there and what was checked) -> remove worktree, branch and record. It stops with a clear message at the first problem and
// leaves everything in place; it never forces, never pushes. The danger guard asks the person
// before it runs, so integration is always their call.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHarnessConfig, KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { runBundleValidator } from '../okf/okf-validator.mjs';
import { runGit, tryGit, listIgnoredPaths } from '../core/git.mjs';
import { findRepository, removeWorktreeState } from './worktree-state.mjs';
import { loadRecipeOrFail } from './worktree-create.mjs';
import {
  readStateOrFail, listUncommittedPaths, runWorktreeCommand, removeWorktreeCheckout, resolveNamedCommands,
} from './worktree-ops.mjs';
import { recordIntegration } from './worktree-integrations.mjs';
import { verifyCommandsRunBy } from '../verify/verify-gate.mjs';
import { stopStoryboardServer } from '../walkthrough/walkthrough-serve.mjs';

const HARNESS_PATHS = new Set(['.claude/settings.json', '.claude/settings.local.json', '.ai1/config.json']);

function isAncestor(repoRoot, ancestorRef, descendantRef) {
  return tryGit(repoRoot, ['merge-base', '--is-ancestor', ancestorRef, descendantRef]) !== null;
}

// Path of the checkout that has `branchName` checked out, or null.
export function findCheckoutOfBranch(mainRoot, branchName) {
  let currentPath = null;
  for (const porcelainLine of runGit(mainRoot, ['worktree', 'list', '--porcelain']).split('\n')) {
    if (porcelainLine.startsWith('worktree ')) currentPath = porcelainLine.slice('worktree '.length);
    else if (porcelainLine === `branch refs/heads/${branchName}`) return currentPath;
  }
  return null;
}

function integrateBase(worktreePath, baseBranch, finishStrategy) {
  if (isAncestor(worktreePath, baseBranch, 'HEAD')) return 'already contains the base';
  try {
    if (finishStrategy === 'merge') runGit(worktreePath, ['merge', '--no-edit', baseBranch]);
    else runGit(worktreePath, ['rebase', baseBranch]);
  } catch (integrationError) {
    tryGit(worktreePath, finishStrategy === 'merge' ? ['merge', '--abort'] : ['rebase', '--abort']);
    const gitMessage = String(integrationError.stderr || integrationError.message).trim().split('\n').slice(0, 6).join('\n');
    throw new Error(`could not ${finishStrategy} onto ${baseBranch} (conflicts); nothing changed.\n${gitMessage}\nResolve it in the worktree (e.g. git merge ${baseBranch}, fix, commit) and run finish again.`);
  }
  return finishStrategy === 'merge' ? `merged ${baseBranch}` : `rebased onto ${baseBranch}`;
}

// OKF checks on what the branch changes against its base, when the okf feature is on there.
export function checkBranchKnowledge(worktreePath, baseBranch, { acknowledgement, environment = process.env } = {}) {
  const loadedConfig = loadHarnessConfig(worktreePath);
  if (loadedConfig.status !== 'ok' || !isFeatureEnabled('okf', loadedConfig.config)) return { checked: false, notes: [] };
  const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
  const bundleDirectory = join(worktreePath, bundleRelativePath);
  if (!existsSync(bundleDirectory)) return { checked: false, notes: [] };
  const changedPaths = runGit(worktreePath, ['diff', '--name-only', `${baseBranch}...HEAD`]).split('\n').filter(Boolean);
  const touchesBundle = changedPaths.some((changedPath) => changedPath.startsWith(`${bundleRelativePath}/`));
  const changedCode = changedPaths.filter((changedPath) => !changedPath.startsWith(`${bundleRelativePath}/`) && !HARNESS_PATHS.has(changedPath));
  const notes = [];
  if (changedCode.length && !touchesBundle) {
    if (!acknowledgement) {
      throw new Error([
        `the branch changes ${changedCode.length} file(s) and does not touch the knowledge bundle (${bundleRelativePath}/):`,
        ...changedCode.slice(0, 15).map((changedPath) => `  - ${changedPath}`),
        'Update the concepts they affect and commit in the worktree, or run finish again with --ack "<why no concept changes>".',
      ].join('\n'));
    }
    notes.push(`knowledge bundle not updated: ${acknowledgement}`);
  }
  const validation = runBundleValidator(bundleDirectory, environment);
  if (!validation.ran) notes.push(`OKF validator not run: ${validation.reason}`);
  else if (validation.errors.length) {
    throw new Error([`the knowledge bundle of the branch has ${validation.errors.length} validator error(s):`, ...validation.errors.slice(0, 15).map((validationError) => `  - ${validationError}`), 'Fix them in the worktree, commit, and run finish again.'].join('\n'));
  }
  return { checked: true, notes };
}

function fastForwardBase(mainRoot, baseBranch, branchName, dirtyPathsOk) {
  if (!tryGit(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${baseBranch}`])) {
    throw new Error(`the base ${baseBranch} is not a branch, so it cannot move; integrate ${branchName} by hand`);
  }
  if (!isAncestor(mainRoot, baseBranch, branchName)) throw new Error(`${baseBranch} moved during finish; run finish again`);
  const baseCheckout = findCheckoutOfBranch(mainRoot, baseBranch);
  if (!baseCheckout) {
    runGit(mainRoot, ['update-ref', `refs/heads/${baseBranch}`, branchName, baseBranch]);
    return `${baseBranch} moved to ${branchName} (not checked out anywhere)`;
  }
  const blockingPaths = listUncommittedPaths(baseCheckout)
    .map((statusLine) => statusLine.slice(3))
    .filter((changedPath) => !dirtyPathsOk.some((allowedPath) => changedPath === allowedPath.replace(/\/+$/, '') || changedPath.startsWith(allowedPath.endsWith('/') ? allowedPath : `${allowedPath}/`)));
  if (blockingPaths.length) {
    throw new Error(`${baseCheckout} (where ${baseBranch} is checked out) has uncommitted changes, so it cannot move:\n${blockingPaths.map((blockingPath) => `  - ${blockingPath}`).join('\n')}\nCommit or move them there, then run finish again; the branch is already integrated with the base.`);
  }
  try {
    runGit(baseCheckout, ['merge', '--ff-only', '--quiet', branchName]);
  } catch (mergeError) {
    throw new Error(`could not fast-forward ${baseBranch} in ${baseCheckout}: ${String(mergeError.stderr || mergeError.message).trim().split('\n')[0]}`);
  }
  return `${baseBranch} fast-forwarded in ${baseCheckout}`;
}

// Records what the fast-forward wrote into the checked-out base and what was checked on it, so the
// Stop hooks there do not take it for unchecked work (see worktree-integrations).
function recordBaseIntegration({ mainRoot, commonDirectory, recipe, worktreeState, baseHeadBefore, knowledgeChecked }) {
  const baseCheckout = findCheckoutOfBranch(mainRoot, worktreeState.base);
  if (!baseCheckout) return;
  const changedPaths = runGit(baseCheckout, ['diff', '--name-only', baseHeadBefore, 'HEAD']).split('\n').filter(Boolean);
  if (!changedPaths.length) return;
  const loadedConfig = loadHarnessConfig(baseCheckout);
  const verifyCommands = loadedConfig.status === 'ok' ? loadedConfig.config.verify || [] : [];
  const preFinishCommands = recipe.commands['pre-finish'] === undefined ? [] : resolveNamedCommands(recipe, worktreeState, 'pre-finish');
  const verified = verifyCommands.length > 0
    && verifyCommandsRunBy(preFinishCommands.join(' && '), verifyCommands).length === verifyCommands.length;
  recordIntegration(commonDirectory, { checkout: baseCheckout, changedPaths, verified, knowledgeChecked });
}

// options: { merge, acknowledgement, runCommand, environment }.
export function finishWorktree(startDirectory, worktreeName, options = {}) {
  const { mainRoot, commonDirectory } = findRepository(startDirectory);
  const worktreeState = readStateOrFail(commonDirectory, worktreeName);
  if (!existsSync(worktreeState.path)) throw new Error(`${worktreeState.path} is missing; drop the record with ai1 worktree drop ${worktreeName} --confirm`);
  const uncommittedPaths = listUncommittedPaths(worktreeState.path);
  if (uncommittedPaths.length) throw new Error(`worktree "${worktreeName}" has uncommitted changes; commit them first:\n${uncommittedPaths.join('\n')}`);
  const { recipe } = loadRecipeOrFail(mainRoot);
  if (options.merge && !recipe.finish.allow_merge) throw new Error('this recipe does not allow --merge (finish.allow_merge is false)');
  const finishStrategy = options.merge ? 'merge' : recipe.finish.strategy;

  const steps = [integrateBase(worktreeState.path, worktreeState.base, finishStrategy)];
  if (recipe.commands['pre-finish'] !== undefined) {
    const preFinishResult = runWorktreeCommand(mainRoot, worktreeName, 'pre-finish', options.runCommand ? { runCommand: options.runCommand } : {});
    if (preFinishResult.exitCode !== 0) throw new Error(`pre-finish failed: \`${preFinishResult.failedCommand}\` (exit ${preFinishResult.exitCode}); fix it in the worktree and run finish again`);
    steps.push('pre-finish passed');
  }
  const knowledgeCheck = checkBranchKnowledge(worktreeState.path, worktreeState.base, options);
  if (knowledgeCheck.checked) steps.push('knowledge bundle checked');
  const baseHeadBefore = runGit(mainRoot, ['rev-parse', worktreeState.base]).trim();
  steps.push(fastForwardBase(mainRoot, worktreeState.base, worktreeState.branch, recipe.finish.dirty_base_paths_ok));
  recordBaseIntegration({ mainRoot, commonDirectory, recipe, worktreeState, baseHeadBefore, knowledgeChecked: knowledgeCheck.checked });

  // What only existed in the worktree: copies made by create and heavy paths are not news.
  const recreatablePaths = [...recipe.copy, ...recipe.heavy.map((heavyEntry) => heavyEntry.path), ...(recipe.port ? [recipe.port.env_file] : [])];
  const removedIgnoredPaths = (listIgnoredPaths(worktreeState.path) || [])
    .filter((ignoredPath) => !matchesAnyGlob(ignoredPath.replace(/\/$/, ''), recreatablePaths));
  removeWorktreeCheckout(mainRoot, worktreeState);
  // `git branch -d` checks against the main checkout's HEAD, which need not be the base (a base not
  // checked out anywhere moves with update-ref): the branch is deleted when the base contains it.
  const isBranchInBase = isAncestor(mainRoot, worktreeState.branch, worktreeState.base);
  const isBranchDeleted = isBranchInBase && tryGit(mainRoot, ['branch', '-D', worktreeState.branch]) !== null;
  removeWorktreeState(commonDirectory, worktreeName);
  const releasedStoryboardUrl = stopStoryboardServer(mainRoot, worktreeName);
  if (releasedStoryboardUrl) steps.push(`storyboard server stopped (${releasedStoryboardUrl}); the storyboard stays in .ai1/work/${worktreeName}/walkthrough/`);
  steps.push(isBranchDeleted
    ? `worktree and branch ${worktreeState.branch} removed`
    : `worktree removed; branch ${worktreeState.branch} kept because git could not delete it (check it and delete it by hand)`);
  return { name: worktreeName, base: worktreeState.base, steps, notes: knowledgeCheck.notes, removed_ignored: removedIgnoredPaths };
}
