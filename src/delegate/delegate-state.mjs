// Session state of the delegate feature, in ai1's state directory (never in the repos):
// - allowed repos: repositories the person said must be edited from this session (R5,
//   `ai1 delegate allow <repo> --because "<their words>"`), keyed by session only: the CLI runs from a
//   Bash call where CLAUDE_PROJECT_DIR is not set, so it cannot know the launch root the hook saw;
// - noted repos: repositories without ai1 the agent was already told about once;
// - one-time allows: a command a guard of the delegated repository asked about and the person
//   confirmed (R2), keyed by the delegated session and its repository; danger and repo-rules use it once.

import { createHash } from 'node:crypto';
import { readStateJson, resolveStateDirectory, sessionStatePath, writeStateText } from '../core/session-state.mjs';

// State the hook writes and the CLI reads: keyed by the session id alone (both know it).
const SESSION_SCOPE = 'ai1-delegate-session';

function statePath(sessionId, rootPath, stateName, environment) {
  return sessionStatePath(resolveStateDirectory(environment), sessionId, rootPath, stateName);
}

export function readAllowedRepositories(sessionId, environment = process.env) {
  return readStateJson(statePath(sessionId, SESSION_SCOPE, 'delegate-allow', environment), {});
}

export function allowRepository(sessionId, repoRoot, becauseText, environment = process.env, now = new Date()) {
  const allowPath = statePath(sessionId, SESSION_SCOPE, 'delegate-allow', environment);
  const allowedRepositories = readStateJson(allowPath, {});
  allowedRepositories[repoRoot] = { because: becauseText, at: now.toISOString() };
  writeStateText(allowPath, JSON.stringify(allowedRepositories));
  return allowPath;
}

// true the first time `repoRoot` is noted in this session, false afterwards.
export function noteRepositoryOnce(sessionId, launchRoot, repoRoot, environment = process.env) {
  const notedPath = statePath(sessionId, launchRoot, 'delegate-noted', environment);
  const notedRepositories = readStateJson(notedPath, []);
  if (notedRepositories.includes(repoRoot)) return false;
  writeStateText(notedPath, JSON.stringify([...notedRepositories, repoRoot]));
  return true;
}

// The permission mode of the calling session, seen by the hook, so a delegated run inherits it (R1).
export function rememberPermissionMode(sessionId, permissionMode, environment = process.env) {
  if (!sessionId || !permissionMode) return;
  const modePath = statePath(sessionId, SESSION_SCOPE, 'permission-mode', environment);
  if (readStateJson(modePath, null) !== permissionMode) writeStateText(modePath, JSON.stringify(permissionMode));
}

export function readRememberedPermissionMode(sessionId, environment = process.env) {
  if (!sessionId) return null;
  return readStateJson(statePath(sessionId, SESSION_SCOPE, 'permission-mode', environment), null);
}

function commandKey(commandText) {
  return createHash('sha256').update(String(commandText).trim()).digest('hex').slice(0, 24);
}

// What a one-time allow is bound to: the shell command, or the edited file.
export function oneTimeAllowSubject(toolInput = {}) {
  return toolInput.command || toolInput.file_path || toolInput.notebook_path || '';
}

export function grantOneTimeAllow(delegatedSessionId, repoRoot, commandText, environment = process.env) {
  const allowsPath = statePath(delegatedSessionId, repoRoot, 'allow-once', environment);
  const oneTimeAllows = readStateJson(allowsPath, {});
  oneTimeAllows[commandKey(commandText)] = String(commandText).trim();
  writeStateText(allowsPath, JSON.stringify(oneTimeAllows));
}

// true (and the allow is spent) when this exact command was confirmed once for this session and repo.
export function consumeOneTimeAllow(sessionId, repoRoot, commandText, environment = process.env) {
  if (!sessionId || !commandText) return false;
  const allowsPath = statePath(sessionId, repoRoot, 'allow-once', environment);
  const oneTimeAllows = readStateJson(allowsPath, {});
  const allowKey = commandKey(commandText);
  if (!(allowKey in oneTimeAllows)) return false;
  delete oneTimeAllows[allowKey];
  writeStateText(allowsPath, JSON.stringify(oneTimeAllows));
  return true;
}
