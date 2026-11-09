// Small per-session, per-project state files for modules that need memory between hook events
// (e.g. the HEAD at session start, or the last reminder already shown).
// Lives in ${CLAUDE_PLUGIN_DATA}/state when Claude Code provides it, else ~/.cache/ai1.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const STATE_MAX_AGE_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export function resolveStateDirectory(environment = process.env) {
  const stateDirectory = environment.CLAUDE_PLUGIN_DATA
    ? join(environment.CLAUDE_PLUGIN_DATA, 'state')
    : join(environment.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ai1');
  mkdirSync(stateDirectory, { recursive: true });
  return stateDirectory;
}

export function shortHash(text) {
  return createHash('sha1').update(text).digest('hex').slice(0, 12);
}

export function sessionStatePath(stateDirectory, sessionId, projectRoot, stateName) {
  return join(stateDirectory, `${sessionId || 'unknown'}-${shortHash(projectRoot)}.${stateName}`);
}

export function readStateText(statePath) {
  return existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
}

// Parsed JSON state, or `fallbackValue` when the file is missing or broken (a broken state file only
// means the module starts over, never an error).
export function readStateJson(statePath, fallbackValue = {}) {
  try {
    return JSON.parse(readStateText(statePath) || 'null') ?? fallbackValue;
  } catch {
    return fallbackValue;
  }
}

export function writeStateText(statePath, stateText) {
  writeFileSync(statePath, stateText);
}

export function stateModifiedMilliseconds(statePath) {
  return existsSync(statePath) ? statSync(statePath).mtimeMs : null;
}

export function removeExpiredStateFiles(stateDirectory, nowMilliseconds = Date.now()) {
  for (const stateFileName of readdirSync(stateDirectory)) {
    const stateFilePath = join(stateDirectory, stateFileName);
    if (nowMilliseconds - statSync(stateFilePath).mtimeMs > STATE_MAX_AGE_MILLISECONDS) unlinkSync(stateFilePath);
  }
}
