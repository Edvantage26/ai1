// Local log of what every module decided, for `ai1 log` and issue reports: one JSON line per module
// run, metadata only (no command, path or text, so nothing private), in the state directory, one file
// per repo shared by its worktrees, rotated at 2 MB (one old file kept). Off with AI1_DECISION_LOG=0.
// Writing never fails the hook.

import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStateDirectory, shortHash } from './session-state.mjs';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const PLUGIN_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STACK_FRAME_LOCATION = /\(?((?:file:\/\/)?[^()\s]+?):(\d+):\d+\)?$/;

// What failed, without anything private: the error class and the first stack frame inside the plugin,
// as a plugin-relative `file:line` ("TypeError at src/verify/test-guard.mjs:57"). Messages and frames
// outside the plugin can hold paths or content, so they are left out.
export function errorSignature(thrownValue, pluginRoot = PLUGIN_ROOT) {
  const errorName = thrownValue?.name || 'Error';
  for (const stackLine of String(thrownValue?.stack || '').split('\n').slice(1)) {
    const frameMatch = stackLine.trim().match(STACK_FRAME_LOCATION);
    if (!frameMatch) continue;
    const framePath = frameMatch[1].startsWith('file://') ? fileURLToPath(frameMatch[1]) : frameMatch[1];
    const pluginRelativePath = relative(pluginRoot, framePath);
    if (!pluginRelativePath.startsWith('..') && !pluginRelativePath.startsWith(sep) && pluginRelativePath !== framePath) {
      return `${errorName} at ${pluginRelativePath.split(sep).join('/')}:${frameMatch[2]}`;
    }
  }
  return errorName;
}

export function isDecisionLogEnabled(environment = process.env) {
  return environment.AI1_DECISION_LOG !== '0';
}

export function decisionLogPath(sharedRoot, environment = process.env) {
  return join(resolveStateDirectory(environment), `decisions-${shortHash(sharedRoot)}.jsonl`);
}

// What a module's decision added: the length of its context text or its reason.
export function decisionCharacters(moduleDecision) {
  return String(moduleDecision?.text || moduleDecision?.reason || '').length;
}

export function appendDecisionLog(logEntries, sharedRoot, environment = process.env) {
  if (!logEntries.length || !isDecisionLogEnabled(environment)) return;
  try {
    const logPath = decisionLogPath(sharedRoot, environment);
    if (existsSync(logPath) && statSync(logPath).size > MAX_LOG_BYTES) renameSync(logPath, `${logPath}.1`);
    appendFileSync(logPath, logEntries.map((logEntry) => JSON.stringify(logEntry)).join('\n') + '\n');
    // Which repo the hashed file belongs to, for `ai1 log --all` on this machine only: never in an issue.
    const repoSidecarPath = logPath.replace(/\.jsonl$/, '.repo');
    if (!existsSync(repoSidecarPath)) writeFileSync(repoSidecarPath, JSON.stringify({ name: basename(sharedRoot), path: sharedRoot }));
  } catch {
    // A log that cannot be written is only a missing measurement.
  }
}

// Where hooks may have written: hooks get CLAUDE_PLUGIN_DATA, a shell does not, so the CLI reads every
// candidate - that variable's state dir when set, else each ai1 plugin data dir (`ai1-ai1` installed,
// `ai1-inline` from --plugin-dir) and the fallback cache. Existing folders only; nothing is created.
export function listStateDirectoriesToRead(environment = process.env, homeDirectory = homedir()) {
  if (environment.CLAUDE_PLUGIN_DATA) return [join(environment.CLAUDE_PLUGIN_DATA, 'state')].filter((stateDirectory) => existsSync(stateDirectory));
  const pluginDataDirectory = join(homeDirectory, '.claude', 'plugins', 'data');
  const pluginStateDirectories = existsSync(pluginDataDirectory)
    ? readdirSync(pluginDataDirectory).filter((dataFolderName) => dataFolderName.startsWith('ai1-')).map((dataFolderName) => join(pluginDataDirectory, dataFolderName, 'state'))
    : [];
  const fallbackDirectory = join(environment.XDG_CACHE_HOME || join(homeDirectory, '.cache'), 'ai1');
  return [...pluginStateDirectories, fallbackDirectory].filter((stateDirectory) => existsSync(stateDirectory));
}

function readLogLines(logPath) {
  return [`${logPath}.1`, logPath].filter((candidatePath) => existsSync(candidatePath)).flatMap((candidatePath) => readFileSync(candidatePath, 'utf8').split('\n'))
    .flatMap((logLine) => {
      try {
        return logLine ? [JSON.parse(logLine)] : [];
      } catch {
        return [];
      }
    });
}

// Every entry of this repo from every state dir, oldest first; broken lines are skipped.
export function readDecisionLog(sharedRoot, environment = process.env, homeDirectory = homedir()) {
  const logFileName = `decisions-${shortHash(sharedRoot)}.jsonl`;
  return listStateDirectoriesToRead(environment, homeDirectory)
    .flatMap((stateDirectory) => readLogLines(join(stateDirectory, logFileName)))
    .sort((firstEntry, secondEntry) => String(firstEntry.at).localeCompare(String(secondEntry.at)));
}
