// The basic worktree recipe: what ai1 works out from the repo itself on every use, so a repo needs no
// recipe file to work in worktrees. The project file `.claude/skills/worktree/recipe.json` is an
// overlay on top of it (only the fields that differ; see loadRecipe). Worked out again each time, so
// it follows the repo when it changes (a new lockfile, new verify commands). Cheap: a few existence
// checks and .ai1/config.json, no walk of the tree (it also runs from the UserPromptSubmit reminder).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHarnessConfig } from '../core/config.mjs';

// Ignored env files at the root and one folder down (`frontend/.env`), copied into every worktree.
export const BASIC_COPY_PATTERNS = ['.env', '.env.*', '*/.env', '*/.env.*'];

// Lockfile at the root -> the folder it fills (regenerated in a worktree, never shared) and its
// install command. First match wins. poetry keeps its virtualenv outside the repo by default.
const LOCKFILE_INSTALLS = [
  { lockfile: 'package-lock.json', heavyPath: 'node_modules', command: 'npm ci' },
  { lockfile: 'pnpm-lock.yaml', heavyPath: 'node_modules', command: 'pnpm install --frozen-lockfile' },
  { lockfile: 'yarn.lock', heavyPath: 'node_modules', command: 'yarn install --frozen-lockfile' },
  { lockfile: 'bun.lock', heavyPath: 'node_modules', command: 'bun install --frozen-lockfile' },
  { lockfile: 'bun.lockb', heavyPath: 'node_modules', command: 'bun install --frozen-lockfile' },
  { lockfile: 'uv.lock', heavyPath: '.venv', command: 'uv sync' },
  { lockfile: 'poetry.lock', heavyPath: null, command: 'poetry install' },
];

function detectInstalls(repoRoot) {
  const detectedInstalls = [];
  const seenHeavyPaths = new Set();
  for (const lockfileInstall of LOCKFILE_INSTALLS) {
    if (!existsSync(join(repoRoot, lockfileInstall.lockfile))) continue;
    const heavyKey = lockfileInstall.heavyPath ?? lockfileInstall.command;
    if (seenHeavyPaths.has(heavyKey)) continue;
    seenHeavyPaths.add(heavyKey);
    detectedInstalls.push(lockfileInstall);
  }
  return detectedInstalls;
}

// Only the fields the basic recipe decides; the rest come from DEFAULT_RECIPE.
export function detectBasicRecipe(repoRoot) {
  const detectedInstalls = detectInstalls(repoRoot);
  const loadedConfig = loadHarnessConfig(repoRoot);
  const verifyCommands = loadedConfig.status === 'ok' ? loadedConfig.config.verify ?? [] : [];
  return {
    base: 'trunk',
    copy: BASIC_COPY_PATTERNS,
    heavy: detectedInstalls.filter((lockfileInstall) => lockfileInstall.heavyPath)
      .map((lockfileInstall) => ({ path: lockfileInstall.heavyPath, strategy: 'regenerate', command: lockfileInstall.command })),
    setup: detectedInstalls.map((lockfileInstall) => lockfileInstall.command),
    // finish does not run verify by itself: pre-finish is what runs it before integrating.
    commands: verifyCommands.length ? { 'pre-finish': verifyCommands } : {},
  };
}
