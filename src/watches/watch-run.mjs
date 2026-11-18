// Runs a command watch (`ai1 watch run`, never a hook): a list of arguments without a shell, a string with
// the platform's shell, with a timeout and `AI1_WATCH_SINCE` (ISO date of the last run, or of the
// subscription) in its environment. Health watches: the exit code decides ok/fail. Counts watches: the
// last line of the output is JSON { succeeded, failed } for the events since that date.

import { spawnSync } from 'node:child_process';
import { DEFAULT_TIMEOUT_SECONDS, isCountsWatch } from './watch-definitions.mjs';

// The last non-empty line of the output as { succeeded, failed }, or null.
export function parseWatchCounts(outputText) {
  const lastLine = String(outputText || '').trim().split(/\r?\n/).pop();
  try {
    const parsedCounts = JSON.parse(lastLine);
    const isCount = (countValue) => Number.isInteger(countValue) && countValue >= 0;
    return parsedCounts && isCount(parsedCounts.succeeded) && isCount(parsedCounts.failed) ? { succeeded: parsedCounts.succeeded, failed: parsedCounts.failed } : null;
  } catch {
    return null;
  }
}

export function runWatchCommand(watchDefinition, { repoRoot, sinceDate, environment = process.env }) {
  const watchCheck = watchDefinition.check;
  const spawnOptions = {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: (watchCheck.timeoutSeconds || DEFAULT_TIMEOUT_SECONDS) * 1000,
    env: { ...environment, AI1_WATCH_SINCE: sinceDate },
    windowsHide: true,
  };
  const spawnResult = Array.isArray(watchCheck.run)
    ? spawnSync(watchCheck.run[0], watchCheck.run.slice(1), spawnOptions)
    : spawnSync(watchCheck.run, { ...spawnOptions, shell: true });
  const outputText = `${spawnResult.stdout || ''}${spawnResult.stderr || ''}`;
  if (spawnResult.error?.code === 'ETIMEDOUT' || (spawnResult.signal && spawnResult.status === null)) {
    return { result: 'fail', note: `timed out after ${spawnOptions.timeout / 1000} s`, output: outputText };
  }
  if (spawnResult.error) return { result: 'error', note: `could not start: ${spawnResult.error.message}`, output: outputText };
  if (isCountsWatch(watchDefinition)) {
    const watchCounts = parseWatchCounts(spawnResult.stdout);
    if (!watchCounts) return { result: 'error', note: `exit ${spawnResult.status}, and the last output line is not {"succeeded": n, "failed": m}`, output: outputText };
    return { result: watchCounts.failed > 0 ? 'fail' : 'ok', ...watchCounts, output: outputText };
  }
  const expectedExitCode = watchCheck.expect?.exitCode ?? 0;
  return spawnResult.status === expectedExitCode
    ? { result: 'ok', output: outputText }
    : { result: 'fail', note: `exit ${spawnResult.status}, expected ${expectedExitCode}`, output: outputText };
}
