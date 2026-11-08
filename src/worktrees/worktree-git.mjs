// git helpers shared by the worktree engine and the guards: synchronous, local, no network.

import { execFileSync } from 'node:child_process';

export function runGit(workingDirectory, gitArguments, { input } = {}) {
  return execFileSync('git', ['-C', workingDirectory, ...gitArguments], {
    encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], input, maxBuffer: 64 * 1024 * 1024,
  });
}

export function tryGit(workingDirectory, gitArguments) {
  try {
    return runGit(workingDirectory, gitArguments).trim();
  } catch {
    return null;
  }
}

// Ignored files (and fully ignored directories, listed once with a trailing slash) in a checkout:
// what `git worktree remove` deletes without asking. Null when git cannot tell.
export function listIgnoredPaths(checkoutPath) {
  const ignoredOutput = tryGit(checkoutPath, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory']);
  return ignoredOutput === null ? null : ignoredOutput.split('\n').filter(Boolean);
}
