// `jig verify` runs the repo's verify commands (from .claude/jig.json) in order, with their output
// shown as is, and stops at the first failure. `jig step-done <slug> "<step>"` does the same and,
// only when everything passes, appends the step to the deep-lane progress log: progress written
// there is evidence, not the agent's word.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadHarnessConfig } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/registry.mjs';
import { WORK_DIRECTORY } from '../lanes/lanes-work.mjs';

export function readVerifyCommands(repoRoot) {
  const loadedConfig = loadHarnessConfig(repoRoot, KNOWN_MODULE_IDS);
  if (loadedConfig.status !== 'ok') throw new Error(`no valid .claude/jig.json in ${repoRoot} (${loadedConfig.status})`);
  return loadedConfig.config.verify;
}

// { passed, failedCommand, exitCode }. `runCommand` is injectable for tests.
export function runVerifyCommands(repoRoot, verifyCommands, runCommand = defaultRunCommand) {
  if (verifyCommands.length === 0) throw new Error('no verify commands in .claude/jig.json ("verify": [...])');
  for (const verifyCommand of verifyCommands) {
    const exitCode = runCommand(verifyCommand, repoRoot);
    if (exitCode !== 0) return { passed: false, failedCommand: verifyCommand, exitCode };
  }
  return { passed: true, failedCommand: null, exitCode: 0 };
}

function defaultRunCommand(verifyCommand, repoRoot) {
  const commandResult = spawnSync(verifyCommand, { cwd: repoRoot, shell: true, stdio: 'inherit' });
  return commandResult.status ?? 1;
}

export function recordStepDone(repoRoot, planSlug, stepText, verifyCommands, recordedAt = new Date().toISOString()) {
  const planDirectory = join(repoRoot, WORK_DIRECTORY, planSlug);
  if (!existsSync(join(planDirectory, 'plan.md'))) throw new Error(`no plan at ${WORK_DIRECTORY}/${planSlug}/plan.md`);
  const progressPath = join(planDirectory, 'progress.md');
  appendFileSync(progressPath, `- ${recordedAt} ${stepText} - verify green: ${verifyCommands.join(', ')}\n`);
  return progressPath;
}
