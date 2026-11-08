// `jig worktree create`: makes a worktree following the project recipe and records it.
// Modes: full trims nothing; light applies every heavy strategy; extra modes are light plus their
// own excludes; auto is full when it fits on the disk with the recipe's margin (always when the
// filesystem shares blocks on copy), else trims the heavy paths that free space, largest first.
// It never runs installs: setup and regenerate commands are returned for the agent to run.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { loadHarnessConfig } from '../core/config.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { loadRecipe } from './worktree-recipe.mjs';
import { runGit, tryGit } from './worktree-git.mjs';
import {
  findRepository, validateWorktreeName, readWorktreeState, writeWorktreeState, listWorktreeStates,
} from './worktree-state.mjs';
import { measurePathBytes, readDiskSpace, supportsCopyOnWrite, copyPath, linkDirectory } from './worktree-disk.mjs';
import { DEFAULT_PORT_RANGE, listListeningPorts, pickWorktreePort, writeEnvVariables } from './worktree-ports.mjs';

const WORKTREE_INCLUDE_FILE = '.worktreeinclude';

export function loadRecipeOrFail(mainRoot) {
  const loadedRecipe = loadRecipe(mainRoot);
  if (loadedRecipe.status === 'missing') throw new Error(`no worktree recipe at ${loadedRecipe.recipePath}: plan one with /jig:worktree`);
  if (loadedRecipe.status === 'invalid') throw new Error(`invalid ${loadedRecipe.recipePath}: ${loadedRecipe.errors.join('; ')}`);
  return loadedRecipe;
}

export function resolveBaseBranch(mainRoot, recipe, requestedBase) {
  const baseSetting = requestedBase || recipe.base;
  if (baseSetting === 'trunk') {
    const loadedConfig = loadHarnessConfig(mainRoot);
    return loadedConfig.status === 'ok' ? loadedConfig.config.trunk : 'main';
  }
  if (baseSetting !== 'current') return baseSetting;
  return tryGit(mainRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']) || runGit(mainRoot, ['rev-parse', 'HEAD']).trim();
}

function normalizeRepoPath(repoPath) {
  return repoPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function isTrackedPath(mainRoot, repoPath) {
  return runGit(mainRoot, ['ls-files', '--', repoPath]).trim() !== '';
}

function readWorktreeIncludePatterns(mainRoot) {
  const includePath = join(mainRoot, WORKTREE_INCLUDE_FILE);
  if (!existsSync(includePath)) return [];
  return readFileSync(includePath, 'utf8').split('\n').map((includeLine) => includeLine.trim())
    .filter((includeLine) => includeLine && !includeLine.startsWith('#'));
}

// Ignored files of the main checkout matching the copy patterns, outside the worktrees folder and
// the heavy paths (handled on their own). Fully ignored folders are walked only when a pattern
// reaches inside them.
export function listFilesToCopy(mainRoot, copyPatterns, skippedPaths) {
  if (copyPatterns.length === 0) return [];
  const isSkipped = (repoPath) => skippedPaths.some((skippedPath) => repoPath === skippedPath || repoPath.startsWith(`${skippedPath}/`));
  const ignoredEntries = runGit(mainRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']).split('\n').filter(Boolean);
  const filesToCopy = [];
  for (const ignoredEntry of ignoredEntries) {
    const entryPath = normalizeRepoPath(ignoredEntry);
    if (isSkipped(entryPath)) continue;
    if (matchesAnyGlob(entryPath, copyPatterns)) {
      filesToCopy.push(entryPath);
    } else if (ignoredEntry.endsWith('/') && copyPatterns.some((copyPattern) => normalizeRepoPath(copyPattern).startsWith(`${entryPath}/`) || copyPattern.startsWith('**/'))) {
      const walkFolder = (folderPath) => {
        const folderEntries = tryGit(mainRoot, ['ls-files', '--others', '--ignored', '--exclude-standard', '--', folderPath]);
        for (const folderEntry of (folderEntries || '').split('\n').filter(Boolean)) {
          const filePath = normalizeRepoPath(folderEntry);
          if (!isSkipped(filePath) && matchesAnyGlob(filePath, copyPatterns)) filesToCopy.push(filePath);
        }
      };
      walkFolder(entryPath);
    }
  }
  return filesToCopy;
}

// Sum of the blob sizes of a commit: what a full checkout writes for tracked files.
function measureTrackedBytes(mainRoot, baseCommit) {
  let trackedBytes = 0;
  for (const treeLine of runGit(mainRoot, ['ls-tree', '-r', '-l', baseCommit]).split('\n')) {
    const blobSize = Number.parseInt(treeLine.split(/\s+/)[3], 10);
    if (Number.isFinite(blobSize)) trackedBytes += blobSize;
  }
  return trackedBytes;
}

// Each heavy entry with what it costs and where it lives.
function describeHeavyEntries(mainRoot, recipe) {
  return recipe.heavy.map((heavyEntry) => {
    const repoPath = normalizeRepoPath(heavyEntry.path);
    const isTracked = isTrackedPath(mainRoot, repoPath);
    const effectiveStrategy = isTracked && heavyEntry.strategy === 'share' ? 'exclude' : heavyEntry.strategy;
    return { ...heavyEntry, path: repoPath, isTracked, effectiveStrategy, bytes: measurePathBytes(join(mainRoot, repoPath)) };
  });
}

// Strategies that leave the bytes out of the worktree (regenerate rebuilds them, copy copies them).
const SPACE_SAVING_STRATEGIES = new Set(['exclude', 'share']);

// { mode, trimmedEntries, reason }: which heavy entries get their strategy instead of a full copy.
export function decideMode({ requestedMode, recipe, heavyEntries, neededFullBytes, diskSpace, copyOnWrite }) {
  if (requestedMode === 'full') return { mode: 'full', trimmedEntries: [], reason: 'full requested' };
  if (requestedMode !== 'auto') return { mode: requestedMode, trimmedEntries: heavyEntries, reason: `${requestedMode} requested` };
  if (heavyEntries.length === 0) return { mode: 'full', trimmedEntries: [], reason: 'no heavy paths in the recipe' };
  if (copyOnWrite) return { mode: 'full', trimmedEntries: [], reason: 'the filesystem shares blocks on copy' };
  if (!diskSpace) return { mode: 'light', trimmedEntries: heavyEntries, reason: 'free space unknown on this platform' };
  const marginBytes = (recipe.disk_margin_percent / 100) * diskSpace.totalBytes;
  const fitsWith = (neededBytes) => diskSpace.freeBytes - neededBytes >= marginBytes;
  if (fitsWith(neededFullBytes)) return { mode: 'full', trimmedEntries: [], reason: 'it fits on the disk with the margin' };
  const trimmedEntries = [];
  let neededBytes = neededFullBytes;
  const savingEntries = heavyEntries.filter((heavyEntry) => SPACE_SAVING_STRATEGIES.has(heavyEntry.effectiveStrategy))
    .sort((firstEntry, secondEntry) => secondEntry.bytes - firstEntry.bytes);
  for (const heavyEntry of savingEntries) {
    if (fitsWith(neededBytes)) break;
    trimmedEntries.push(heavyEntry);
    neededBytes -= heavyEntry.bytes;
  }
  const reason = fitsWith(neededBytes) ? 'trimmed to fit on the disk with the margin' : 'trimmed everything it can; it may still not fit';
  return { mode: 'light', trimmedEntries, reason };
}

function ensureLinkIgnored(commonDirectory, worktreePath, repoPath) {
  if (tryGit(worktreePath, ['check-ignore', '-q', '--', repoPath]) !== null) return;
  const excludePath = join(commonDirectory, 'info', 'exclude');
  mkdirSync(dirname(excludePath), { recursive: true });
  appendFileSync(excludePath, `/${repoPath}\n`);
}

function collectTakenPorts(commonDirectory, worktreeName) {
  const takenPorts = listListeningPorts();
  for (const otherState of listWorktreeStates(commonDirectory)) {
    if (otherState.name !== worktreeName && otherState.port) takenPorts.add(otherState.port);
  }
  return takenPorts;
}

// options: { mode, base, diskSpace, copyOnWrite } (the last two injectable for tests).
export function createWorktree(startDirectory, worktreeName, options = {}) {
  validateWorktreeName(worktreeName);
  const { mainRoot, commonDirectory } = findRepository(startDirectory);
  const { recipe, warnings } = loadRecipeOrFail(mainRoot);
  const requestedMode = options.mode || recipe.default_mode;
  const knownModes = ['auto', 'full', 'light', ...Object.keys(recipe.modes)];
  if (!knownModes.includes(requestedMode)) throw new Error(`unknown mode "${requestedMode}": use ${knownModes.join(', ')}`);
  if (readWorktreeState(commonDirectory, worktreeName)) throw new Error(`worktree "${worktreeName}" already exists (jig worktree list)`);
  const branchName = `${recipe.branch_prefix}${worktreeName}`;
  if (tryGit(mainRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${branchName}`])) throw new Error(`branch ${branchName} already exists`);
  const worktreePath = resolve(mainRoot, recipe.location, worktreeName);
  if (existsSync(worktreePath)) throw new Error(`${worktreePath} already exists`);
  const baseBranch = resolveBaseBranch(mainRoot, recipe, options.base);
  const baseCommit = runGit(mainRoot, ['rev-parse', '--verify', `${baseBranch}^{commit}`]).trim();

  const heavyEntries = describeHeavyEntries(mainRoot, recipe);
  const heavyPaths = heavyEntries.map((heavyEntry) => heavyEntry.path);
  const locationPath = normalizeRepoPath(recipe.location);
  const copyPatterns = [...recipe.copy, ...readWorktreeIncludePatterns(mainRoot)];
  const filesToCopy = listFilesToCopy(mainRoot, copyPatterns, [locationPath, ...heavyPaths]);
  const copiedBytes = filesToCopy.reduce((byteTotal, filePath) => byteTotal + measurePathBytes(join(mainRoot, filePath)), 0);
  const ignoredHeavyBytes = heavyEntries.filter((heavyEntry) => !heavyEntry.isTracked).reduce((byteTotal, heavyEntry) => byteTotal + heavyEntry.bytes, 0);
  mkdirSync(dirname(worktreePath), { recursive: true });
  const decision = decideMode({
    requestedMode,
    recipe,
    heavyEntries,
    neededFullBytes: measureTrackedBytes(mainRoot, baseCommit) + ignoredHeavyBytes + copiedBytes,
    diskSpace: options.diskSpace !== undefined ? options.diskSpace : readDiskSpace(dirname(worktreePath)),
    copyOnWrite: options.copyOnWrite !== undefined ? options.copyOnWrite : (requestedMode === 'auto' && supportsCopyOnWrite(dirname(worktreePath))),
  });
  const extraMode = recipe.modes[decision.mode] ?? {};
  const trimmedPaths = new Set(decision.trimmedEntries.map((heavyEntry) => heavyEntry.path));
  const sparseExclusions = [
    ...decision.trimmedEntries.filter((heavyEntry) => heavyEntry.isTracked && SPACE_SAVING_STRATEGIES.has(heavyEntry.effectiveStrategy)).map((heavyEntry) => heavyEntry.path),
    ...(extraMode.sparse_exclude ?? []).map(normalizeRepoPath),
  ];

  const commandsToRun = [];
  try {
    if (sparseExclusions.length) {
      runGit(mainRoot, ['worktree', 'add', '--quiet', '--no-checkout', '-b', branchName, worktreePath, baseCommit]);
      runGit(worktreePath, ['sparse-checkout', 'set', '--no-cone', '/*', ...sparseExclusions.map((excludedPath) => `!/${excludedPath}/`)]);
      runGit(worktreePath, ['checkout', '--quiet', branchName]);
    } else {
      runGit(mainRoot, ['worktree', 'add', '--quiet', '-b', branchName, worktreePath, baseCommit]);
    }
    for (const filePath of filesToCopy) copyPath(join(mainRoot, filePath), join(worktreePath, filePath));
    for (const heavyEntry of heavyEntries.filter((candidateEntry) => !candidateEntry.isTracked)) {
      const sourcePath = join(mainRoot, heavyEntry.path);
      const targetPath = join(worktreePath, heavyEntry.path);
      const strategy = trimmedPaths.has(heavyEntry.path) ? heavyEntry.effectiveStrategy : 'copy';
      if (strategy === 'regenerate') commandsToRun.push(heavyEntry.command);
      else if (!existsSync(sourcePath) || strategy === 'exclude') continue;
      else if (strategy === 'share') {
        linkDirectory(sourcePath, targetPath);
        ensureLinkIgnored(commonDirectory, worktreePath, heavyEntry.path);
      } else copyPath(sourcePath, targetPath);
    }
    let worktreePort = null;
    if (recipe.port) {
      worktreePort = pickWorktreePort(worktreeName, recipe.port.range ?? DEFAULT_PORT_RANGE, collectTakenPorts(commonDirectory, worktreeName));
      writeEnvVariables(join(worktreePath, recipe.port.env_file), Object.fromEntries(recipe.port.variables.map((variableName) => [variableName, String(worktreePort)])));
    }
    if (!extraMode.skip_setup) commandsToRun.unshift(...recipe.setup);
    const worktreeState = {
      name: worktreeName,
      path: worktreePath,
      branch: branchName,
      base: baseBranch,
      base_commit: baseCommit,
      requested_mode: requestedMode,
      mode: decision.mode,
      mode_reason: decision.reason,
      trimmed: decision.trimmedEntries.map((heavyEntry) => ({ path: heavyEntry.path, strategy: heavyEntry.effectiveStrategy, bytes: heavyEntry.bytes })),
      sparse_exclude: sparseExclusions,
      port: worktreePort,
      created_at: new Date().toISOString(),
      last_run: null,
    };
    writeWorktreeState(commonDirectory, worktreeState);
    const shareOnTrackedWarnings = heavyEntries.filter((heavyEntry) => heavyEntry.isTracked && heavyEntry.strategy === 'share')
      .map((heavyEntry) => `${heavyEntry.path} is tracked: share works only for ignored paths, so it is excluded instead`);
    return {
      ...worktreeState,
      size_bytes: measurePathBytes(worktreePath),
      commands_to_run: [...new Set(commandsToRun)],
      warnings: [...warnings, ...shareOnTrackedWarnings],
    };
  } catch (creationError) {
    tryGit(mainRoot, ['worktree', 'remove', '--force', worktreePath]);
    if (existsSync(worktreePath)) rmSync(worktreePath, { recursive: true, force: true });
    tryGit(mainRoot, ['worktree', 'prune']);
    tryGit(mainRoot, ['branch', '-D', branchName]);
    throw creationError;
  }
}
