// Requirements over time (plan requirements-lifecycle): the okf-project switch and when a project
// counts as started (S0), milestones and review (S1), satisfies (S2), changes said in messages (S3),
// the periodic review (S4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { setupRepo } from '../src/cli/setup-repo.mjs';
import { closePlan } from '../src/cli/verify-run.mjs';
import { createTemporaryProject } from './helpers.mjs';
import {
  buildGapMap, initProjectContext, addRequirement, listRequirements, findRequirement, isProjectContextEnabled,
  setRequirementMilestone, setRequirementState, buildRequirementsReview, mapSatisfyingConcepts, stampRequirementsReview,
} from '../src/okf/okf-project.mjs';
import { findMaintenanceTask, updateTaskSetting, shouldShowMaintenanceTask } from '../src/maintenance/maintenance-tasks.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
const FIXED_NOW = new Date('2026-11-21T10:00:00Z');

function createBundle(extraConfig = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: true }, ...extraConfig });
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  mkdirSync(bundleDirectory, { recursive: true });
  writeFileSync(join(bundleDirectory, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Bundle\n');
  return { projectRoot, bundleDirectory };
}

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

const readSessionStart = (projectRoot) => runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, hookOptions()).hookSpecificOutput?.additionalContext || '';

test('a Product concept of the design feature alone does not start the project; init marks it as project context [requirements-lifecycle:S0]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  writeFileSync(join(bundleDirectory, 'product.md'), '---\ntype: Product\ntitle: Shop\n---\n\n## Users\n\n### Owner\nRuns a shop.\n');
  assert.equal(buildGapMap(bundleDirectory).started, false);
  assert.doesNotMatch(readSessionStart(projectRoot), /Project context \(/);
  assert.deepEqual(initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW }).filter((writtenPath) => writtenPath === 'product.md'), ['product.md']);
  assert.match(readFileSync(join(bundleDirectory, 'product.md'), 'utf8'), /^project_context: true$/m);
  assert.equal(buildGapMap(bundleDirectory).started, true);
  assert.match(readSessionStart(projectRoot), /Project context \(/);
});

test('modules.okf-project false: no session-start lines, no plan-done notes, the CLI says it is off; okf keeps working [requirements-lifecycle:S0]', () => {
  const { projectRoot, bundleDirectory } = createBundle({ modules: { 'okf-project': false } });
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Pay by card', now: FIXED_NOW });
  assert.equal(isProjectContextEnabled({ features: { okf: true }, modules: { 'okf-project': false } }), false);
  assert.equal(isProjectContextEnabled({ features: { okf: true }, modules: {} }), true);
  assert.equal(isProjectContextEnabled({ features: { okf: false }, modules: {} }), false);
  const sessionStartText = readSessionStart(projectRoot);
  assert.doesNotMatch(sessionStartText, /Project context \(|Project doubts/);
  assert.match(sessionStartText, /OKF bundle at `\.ai1\/okf\/`/, 'okf itself still loads the index');
  const planDirectory = join(projectRoot, '.ai1', 'work', 'checkout');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Checkout\nstatus: approved\nrequirements: [R001]\n---\n\n# Goal\nPay.\n\n# Behaviour\nNone - internal.\n');
  const closeResult = closePlan(projectRoot, projectRoot, 'checkout', ['npm test'], { runCommand: () => 0, repoFiles: [] });
  assert.equal(closeResult.closed, true);
  assert.doesNotMatch(closeResult.message, /requirements:/);
  assert.equal(findRequirement(listRequirements(bundleDirectory), 'R001').state, 'active');
  const gapsText = execFileSync(process.execPath, [AI1_CLI, 'okf', 'project', 'gaps'], { cwd: projectRoot, encoding: 'utf8' });
  assert.match(gapsText, /^note: requirements are off in this repo \(`modules\.okf-project: false`/);
});

test('ai1 init --disable-modules okf-project writes the switch and keeps the other modules; an unknown module is refused [requirements-lifecycle:S0]', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-setup-'));
  execFileSync('git', ['-C', repoRoot, 'init', '-q', '-b', 'main']);
  mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify({ version: 2, features: {}, modules: { 'okf-recall': false } }));
  setupRepo(repoRoot, { enabledFeatureIds: ['okf'], disabledModuleIds: ['okf-project'], userSettingsPath: join(mkdtempSync(join(tmpdir(), 'ai1-user-')), 'settings.json') });
  const writtenConfig = JSON.parse(readFileSync(join(repoRoot, '.ai1', 'config.json'), 'utf8'));
  assert.deepEqual(writtenConfig.modules, { 'okf-recall': false, 'okf-project': false });
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf'], disabledModuleIds: ['nope'] }), /unknown modules: nope/);
});

function createSatisfiesRepo(extraConfig = {}) {
  const { projectRoot, bundleDirectory } = createBundle(extraConfig);
  addRequirement(bundleDirectory, { title: 'Pay by card', checkCommand: 'npm test -- payments', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Refunds by email', now: FIXED_NOW });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'src', 'pay.js'), 'export const pay = 1;\n');
  writeFileSync(join(bundleDirectory, 'payments.md'), '---\ntype: Component\ntitle: Payments\nresource: src/pay.js\nsatisfies: [R001, R002]\n---\nStripe checkout.\n');
  execFileSync('git', ['-C', projectRoot, 'init', '-q']);
  execFileSync('git', ['-C', projectRoot, 'add', '.']);
  execFileSync('git', ['-C', projectRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return { projectRoot, bundleDirectory };
}

const editFile = (projectRoot, options, relativePath) => runHookEvent('PostToolUse', {
  session_id: 'session-1', cwd: projectRoot, tool_name: 'Edit', tool_input: { file_path: join(projectRoot, relativePath) },
}, options)?.hookSpecificOutput?.additionalContext ?? '';

test('satisfies: editing code a concept says serves R001 asks once to run its check; none without a check command, on reads, or with okf-project off [requirements-lifecycle:S2]', () => {
  const { projectRoot, bundleDirectory } = createSatisfiesRepo();
  const options = hookOptions();
  const readContext = runHookEvent('PostToolUse', { session_id: 'session-1', cwd: projectRoot, tool_name: 'Read', tool_input: { file_path: join(projectRoot, 'src/pay.js') } }, options)?.hookSpecificOutput?.additionalContext ?? '';
  assert.doesNotMatch(readContext, /ai1 okf project verify/);
  const firstEdit = editFile(projectRoot, options, 'src/pay.js');
  assert.match(firstEdit, /`src\/pay\.js` is part of what R001 \(Pay by card\) needs: run `ai1 okf project verify R001` before finishing\./);
  assert.doesNotMatch(firstEdit, /R002/, 'a requirement without a check command gets no line');
  assert.doesNotMatch(editFile(projectRoot, options, 'src/pay.js'), /ai1 okf project verify/, 'once per requirement and session');
  assert.deepEqual(mapSatisfyingConcepts(bundleDirectory), { R001: ['payments.md'], R002: ['payments.md'] });
  const offRepo = createSatisfiesRepo({ modules: { 'okf-project': false } });
  assert.doesNotMatch(editFile(offRepo.projectRoot, hookOptions(), 'src/pay.js'), /ai1 okf project verify/);
});

test('messages: a change cue naming a requirement in force asks to confirm; naming an out-of-scope one says so; no cue, other words or okf-project off add nothing [requirements-lifecycle:S3]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Login con Google', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'App móvil nativa', state: 'out-of-scope', reason: 'web primero', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Login with Google accounts', now: FIXED_NOW });
  const options = hookOptions();
  const sendPrompt = (promptText, root = projectRoot) => runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: root, prompt: promptText }, options)?.hookSpecificOutput?.additionalContext ?? '';
  const changeText = sendPrompt('al final el cliente ya no quiere login con Google');
  assert.match(changeText, /this message may change R001 \(Login con Google\): confirm with the person in one line, then record it with their words/);
  assert.match(changeText, /`req add --supersedes R001`/);
  assert.match(changeText, /may change R003 \(Login with Google accounts\)/, 'two shared title words are enough across titles');
  assert.match(sendPrompt('haz la app móvil nativa'), /R002 \(App móvil nativa\) is out of scope: tell the person before building it/);
  assert.doesNotMatch(sendPrompt('revisa el login con Google, falla el botón'), /may change/, 'no change cue: only the usual recall');
  assert.doesNotMatch(sendPrompt('ya no funciona el pago con tarjeta'), /may change|out of scope/, 'a cue without the requirement words');
  const offRepo = createBundle({ modules: { 'okf-project': false } });
  addRequirement(offRepo.bundleDirectory, { title: 'Login con Google', now: FIXED_NOW });
  assert.doesNotMatch(sendPrompt('al final ya no quiere login con Google', offRepo.projectRoot), /may change/);
});

test('requirements-review: offered once enough changed since the last review (plans closed, requirement changes, days); not for a fresh project, nor with okf-project off; mutable [requirements-lifecycle:S4]', () => {
  const { projectRoot, bundleDirectory } = createBundle({ features: { okf: true, maintenance: true } });
  const reviewTask = findMaintenanceTask('requirements-review');
  const runCheck = (now, config = { features: { okf: true, maintenance: true }, modules: {} }) => reviewTask.check({ projectRoot, sharedRoot: projectRoot, config, now });
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  for (const title of ['Pay by card', 'Ship orders', 'Gift cards']) addRequirement(bundleDirectory, { title, now: FIXED_NOW });
  assert.equal(runCheck(new Date('2026-11-22T10:00:00Z')), null, 'requirements just added are not changes');
  for (const requirementId of ['R001', 'R002', 'R003']) setRequirementState(bundleDirectory, requirementId, 'validated', { plan: 'p', now: new Date('2026-11-25T10:00:00Z') });
  assert.match(runCheck(new Date('2026-11-26T10:00:00Z')), /^Requirements: 0 plan\(s\) closed, 3 requirement change\(s\) and 5 day\(s\) since the last review \(2026-11-21\): offer a review with \/ai1:okf-interview-project \(review mode\)$/);
  assert.equal(runCheck(new Date('2026-11-26T10:00:00Z'), { features: { okf: true, maintenance: true }, modules: { 'okf-project': false } }), null);
  stampRequirementsReview(bundleDirectory, { now: new Date('2026-11-26T10:00:00Z') });
  assert.equal(runCheck(new Date('2026-11-27T10:00:00Z')), null, 'a review resets the count');
  for (let planNumber = 0; planNumber < 5; planNumber += 1) {
    mkdirSync(join(projectRoot, '.ai1', 'work', `plan-${planNumber}`), { recursive: true });
    const planPath = join(projectRoot, '.ai1', 'work', `plan-${planNumber}`, 'plan.md');
    writeFileSync(planPath, '---\ntitle: P\nstatus: done\n---\n');
    const closedSeconds = Date.parse('2026-11-28T10:00:00Z') / 1000;
    utimesSync(planPath, closedSeconds, closedSeconds);
  }
  assert.match(runCheck(new Date('2026-11-29T10:00:00Z')) || '', /^Requirements: 5 plan\(s\) closed/);
  assert.match(runCheck(new Date('2027-03-01T10:00:00Z')) || '', /day\(s\) since the last review \(2026-11-26\)/);
  updateTaskSetting(projectRoot, 'requirements-review', { mode: 'off' });
  assert.equal(shouldShowMaintenanceTask('requirements-review', { config: { features: { okf: true, maintenance: true } }, sharedRoot: projectRoot, projectRoot }), false);
});

test('review per milestone: validated, still to build, out of scope with its reason, superseded, in force without a check command; --done stamps the Product concept [requirements-lifecycle:S1]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Pay by card', milestone: 'v1', checkCommand: 'npm test', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Ship orders', milestone: 'v1', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Native mobile app', milestone: 'v2', state: 'out-of-scope', reason: 'web first', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Gift cards', now: FIXED_NOW });
  setRequirementMilestone(bundleDirectory, 'R004', 'v2', { now: FIXED_NOW });
  setRequirementState(bundleDirectory, 'R001', 'validated', { plan: 'checkout', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Ship orders worldwide', milestone: 'v1', supersedes: 'R002', now: FIXED_NOW });
  const requirementsReview = buildRequirementsReview(bundleDirectory);
  assert.equal(requirementsReview.lastReviewed, '');
  assert.deepEqual(requirementsReview.milestones.map((milestoneReview) => milestoneReview.name), ['v1', 'v2']);
  const [firstMilestone, secondMilestone] = requirementsReview.milestones;
  assert.deepEqual(firstMilestone.validated.map((requirement) => requirement.id), ['R001']);
  assert.deepEqual(firstMilestone.active.map((requirement) => requirement.id), ['R005']);
  assert.deepEqual(firstMilestone.superseded.map((requirement) => requirement.id), ['R002']);
  assert.deepEqual(firstMilestone.withoutCheckCommand.map((requirement) => requirement.id), ['R005']);
  assert.deepEqual(secondMilestone.outOfScope.map((requirement) => [requirement.id, requirement.reason]), [['R003', 'web first']]);
  assert.deepEqual(secondMilestone.active.map((requirement) => requirement.id), ['R004']);
  assert.deepEqual(buildRequirementsReview(bundleDirectory, { milestone: 'v2' }).milestones.map((milestoneReview) => milestoneReview.name), ['v2']);
  const runCli = (...cliArguments) => execFileSync(process.execPath, [AI1_CLI, 'okf', 'project', ...cliArguments], { cwd: projectRoot, encoding: 'utf8' }).trim();
  const reviewText = runCli('review');
  assert.match(reviewText, /^Requirements review \(last: never\)\nv1: 1 validated, 1 active, 0 out of scope, 1 superseded\n  still to build:\n    R005 Ship orders worldwide/);
  assert.match(reviewText, /out of scope \(does the reason still hold\?\):\n    R003 Native mobile app - web first/);
  assert.match(reviewText, /superseded:\n    R002 Ship orders -> R005/);
  assert.equal(runCli('review', '--done'), 'review recorded on product.md (requirements_reviewed)');
  assert.equal(buildRequirementsReview(bundleDirectory).lastReviewed, new Date().toISOString().slice(0, 10));
  assert.equal(runCli('req', 'milestone', 'R004', 'v3'), 'R004: milestone v2 -> v3');
  assert.match(readFileSync(join(bundleDirectory, findRequirement(listRequirements(bundleDirectory), 'R004').relativePath), 'utf8'), /- \d{4}-\d{2}-\d{2} milestone: v2 -> v3/);
});
