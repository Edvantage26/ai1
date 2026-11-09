// git for every module and the CLI: synchronous, local, no network. runGit throws on failure (its
// error carries stderr); tryGit returns the trimmed output, or null when git fails.

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

// The branch origin/HEAD points to (the remote's default branch, as this clone knows it), or null.
export function readOriginHeadBranch(repoRoot) {
  return tryGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])?.replace(/^origin\//, '') || null;
}

// The repo's main branch, whatever its name: origin/HEAD when the clone knows it, else main or
// master if present, else the current branch.
export function detectTrunkBranch(repoRoot) {
  const originHeadBranch = readOriginHeadBranch(repoRoot);
  if (originHeadBranch) return originHeadBranch;
  for (const candidateBranch of ['main', 'master']) {
    if (tryGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidateBranch}`])) return candidateBranch;
  }
  return tryGit(repoRoot, ['branch', '--show-current']) || 'main';
}
