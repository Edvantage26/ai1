// Local log of what every module decided, for `ai1 log` and issue reports: one JSON line per module
// run, metadata only (no command, path or text, so nothing private), in the state directory, one file
// per repo shared by its worktrees, rotated at 2 MB (one old file kept). Off with AI1_DECISION_LOG=0.
// Writing never fails the hook.

import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveStateDirectory, shortHash } from './session-state.mjs';

const MAX_LOG_BYTES = 2 * 1024 * 1024;

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
  } catch {
    // A log that cannot be written is only a missing measurement.
  }
}

// Every entry, oldest first (the rotated file, then the current one); broken lines are skipped.
export function readDecisionLog(sharedRoot, environment = process.env) {
  const logPath = decisionLogPath(sharedRoot, environment);
  return [`${logPath}.1`, logPath].filter((candidatePath) => existsSync(candidatePath)).flatMap((candidatePath) => readFileSync(candidatePath, 'utf8').split('\n'))
    .flatMap((logLine) => {
      try {
        return logLine ? [JSON.parse(logLine)] : [];
      } catch {
        return [];
      }
    });
}
