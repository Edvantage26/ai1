// The person's config repo: their Claude Code config (CLAUDE.md, settings, skills, scripts, ai1
// customizations and stack) kept in a private git repo that ai1 structures and syncs. The repo is the
// source; ai1 copies each file to its place and records a fingerprint (sha256) of every copy in
// config-state.json, so at session start and end it knows which side changed: the repo (apply it), the
// copy (capture it into the repo), both (a conflict, told, nothing touched) or neither. Copies, not
// symlinks: the same on Linux, macOS and Windows, with no special rights, and nothing breaks when Claude
// Code recreates ~/.claude. Nothing is lost: a different file in a target is kept as `.bak` before the
// first copy, and a deletion is a git commit.
//
// Layout of the repo (one tree per target root; `machines/<host>/` has the same tree and wins):
//   claude/...                 -> ~/.claude/...            (settings.json by keys: config-settings.mjs)
//   home/...                   -> ~/...
//   ai1/...                    -> ~/.config/ai1/...         ($XDG_CONFIG_HOME respected)
//   machines/<host>/<same tree>
//   ai1-config.json            options: autoPush, settingsKeys, exclude, files, links

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { userConfigDirectory } from '../core/skill-customization.mjs';

export const CONFIG_OPTIONS_FILE = 'ai1-config.json';
export const MACHINES_DIRECTORY = 'machines';
export const SETTINGS_RELATIVE_PATH = 'claude/settings.json';
// Target roots, by the first folder of a repo path.
const TREE_NAMES = ['claude', 'home', 'ai1'];
// Inside the target roots, the folders where a new file is taken into the repo on its own, and the
// single files that are always managed. Anything else in ~/.claude is Claude Code's own state.
export const CAPTURED_FOLDERS = ['claude/skills', 'claude/scripts', 'ai1/skills'];
export const CAPTURED_FILES = ['claude/CLAUDE.md', 'ai1/stack.md'];
// Never managed, whatever the options say.
// Folders of other tools inside the managed ones (claude.ai's synced skills, Claude Code's trash).
export const FOREIGN_FOLDERS = ['claude/skills/synced', 'claude/skills/.trash'];
const ALWAYS_EXCLUDED = [...FOREIGN_FOLDERS, '__pycache__', 'node_modules', '.DS_Store'];
const ALWAYS_EXCLUDED_SUFFIXES = ['.pyc', '.bak'];

export function configDirectory({ environment = process.env, homeDirectory = homedir() } = {}) {
  return userConfigDirectory(environment, homeDirectory);
}

export function configRepoDirectory(pathOptions = {}) {
  return join(configDirectory(pathOptions), 'config-repo');
}

export function configStatePath(pathOptions = {}) {
  return join(configDirectory(pathOptions), 'config-state.json');
}

export function hasConfigRepo(pathOptions = {}) {
  return existsSync(join(configRepoDirectory(pathOptions), '.git'));
}

// The repo's options, with defaults.
export function readConfigOptions(repoDirectory) {
  let options = {};
  try {
    options = JSON.parse(readFileSync(join(repoDirectory, CONFIG_OPTIONS_FILE), 'utf8')) || {};
  } catch {
    options = {};
  }
  return {
    autoPush: options.autoPush === true,
    settingsKeys: Array.isArray(options.settingsKeys) ? options.settingsKeys : DEFAULT_SETTINGS_KEYS,
    exclude: Array.isArray(options.exclude) ? options.exclude.map(String) : [],
    files: Array.isArray(options.files) ? options.files.filter((fileEntry) => fileEntry && typeof fileEntry.repo === 'string' && typeof fileEntry.target === 'string') : [],
    links: Array.isArray(options.links) ? options.links.filter((linkEntry) => linkEntry && typeof linkEntry.repo === 'string' && typeof linkEntry.target === 'string') : [],
  };
}

// The keys of ~/.claude/settings.json that belong to the person; the rest is Claude Code's state.
export const DEFAULT_SETTINGS_KEYS = ['env', 'hooks', 'permissions', 'enabledPlugins', 'extraKnownMarketplaces', 'statusLine', 'model'];

// --- The person's local state ------------------------------------------------------------------

export function readConfigState(pathOptions = {}) {
  try {
    const state = JSON.parse(readFileSync(configStatePath(pathOptions), 'utf8'));
    return { files: {}, ...state, files: state.files && typeof state.files === 'object' ? state.files : {} };
  } catch {
    return { files: {} };
  }
}

export function writeConfigState(state, pathOptions = {}) {
  mkdirSync(configDirectory(pathOptions), { recursive: true });
  writeFileSync(configStatePath(pathOptions), `${JSON.stringify(state, null, 2)}\n`);
}

// This machine's name for `machines/<name>/`: the one the person set, else the host name in lowercase.
export function machineName(state = {}) {
  return String(state.machine || hostname()).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

// --- Paths -------------------------------------------------------------------------------------

const toRepoPath = (relativePath) => relativePath.split(sep).join('/');

export function targetRootFor(treeName, pathOptions = {}) {
  const homeDirectory = pathOptions.homeDirectory || homedir();
  if (treeName === 'claude') return join(homeDirectory, '.claude');
  if (treeName === 'home') return homeDirectory;
  if (treeName === 'ai1') return configDirectory(pathOptions);
  return null;
}

// `~/...` in an option, resolved against the home folder.
export function expandHome(targetText, homeDirectory) {
  return targetText === '~' ? homeDirectory : targetText.startsWith('~/') ? join(homeDirectory, ...targetText.slice(2).split('/')) : targetText;
}

export function isExcluded(treeRelativePath, excludePatterns = []) {
  const parts = treeRelativePath.split('/');
  if (ALWAYS_EXCLUDED_SUFFIXES.some((suffix) => treeRelativePath.endsWith(suffix))) return true;
  if (ALWAYS_EXCLUDED.some((excluded) => excluded.includes('/') ? treeRelativePath === excluded || treeRelativePath.startsWith(`${excluded}/`) : parts.includes(excluded))) return true;
  return excludePatterns.some((pattern) => treeRelativePath === pattern || treeRelativePath.startsWith(`${pattern.replace(/\/$/, '')}/`));
}

// Every file under a folder, as paths relative to `baseDirectory` with `/`. Symlinked folders are not followed.
function listFilesUnder(folderPath, baseDirectory) {
  if (!existsSync(folderPath)) return [];
  const foundPaths = [];
  const walk = (currentFolder) => {
    for (const directoryEntry of readdirSync(currentFolder, { withFileTypes: true })) {
      const entryPath = join(currentFolder, directoryEntry.name);
      if (directoryEntry.isDirectory()) walk(entryPath);
      else if (directoryEntry.isFile()) foundPaths.push(toRepoPath(relative(baseDirectory, entryPath)));
    }
  };
  if (statSync(folderPath).isDirectory()) walk(folderPath);
  return foundPaths;
}

export function fingerprintFile(filePath) {
  try {
    return createHash('sha256').update(readFileSync(filePath)).digest('hex');
  } catch {
    return null;
  }
}

// --- What is managed ---------------------------------------------------------------------------

// [{ key, repoPath, targetPath, source }]: one per target file. `key` is the tree path (claude/x/y) or
// `file:<target>` for an option entry; `repoPath` is relative to the repo; `source` is common or machine.
// The machine tree wins over the common one for the same key. settings.json is left to config-settings.
export function listRepoFiles(repoDirectory, { pathOptions = {}, machine, options = readConfigOptions(repoDirectory) } = {}) {
  const managedByKey = new Map();
  const addTree = (treeBase, source) => {
    for (const treeName of TREE_NAMES) {
      const targetRoot = targetRootFor(treeName, pathOptions);
      for (const insideTree of listFilesUnder(join(repoDirectory, ...treeBase, treeName), join(repoDirectory, ...treeBase, treeName))) {
        const key = `${treeName}/${insideTree}`;
        if (key === SETTINGS_RELATIVE_PATH || isExcluded(key, options.exclude)) continue;
        managedByKey.set(key, { key, repoPath: toRepoPath(join(...treeBase, treeName, insideTree)), targetPath: join(targetRoot, ...insideTree.split('/')), source });
      }
    }
  };
  addTree([], 'common');
  addTree([MACHINES_DIRECTORY, machine], 'machine');
  const homeDirectory = pathOptions.homeDirectory || homedir();
  for (const fileEntry of options.files) {
    if (!existsSync(join(repoDirectory, fileEntry.repo))) continue;
    const key = `file:${fileEntry.target}`;
    managedByKey.set(key, { key, repoPath: fileEntry.repo, targetPath: expandHome(fileEntry.target, homeDirectory), source: 'file' });
  }
  return [...managedByKey.values()];
}

// Files in the captured folders and files of the targets that the repo does not have yet: [{ key, targetPath, repoPath }].
export function findNewTargetFiles(repoDirectory, managedFiles, recordedKeys, { pathOptions = {}, options = readConfigOptions(repoDirectory) } = {}) {
  const knownKeys = new Set([...managedFiles.map((managedFile) => managedFile.key), ...recordedKeys]);
  const newFiles = [];
  const consider = (key) => {
    if (knownKeys.has(key) || key === SETTINGS_RELATIVE_PATH || isExcluded(key, options.exclude)) return;
    const [treeName, ...insideParts] = key.split('/');
    const targetPath = join(targetRootFor(treeName, pathOptions), ...insideParts);
    if (existsSync(targetPath) && !isSymlinkIntoRepo(targetPath, repoDirectory)) newFiles.push({ key, targetPath, repoPath: key });
  };
  for (const capturedFolder of CAPTURED_FOLDERS) {
    const [treeName, ...insideParts] = capturedFolder.split('/');
    const targetFolder = join(targetRootFor(treeName, pathOptions), ...insideParts);
    if (existsSync(targetFolder) && isSymlinkIntoRepo(targetFolder, repoDirectory)) continue;
    for (const insideFolder of listFilesUnder(targetFolder, targetFolder)) consider(`${capturedFolder}/${insideFolder}`);
  }
  for (const capturedFile of CAPTURED_FILES) consider(capturedFile);
  return newFiles;
}

// A target that is (or sits in) a symlink into the repo: the copy and the repo are the same file.
export function isSymlinkIntoRepo(targetPath, repoDirectory) {
  try {
    const realTarget = realpathSync(targetPath);
    const realRepo = realpathSync(repoDirectory);
    return realTarget === realRepo || realTarget.startsWith(`${realRepo}${sep}`);
  } catch {
    return false;
  }
}

// --- The sync plan -----------------------------------------------------------------------------

// What to do with each managed file, comparing the repo, the copy and the recorded fingerprint:
//   in-sync, install (no copy yet), install-backup (a different file was there: keep it as .bak),
//   apply (repo changed), capture (copy changed), capture-new (a new file in a captured folder),
//   capture-delete (copy deleted), apply-delete (the repo dropped it, copy unchanged),
//   conflict (both changed, or the repo dropped a file the person changed).
export function planConfigSync(repoDirectory, { pathOptions = {}, state = readConfigState(pathOptions), options = readConfigOptions(repoDirectory) } = {}) {
  const machine = machineName(state);
  const managedFiles = listRepoFiles(repoDirectory, { pathOptions, machine, options });
  const managedKeys = new Set(managedFiles.map((managedFile) => managedFile.key));
  const actions = [];
  for (const managedFile of managedFiles) {
    const repoFingerprint = fingerprintFile(join(repoDirectory, managedFile.repoPath));
    const targetExists = existsSync(managedFile.targetPath);
    const sameFile = targetExists && isSymlinkIntoRepo(managedFile.targetPath, repoDirectory);
    const targetFingerprint = targetExists ? fingerprintFile(managedFile.targetPath) : null;
    const recordedFingerprint = state.files[managedFile.key]?.hash ?? null;
    const action = (kind) => actions.push({ kind, ...managedFile, repoFingerprint, targetFingerprint, recordedFingerprint });
    if (sameFile || repoFingerprint === targetFingerprint) action('in-sync');
    else if (!targetExists) action(recordedFingerprint && recordedFingerprint === repoFingerprint ? 'capture-delete' : 'install');
    else if (!recordedFingerprint) action('install-backup');
    else if (targetFingerprint === recordedFingerprint) action('apply');
    else if (repoFingerprint === recordedFingerprint) action('capture');
    else action('conflict');
  }
  for (const [key, recorded] of Object.entries(state.files)) {
    if (managedKeys.has(key) || key === SETTINGS_RELATIVE_PATH) continue;
    const targetPath = recorded.target;
    if (!targetPath || !existsSync(targetPath)) {
      actions.push({ kind: 'forget', key, targetPath, repoPath: recorded.repoPath });
      continue;
    }
    const targetFingerprint = fingerprintFile(targetPath);
    actions.push({ kind: targetFingerprint === recorded.hash ? 'apply-delete' : 'conflict', key, targetPath, repoPath: recorded.repoPath, targetFingerprint, recordedFingerprint: recorded.hash, repoFingerprint: null });
  }
  for (const newFile of findNewTargetFiles(repoDirectory, managedFiles, Object.keys(state.files), { pathOptions, options })) {
    actions.push({ kind: 'capture-new', ...newFile, source: 'common', targetFingerprint: fingerprintFile(newFile.targetPath) });
  }
  return { machine, actions };
}

function copyWithFolders(fromPath, toPath) {
  mkdirSync(dirname(toPath), { recursive: true });
  // A symlink at the destination (the old install script) is replaced, never written through.
  if (existsSync(toPath) && lstatSync(toPath).isSymbolicLink()) rmSync(toPath);
  copyFileSync(fromPath, toPath);
}

// Carries out the plan. `direction`: 'apply' (repo -> targets: install, apply, apply-delete) and/or
// 'capture' (targets -> repo: capture, capture-new, capture-delete). Records the new fingerprints.
// Returns { done: [action], conflicts: [action], backups: [path] }.
export function runConfigSync(repoDirectory, plan, { directions = ['apply', 'capture'], pathOptions = {}, state = readConfigState(pathOptions), skipKeys = new Set() } = {}) {
  const done = [];
  const conflicts = [];
  const backups = [];
  const files = { ...state.files };
  const record = (action, fingerprint) => { files[action.key] = { hash: fingerprint, target: action.targetPath, repoPath: action.repoPath, source: action.source }; };
  for (const action of plan.actions) {
    if (skipKeys.has(action.key)) continue;
    const repoFilePath = action.repoPath ? join(repoDirectory, ...action.repoPath.split('/')) : null;
    if (action.kind === 'in-sync') {
      record(action, action.repoFingerprint);
      continue;
    }
    if (action.kind === 'conflict') {
      conflicts.push(action);
      continue;
    }
    if (action.kind === 'forget') {
      delete files[action.key];
      continue;
    }
    const isApply = ['install', 'install-backup', 'apply', 'apply-delete'].includes(action.kind);
    if (!directions.includes(isApply ? 'apply' : 'capture')) continue;
    if (action.kind === 'install-backup') {
      const backupPath = `${action.targetPath}.bak`;
      copyWithFolders(action.targetPath, backupPath);
      backups.push(backupPath);
    }
    if (['install', 'install-backup', 'apply'].includes(action.kind)) {
      copyWithFolders(repoFilePath, action.targetPath);
      record(action, action.repoFingerprint);
    } else if (action.kind === 'apply-delete') {
      rmSync(action.targetPath, { force: true });
      delete files[action.key];
    } else if (action.kind === 'capture' || action.kind === 'capture-new') {
      copyWithFolders(action.targetPath, repoFilePath);
      record(action, action.targetFingerprint);
    } else if (action.kind === 'capture-delete') {
      rmSync(repoFilePath, { force: true });
      delete files[action.key];
    }
    done.push(action);
  }
  writeConfigState({ ...readConfigState(pathOptions), files }, pathOptions);
  return { done, conflicts, backups };
}
