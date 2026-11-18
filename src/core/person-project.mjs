// The person within a project: their own data in `.ai1/local/` of the main checkout (ignored by git,
// shared by every worktree) and their role there. The repo's `maintainers` (git emails) is the team's
// default; `.ai1/local/profile.json` `role` is the person's own choice and wins. Without a
// `maintainers` list everyone is a maintainer (what ai1 did before the list existed).

import { join } from 'node:path';
import { LOCAL_DIRECTORY } from './config.mjs';
import { tryGit } from './git.mjs';
import { readJsonFileIfValid, writeJsonFile } from './json-file.mjs';
import { ensureDirectoryIgnoredByItself } from './project-paths.mjs';

export const PERSON_ROLES = ['maintainer', 'developer'];
export const PROFILE_FILE_NAME = 'profile.json';
export const STATE_FILE_NAME = 'state.json';

export function localDirectoryPath(sharedRoot) {
  return join(sharedRoot, LOCAL_DIRECTORY);
}

export function readLocalJson(sharedRoot, fileName, fallbackValue = {}) {
  const jsonValue = readJsonFileIfValid(join(localDirectoryPath(sharedRoot), fileName));
  return jsonValue && typeof jsonValue === 'object' && !Array.isArray(jsonValue) ? jsonValue : fallbackValue;
}

// Creates `.ai1/local/` (with its own `.gitignore`) on the first write.
export function writeLocalJson(sharedRoot, fileName, jsonValue) {
  ensureDirectoryIgnoredByItself(localDirectoryPath(sharedRoot));
  writeJsonFile(join(localDirectoryPath(sharedRoot), fileName), jsonValue);
}

// Git emails are compared lower-cased: git and mail servers treat them so, and Windows file names too.
export function normalizeEmail(emailText) {
  return typeof emailText === 'string' && emailText.trim() ? emailText.trim().toLowerCase() : null;
}

// One `git config` per process and repo: several SessionStart modules ask for it.
const gitEmailByRoot = new Map();

export function readGitUserEmail(projectRoot) {
  if (!gitEmailByRoot.has(projectRoot)) gitEmailByRoot.set(projectRoot, normalizeEmail(tryGit(projectRoot, ['config', 'user.email'])));
  return gitEmailByRoot.get(projectRoot);
}

export function readPersonProfile(sharedRoot) {
  return readLocalJson(sharedRoot, PROFILE_FILE_NAME);
}

export function writePersonProfile(sharedRoot, personProfile) {
  writeLocalJson(sharedRoot, PROFILE_FILE_NAME, personProfile);
}

// 'maintainer' or 'developer', with where it came from: 'profile', 'maintainers' or 'default'.
export function resolvePersonRole({ config, sharedRoot, projectRoot = sharedRoot }) {
  const profileRole = readPersonProfile(sharedRoot).role;
  if (PERSON_ROLES.includes(profileRole)) return { role: profileRole, source: 'profile' };
  if (!Array.isArray(config?.maintainers)) return { role: 'maintainer', source: 'default' };
  const personEmail = readGitUserEmail(projectRoot);
  const isListed = Boolean(personEmail) && config.maintainers.some((maintainerEmail) => normalizeEmail(maintainerEmail) === personEmail);
  return { role: isListed ? 'maintainer' : 'developer', source: 'maintainers' };
}

export function isPersonMaintainer(roleContext) {
  return resolvePersonRole(roleContext).role === 'maintainer';
}

// What ai1 writes for the person (maintenance notices, watch results): never edited by hand, never committed.
export function readPersonState(sharedRoot) {
  return readLocalJson(sharedRoot, STATE_FILE_NAME);
}

export function writePersonState(sharedRoot, personState) {
  writeLocalJson(sharedRoot, STATE_FILE_NAME, personState);
}
