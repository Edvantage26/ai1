// Errors of ai1 itself (a module that threw, the hook entry point that crashed) waiting to be offered
// to the person as an issue: `errors-<hash>.json` in the state dir, one entry per module and error
// signature, kept small (entries unseen for 30 days are dropped). Concurrent hooks may lose a count:
// the file only drives a one-line offer. Off with the decision log (AI1_DECISION_LOG=0).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDecisionLogEnabled } from './decision-log.mjs';
import { readStateJson, resolveStateDirectory, shortHash, writeStateText } from './session-state.mjs';

const MAX_ERROR_AGE_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;

export function pendingErrorsFileName(sharedRoot) {
  return `errors-${shortHash(sharedRoot)}.json`;
}

function pruneOldErrors(pendingErrors, nowMilliseconds) {
  return Object.fromEntries(Object.entries(pendingErrors).filter(([, pendingError]) => nowMilliseconds - Date.parse(pendingError.last) < MAX_ERROR_AGE_MILLISECONDS));
}

// `errorEntries`: decision log entries with `decision: "error"`.
export function recordPendingErrors(errorEntries, sharedRoot, environment = process.env, now = new Date()) {
  if (!errorEntries.length || !isDecisionLogEnabled(environment)) return;
  try {
    const errorsPath = join(resolveStateDirectory(environment), pendingErrorsFileName(sharedRoot));
    const pendingErrors = pruneOldErrors(readStateJson(errorsPath), now.getTime());
    for (const errorEntry of errorEntries) {
      const errorKey = `${errorEntry.module}|${errorEntry.error}`;
      const knownError = pendingErrors[errorKey];
      pendingErrors[errorKey] = {
        module: errorEntry.module,
        error: errorEntry.error,
        count: (knownError?.count || 0) + 1,
        first: knownError?.first || now.toISOString(),
        last: now.toISOString(),
        ...(knownError?.offeredVersion ? { offeredVersion: knownError.offeredVersion } : {}),
      };
    }
    writeStateText(errorsPath, JSON.stringify(pendingErrors, null, 2));
  } catch {
    // Losing an error record only loses an offer.
  }
}

export function readPendingErrors(sharedRoot, environment = process.env) {
  return readStateJson(join(resolveStateDirectory(environment), pendingErrorsFileName(sharedRoot)));
}

export function markErrorsOffered(errorKeys, pluginVersion, sharedRoot, environment = process.env) {
  const errorsPath = join(resolveStateDirectory(environment), pendingErrorsFileName(sharedRoot));
  const pendingErrors = readStateJson(errorsPath);
  for (const errorKey of errorKeys) if (pendingErrors[errorKey]) pendingErrors[errorKey].offeredVersion = pluginVersion;
  writeStateText(errorsPath, JSON.stringify(pendingErrors, null, 2));
}

// For the CLI, which has no CLAUDE_PLUGIN_DATA: the pending errors of a repo in every given state dir.
export function readPendingErrorsFrom(stateDirectories, sharedRoot) {
  return stateDirectories.flatMap((stateDirectory) => {
    const errorsPath = join(stateDirectory, pendingErrorsFileName(sharedRoot));
    if (!existsSync(errorsPath)) return [];
    try {
      return Object.values(JSON.parse(readFileSync(errorsPath, 'utf8')));
    } catch {
      return [];
    }
  });
}
