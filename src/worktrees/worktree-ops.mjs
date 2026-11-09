// Engine operations on existing worktrees: list, run a recipe command, drop.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runGit, tryGit } from '../core/git.mjs';
import {
  findRepository, validateWorktreeName, readWorktreeState, writeWorktreeState, removeWorktreeState,
  listWorktreeStates, worktreeStateDirectory,
} from './worktree-state.mjs';
import { measurePathBytes } from './worktree-disk.mjs';
import { loadRecipeOrFail } from './worktree-create.mjs';
import { closeStoryboard } from '../walkthrough/walkthrough-serve.mjs';

export function readStateOrFail(commonDirectory, worktreeName) {
  validateWorktreeName(worktreeName);
  const worktreeState = readWorktreeState(commonDirectory, worktreeName);
  if (!worktreeState) throw new Error(`no worktree "${worktreeName}" (ai1 worktree list)`);
  return worktreeState;
}

export function listUncommittedPaths(worktreePath) {
  return (tryGit(worktreePath, ['status', '--porcelain']) || '').split('\n').filter(Boolean);
}

function countAheadBehind(mainRoot, baseBranch, branchName) {
  const countText = tryGit(mainRoot, ['rev-list', '--left-right', '--count', `${baseBranch}...${branchName}`]);
  if (!countText) return { ahead: null, behind: null };
  const [behindCount, aheadCount] = countText.split(/\s+/).map(Number);
  return { ahead: aheadCount, behind: behindCount };
}

export function listWorktrees(startDirectory, { withSize = false } = {}) {
  const { mainRoot, commonDirectory } = findRepository(startDirectory);
  return listWorktreeStates(commonDirectory).map((worktreeState) => {
    const isPresent = existsSync(worktreeState.path);
    return {
      ...worktreeState,
      present: isPresent,
      ...countAheadBehind(mainRoot, worktreeState.base, worktreeState.branch),
      uncommitted: isPresent ? listUncommittedPaths(worktreeState.path).length : null,
      size_bytes: withSize && isPresent ? measurePathBytes(worktreeState.path) : null,
    };
  });
}

export function renderTemplate(templateText, worktreeState, mainRoot) {
  const placeholderValues = {
    name: worktreeState.name,
    branch: worktreeState.branch,
    path: worktreeState.path,
    repo_root: mainRoot,
    repo_parent: dirname(mainRoot),
    port: worktreeState.port ?? '',
  };
  return templateText.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (placeholderText, placeholderName) => (
    placeholderName in placeholderValues ? String(placeholderValues[placeholderName]) : placeholderText
  ));
}

export function buildWorktreeEnvironment(recipe, worktreeState, mainRoot, baseEnvironment = process.env) {
  const worktreeEnvironment = { ...baseEnvironment };
  for (const [variableName, variableTemplate] of Object.entries(recipe.env)) {
    worktreeEnvironment[variableName] = renderTemplate(variableTemplate, worktreeState, mainRoot);
  }
  if (recipe.port && worktreeState.port) {
    for (const variableName of recipe.port.variables) worktreeEnvironment[variableName] = String(worktreeState.port);
  }
  worktreeEnvironment.AI1_WORKTREE = worktreeState.name;
  return worktreeEnvironment;
}

// Commands behind a name: `setup` is what create listed (recipe setup + regenerate commands);
// anything else comes from the recipe's `commands`.
export function resolveNamedCommands(recipe, worktreeState, commandName) {
  if (commandName === 'setup') return worktreeState.setup_commands ?? recipe.setup;
  const commandSpec = recipe.commands[commandName];
  if (commandSpec === undefined) {
    throw new Error(`no command "${commandName}" in the recipe; known: ${['setup', ...Object.keys(recipe.commands)].join(', ')}`);
  }
  return Array.isArray(commandSpec) ? commandSpec : [commandSpec];
}

function defaultRunCommand(commandText, workingDirectory, commandEnvironment) {
  return spawnSync(commandText, { cwd: workingDirectory, env: commandEnvironment, shell: true, stdio: 'inherit' }).status ?? 1;
}

function quoteShellArgument(argumentText) {
  return /^[\w@%+=:,./-]+$/.test(argumentText) ? argumentText : `'${argumentText.replace(/'/g, `'\\''`)}'`;
}

// Extra arguments go where the command says `{{args}}`, else at its end.
export function applyCommandArguments(commandText, extraArguments) {
  const argumentsText = extraArguments.map(quoteShellArgument).join(' ');
  if (/\{\{\s*args\s*\}\}/.test(commandText)) return commandText.replace(/\{\{\s*args\s*\}\}/g, () => argumentsText);
  return argumentsText ? `${commandText} ${argumentsText}` : commandText;
}

// { exitCode, failedCommand }; stops at the first failing command and records the run in the state.
export function runWorktreeCommand(startDirectory, worktreeName, commandName, { runCommand = defaultRunCommand, extraArguments = [] } = {}) {
  const { mainRoot, commonDirectory } = findRepository(startDirectory);
  const worktreeState = readStateOrFail(commonDirectory, worktreeName);
  if (!existsSync(worktreeState.path)) throw new Error(`${worktreeState.path} is missing`);
  const { recipe } = loadRecipeOrFail(mainRoot);
  const commandEnvironment = buildWorktreeEnvironment(recipe, worktreeState, mainRoot);
  let runResult = { exitCode: 0, failedCommand: null };
  for (const commandTemplate of resolveNamedCommands(recipe, worktreeState, commandName)) {
    const commandText = applyCommandArguments(renderTemplate(commandTemplate, worktreeState, mainRoot), extraArguments);
    const exitCode = runCommand(commandText, worktreeState.path, commandEnvironment);
    if (exitCode !== 0) {
      runResult = { exitCode, failedCommand: commandText };
      break;
    }
  }
  writeWorktreeState(commonDirectory, {
    ...worktreeState,
    last_run: { command: commandName, exit_code: runResult.exitCode, head: tryGit(worktreeState.path, ['rev-parse', 'HEAD']), at: new Date().toISOString() },
  });
  return runResult;
}

// Links made by the share strategy go first, so removing the worktree can never reach their targets.
export function removeShareLinks(worktreeState) {
  for (const trimmedEntry of worktreeState.trimmed ?? []) {
    if (trimmedEntry.strategy !== 'share') continue;
    const linkPath = join(worktreeState.path, trimmedEntry.path);
    try {
      if (lstatSync(linkPath).isSymbolicLink()) unlinkSync(linkPath);
    } catch {
      // already gone
    }
  }
}

export function removeWorktreeCheckout(mainRoot, worktreeState) {
  removeShareLinks(worktreeState);
  if (existsSync(worktreeState.path)) {
    runGit(mainRoot, ['worktree', 'remove', '--force', worktreeState.path]);
  }
  tryGit(mainRoot, ['worktree', 'prune']);
}

// Abandons a worktree: refuses with uncommitted changes unless discarding them is asked for, keeps
// its own commits in a bundle, then removes the checkout, the branch and the record.
export function dropWorktree(startDirectory, worktreeName, { confirm = false, discardUncommitted = false } = {}) {
  const { mainRoot, commonDirectory } = findRepository(startDirectory);
  const worktreeState = readStateOrFail(commonDirectory, worktreeName);
  if (!confirm) throw new Error(`drop deletes worktree "${worktreeName}" and its branch ${worktreeState.branch}; repeat with --confirm`);
  const uncommittedPaths = existsSync(worktreeState.path) ? listUncommittedPaths(worktreeState.path) : [];
  if (uncommittedPaths.length && !discardUncommitted) {
    throw new Error(`worktree "${worktreeName}" has uncommitted changes:\n${uncommittedPaths.join('\n')}\nCommit them, or repeat with --discard-uncommitted to lose them`);
  }
  let bundlePath = null;
  const { ahead } = countAheadBehind(mainRoot, worktreeState.base, worktreeState.branch);
  if (ahead) {
    const bundleDirectory = join(worktreeStateDirectory(commonDirectory), 'bundles');
    mkdirSync(bundleDirectory, { recursive: true });
    bundlePath = join(bundleDirectory, `${worktreeName}-${new Date().toISOString().replace(/[:.]/g, '-')}.bundle`);
    runGit(mainRoot, ['bundle', 'create', bundlePath, worktreeState.branch, `^${worktreeState.base}`]);
  }
  removeWorktreeCheckout(mainRoot, worktreeState);
  if (existsSync(worktreeState.path)) rmSync(worktreeState.path, { recursive: true, force: true });
  tryGit(mainRoot, ['branch', '-D', worktreeState.branch]);
  removeWorktreeState(commonDirectory, worktreeName);
  const storyboardClosing = closeStoryboard(mainRoot, worktreeName);
  return { name: worktreeName, branch: worktreeState.branch, bundlePath, discarded: uncommittedPaths, storyboard: storyboardClosing };
}
