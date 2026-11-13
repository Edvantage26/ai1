// `ai1 verify` runs the repo's verify commands (from .ai1/config.json) in order, with their output
// shown as is, and stops at the first failure. `ai1 step-done <slug> "<step>"` does the same and,
// only when everything passes, appends the step to the deep progress log: progress written
// there is evidence, not the agent's word.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadHarnessConfig } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/module-index.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { findPlanRoot, listPlanRoots, readPlanSize, readPlanStatus, writePlanStatus } from '../sizing/sizing-work.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { checkScenarioCoverage, formatScenarioTag } from '../sizing/sizing-scenarios.mjs';

export function readVerifyCommands(repoRoot) {
  const loadedConfig = loadHarnessConfig(repoRoot, KNOWN_MODULE_IDS);
  if (loadedConfig.status !== 'ok') throw new Error(`no valid .ai1/config.json in ${repoRoot} (${loadedConfig.status})`);
  return loadedConfig.config.verify;
}

// { passed, failedCommand, exitCode }. `runCommand` is injectable for tests.
export function runVerifyCommands(repoRoot, verifyCommands, runCommand = defaultRunCommand) {
  if (verifyCommands.length === 0) throw new Error('no verify commands in .ai1/config.json ("verify": [...])');
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

// Where `ai1 step-done` / `plan-done` find a plan: this checkout (a worktree keeps the plans of a
// session isolated in it), then the main checkout; the main checkout when neither has it, so the
// "no plan" error names the usual place.
export function findPlanRootFor(repoRoot, planSlug) {
  const mainCheckoutRoot = findMainCheckout(repoRoot);
  return findPlanRoot(listPlanRoots(repoRoot, mainCheckoutRoot), planSlug) ?? mainCheckoutRoot;
}

export function recordStepDone(repoRoot, planSlug, stepText, verifyCommands, recordedAt = new Date().toISOString()) {
  const planDirectory = join(repoRoot, WORK_DIRECTORY, planSlug);
  if (!existsSync(join(planDirectory, 'plan.md'))) throw new Error(`no plan at ${WORK_DIRECTORY}/${planSlug}/plan.md`);
  const progressPath = join(planDirectory, 'progress.md');
  appendFileSync(progressPath, `- ${recordedAt} ${stepText} - verify green: ${verifyCommands.join(', ')}\n`);
  return progressPath;
}

// Coverage of a plan's behaviour scenarios, as one line for `ai1 step-done`; null when the plan has none.
export function describeScenarioCoverage(mainCheckoutRoot, scanRoot, planSlug, repoFiles) {
  const planText = readFileSync(join(mainCheckoutRoot, WORK_DIRECTORY, planSlug, 'plan.md'), 'utf8');
  const scenarioCoverage = checkScenarioCoverage(scanRoot, planSlug, planText, repoFiles);
  if (scenarioCoverage.scenarioIds.length === 0) return null;
  const coveredCount = scenarioCoverage.coveredLocations.size;
  const missingNote = scenarioCoverage.missingIds.length ? ` (missing ${scenarioCoverage.missingIds.join(', ')})` : '';
  return `scenarios covered so far: ${coveredCount}/${scenarioCoverage.scenarioIds.length}${missingNote}`;
}

// `ai1 plan-done <slug>`: the one way to close a plan. A deep plan (findPlanRootFor) must be approved,
// a plan task's plan only unfinished; every scenario of its `# Behaviour` section needs its tag `[<slug>:S<n>]` in the scanned checkout
// (the worktree, where the tests live before merge); then the verify commands must pass. Only then
// `status: done` and a progress line. { closed, message }. Throws when the scan cannot run.
export function closePlan(mainCheckoutRoot, scanRoot, planSlug, verifyCommands, options = {}) {
  const { runCommand = defaultRunCommand, repoFiles, recordedAt = new Date().toISOString() } = options;
  const planDirectory = join(mainCheckoutRoot, WORK_DIRECTORY, planSlug);
  const planPath = join(planDirectory, 'plan.md');
  if (!existsSync(planPath)) throw new Error(`no plan at ${WORK_DIRECTORY}/${planSlug}/plan.md`);
  const planText = readFileSync(planPath, 'utf8');
  const planStatus = readPlanStatus(planText);
  if (readPlanSize(planText) === 'plan') {
    if (['done', 'abandoned'].includes(planStatus)) return { closed: false, message: `the plan is already ${planStatus}` };
  } else if (planStatus !== 'approved') {
    return { closed: false, message: `the plan is ${planStatus}, not approved: only an approved plan can be closed` };
  }
  const scenarioCoverage = checkScenarioCoverage(scanRoot, planSlug, planText, repoFiles);
  if (scenarioCoverage.duplicateIds.length) {
    return { closed: false, message: `duplicate scenario ids in the plan: ${scenarioCoverage.duplicateIds.join(', ')}` };
  }
  if (scenarioCoverage.missingIds.length) {
    const missingTags = scenarioCoverage.missingIds.map((scenarioId) => formatScenarioTag(planSlug, scenarioId)).join(', ');
    return { closed: false, message: `scenarios without a tagged test: ${missingTags} (put the tag in the test name or a comment next to it)` };
  }
  const verifyResult = runVerifyCommands(scanRoot, verifyCommands, runCommand);
  if (!verifyResult.passed) return { closed: false, message: `\`${verifyResult.failedCommand}\` failed (exit ${verifyResult.exitCode})` };
  const coverageText = scenarioCoverage.scenarioIds.length
    ? `scenarios ${scenarioCoverage.scenarioIds.length}/${scenarioCoverage.scenarioIds.length} covered: ${[...scenarioCoverage.coveredLocations].map(([scenarioId, location]) => `${scenarioId} ${location}`).join(', ')}`
    : 'no scenarios';
  appendFileSync(join(planDirectory, 'progress.md'), `- ${recordedAt} plan done - ${coverageText} - verify green: ${verifyCommands.join(', ')}\n`);
  writePlanStatus(planPath, 'done');
  return { closed: true, message: `plan ${planSlug} done (${coverageText}; verify green)` };
}
