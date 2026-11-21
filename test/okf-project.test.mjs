import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject } from './helpers.mjs';
import {
  buildGapMap, initProjectContext, addRequirement, setRequirementState, listRequirements, addQuestion,
  settleQuestion, listQuestions, findOutOfScopeConflicts, buildGoalLine, findRequirement,
} from '../src/okf/okf-project.mjs';
import { validateOkfBundle } from '../src/okf/okf-validate.mjs';
import { closePlan } from '../src/cli/verify-run.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
const FIXED_NOW = new Date('2026-11-21T10:00:00Z');

function createBundle() {
  const projectRoot = createTemporaryProject({ features: { okf: true } });
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  mkdirSync(bundleDirectory, { recursive: true });
  writeFileSync(join(bundleDirectory, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Bundle\n');
  return { projectRoot, bundleDirectory };
}

function fillProductSection(bundleDirectory, heading, sectionText) {
  const productPath = join(bundleDirectory, 'product.md');
  const productText = readFileSync(productPath, 'utf8');
  writeFileSync(productPath, productText.replace(`## ${heading}\n`, `## ${heading}\n\n${sectionText}\n`));
}

test('gap map: a bundle without project context is not started and every category is missing [project-requirements:S2]', () => {
  const { bundleDirectory } = createBundle();
  const gapMap = buildGapMap(bundleDirectory);
  assert.equal(gapMap.started, false);
  assert.ok(gapMap.categories.every((projectCategory) => projectCategory.status === 'missing'));
});

test('gap map: clear, partial and missing from the Product sections, out-of-scope requirements, verify commands and open questions [project-requirements:S2]', () => {
  const { bundleDirectory } = createBundle();
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  fillProductSection(bundleDirectory, 'Purpose', 'Sell shoes online.');
  fillProductSection(bundleDirectory, 'Deploy', 'TBD');
  fillProductSection(bundleDirectory, 'Users', 'Shop owners.');
  addRequirement(bundleDirectory, { title: 'Login with Google', state: 'out-of-scope', reason: 'email only for now', now: FIXED_NOW });
  addQuestion(bundleDirectory, { text: 'Who are the second kind of users?', about: 'users', now: FIXED_NOW });
  const gapMap = buildGapMap(bundleDirectory, { verifyCommands: ['npm test'] });
  const statusById = Object.fromEntries(gapMap.categories.map((projectCategory) => [projectCategory.id, projectCategory.status]));
  assert.equal(gapMap.started, true);
  assert.equal(statusById.purpose, 'clear');
  assert.equal(statusById.deploy, 'partial');
  assert.equal(statusById.users, 'partial');
  assert.equal(statusById.scope, 'clear');
  assert.equal(statusById['run-test'], 'clear');
  assert.equal(statusById.stack, 'missing');
});

test('init: writes Product, requirements index and questions, links them from the root index, and the bundle stays conformant', () => {
  const { bundleDirectory } = createBundle();
  const writtenPaths = initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  assert.deepEqual(writtenPaths.sort(), ['index.md', 'product.md', 'requirements/index.md', 'requirements/questions.md']);
  const rootIndexText = readFileSync(join(bundleDirectory, 'index.md'), 'utf8');
  assert.match(rootIndexText, /\]\(product\.md\)/);
  assert.match(rootIndexText, /\]\(requirements\/index\.md\)/);
  assert.deepEqual(initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW }), ['requirements/index.md']);
  addRequirement(bundleDirectory, { title: 'Pay by card', check: 'a test payment succeeds in the sandbox', now: FIXED_NOW });
  addQuestion(bundleDirectory, { text: 'Where is it deployed?', about: 'deploy', now: FIXED_NOW });
  const validationReport = validateOkfBundle(bundleDirectory);
  assert.deepEqual(validationReport.errors, []);
  assert.deepEqual(validationReport.warnings, []);
});

test('an existing Product concept elsewhere is reused, not duplicated', () => {
  const { bundleDirectory } = createBundle();
  mkdirSync(join(bundleDirectory, 'design'), { recursive: true });
  writeFileSync(join(bundleDirectory, 'design', 'product.md'), '---\ntype: Product\ntitle: Shop\n---\n\n## Users\n\n### Owner\nRuns a shop.\n');
  const writtenPaths = initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  assert.ok(!writtenPaths.includes('product.md'));
  const gapMap = buildGapMap(bundleDirectory);
  assert.equal(gapMap.product, 'design/product.md');
  assert.equal(gapMap.categories.find((projectCategory) => projectCategory.id === 'users').status, 'clear');
});

test('requirements: numbered from R001, state changes keep the history with the quote and date [project-requirements:S3]', () => {
  const { bundleDirectory } = createBundle();
  const firstRequirement = addRequirement(bundleDirectory, { title: 'Login with Google', quote: 'quiero login con Google', now: FIXED_NOW });
  const secondRequirement = addRequirement(bundleDirectory, { title: 'Pay by card', priority: 'should', now: FIXED_NOW });
  assert.equal(firstRequirement.id, 'R001');
  assert.equal(firstRequirement.relativePath, 'requirements/R001-login-with-google.md');
  assert.equal(secondRequirement.id, 'R002');
  setRequirementState(bundleDirectory, 'R1', 'out-of-scope', {
    quote: 'al final el cliente no quiere login con Google', reason: 'client dropped it', now: new Date('2026-11-25T09:00:00Z'),
  });
  const requirementText = readFileSync(join(bundleDirectory, firstRequirement.relativePath), 'utf8');
  assert.match(requirementText, /^state: out-of-scope$/m);
  assert.match(requirementText, /- 2026-11-21 active: "quiero login con Google"/);
  assert.match(requirementText, /- 2026-11-25 active -> out-of-scope \(client dropped it\): "al final el cliente no quiere login con Google"/);
  const indexText = readFileSync(join(bundleDirectory, 'requirements', 'index.md'), 'utf8');
  assert.match(indexText, /## out-of-scope\n\n\* \[R001 Login with Google\]/);
  assert.throws(() => setRequirementState(bundleDirectory, 'R002', 'out-of-scope'), /--reason/);
  assert.throws(() => setRequirementState(bundleDirectory, 'R009', 'validated'), /no requirement R009/);
});

test('requirements: validated by a plan appends the plan, and the goal line carries the check [project-requirements:S4]', () => {
  const { bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Pay by card', check: 'a sandbox payment is confirmed by the webhook', now: FIXED_NOW });
  setRequirementState(bundleDirectory, 'R001', 'validated', { plan: 'checkout', now: FIXED_NOW });
  setRequirementState(bundleDirectory, 'R001', 'validated', { plan: 'refunds', now: FIXED_NOW });
  const requirement = findRequirement(listRequirements(bundleDirectory), 'R001');
  assert.equal(requirement.state, 'validated');
  assert.deepEqual(requirement.validatedBy, ['checkout', 'refunds']);
  assert.equal(buildGoalLine(requirement), '/goal R001 Pay by card; done when a sandbox payment is confirmed by the webhook');
});

test('questions: open, assumed and answered, each with its date and where the answer went [project-requirements:S5]', () => {
  const { bundleDirectory } = createBundle();
  addQuestion(bundleDirectory, { text: 'Where is it deployed?', about: 'deploy', now: FIXED_NOW });
  addQuestion(bundleDirectory, { text: 'Who approves releases?', about: 'decision-makers', now: FIXED_NOW });
  settleQuestion(bundleDirectory, 'Q01', { status: 'assumed', text: 'Dokploy like the other projects', now: FIXED_NOW });
  settleQuestion(bundleDirectory, 'q02', { status: 'answered', text: 'the client', where: 'product.md', now: FIXED_NOW });
  const questions = listQuestions(bundleDirectory);
  assert.deepEqual(questions.map((question) => [question.id, question.status, question.about]), [['Q01', 'assumed', 'deploy'], ['Q02', 'answered', 'decision-makers']]);
  assert.equal(questions[0].assumption, 'Dokploy like the other projects (2026-11-21)');
  assert.equal(questions[1].answer, 'the client (2026-11-21, in product.md)');
  assert.throws(() => addQuestion(bundleDirectory, { text: 'x?', about: 'nonsense' }), /--about/);
});

test('conflicts: a plan naming an out-of-scope requirement is reported; unrelated plans are not [project-requirements:S4]', () => {
  const { bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Login with Google', state: 'out-of-scope', reason: 'email only', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Pay by card', now: FIXED_NOW });
  const requirements = listRequirements(bundleDirectory);
  assert.deepEqual(findOutOfScopeConflicts('# Goal\nAdd a Google login button to the sign-in page.', requirements).map((requirement) => requirement.id), ['R001']);
  assert.deepEqual(findOutOfScopeConflicts('# Goal\nFix the card payment rounding.', requirements), []);
});

test('ai1 okf project: init, req add/set/list/goal, question add/assume/list, gaps and conflicts from the command line [project-requirements:S3] [project-requirements:S5]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  const runCli = (...cliArguments) => execFileSync(process.execPath, [AI1_CLI, 'okf', 'project', ...cliArguments], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assert.match(runCli('init', '--title', 'Shop'), /wrote product\.md/);
  assert.equal(runCli('req', 'add', '--title', 'Login with Google', '--quote', 'quiero login con Google'), 'R001: created requirements/R001-login-with-google.md');
  assert.equal(runCli('req', 'set', 'R001', 'out-of-scope', '--reason', 'client dropped it', '--quote', 'ya no lo quiere'), 'R001: active -> out-of-scope');
  assert.equal(runCli('req', 'list'), 'R001 [out-of-scope, must] Login with Google');
  assert.equal(runCli('req', 'goal', 'R001'), '/goal R001 Login with Google');
  assert.equal(runCli('question', 'add', '--about', 'deploy', 'Where is it deployed?'), 'Q01: open');
  assert.equal(runCli('question', 'assume', 'Q01', 'Dokploy', 'like', 'the', 'rest'), 'Q01: assumed');
  assert.equal(runCli('question', 'list'), 'Q01 [assumed, deploy] Where is it deployed?');
  const gapsText = runCli('gaps');
  assert.match(gapsText, /✓ scope \(what is out\): clear/);
  assert.match(gapsText, /✗ deploy: missing \(Q01 pending\)/);
  mkdirSync(join(projectRoot, '.ai1', 'work', 'google-auth'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'google-auth', 'plan.md'), '# Goal\nAdd a login with Google.\n');
  assert.match(runCli('conflicts', 'google-auth'), /R001 Login with Google/);
  assert.equal(JSON.parse(runCli('gaps', '--json')).started, true);
  assert.ok(readFileSync(join(bundleDirectory, 'requirements', 'questions.md'), 'utf8').includes('- assumption: Dokploy like the rest'));
  assert.throws(() => runCli('req', 'set', 'R001', 'out-of-scope'), /--reason/);
});

test('plan-done validates the requirements its plan lists, and only reports missing or out-of-scope ones [project-requirements:S4]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Pay by card', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Login with Google', state: 'out-of-scope', reason: 'email only', now: FIXED_NOW });
  const planDirectory = join(projectRoot, '.ai1', 'work', 'checkout');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Checkout\nstatus: approved\nrequirements: [R001, R002, R009]\n---\n\n# Goal\nPay.\n\n# Behaviour\nNone - internal.\n');
  const closeResult = closePlan(projectRoot, projectRoot, 'checkout', ['npm test'], { runCommand: () => 0, repoFiles: [] });
  assert.equal(closeResult.closed, true);
  assert.match(closeResult.message, /requirements: R001: validated by checkout; R002: out of scope, not validated .*; R009: no such requirement/);
  const requirements = listRequirements(bundleDirectory);
  assert.equal(findRequirement(requirements, 'R001').state, 'validated');
  assert.deepEqual(findRequirement(requirements, 'R001').validatedBy, ['checkout']);
  assert.equal(findRequirement(requirements, 'R002').state, 'out-of-scope');
});

test('/ai1:okf-interview-project infers and shows a draft first, asks one question at a time with a recommended answer, at most 5, and writes through ai1 okf project [project-requirements:S1]', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/okf-interview-project/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skillText, /^allowed-tools: Bash\("\$\{CLAUDE_PLUGIN_DATA\}\/bin\/ai1" skill-context \*\) Bash\("\$\{CLAUDE_PLUGIN_DATA\}\/bin\/ai1" okf project \*\)$/m);
  assert.match(skillText, /"inicializa el proyecto"/);
  assert.match(skillText, /## 2\. Infer before asking[\s\S]*as a \*\*draft\*\*, then show the person/);
  assert.match(skillText, /Kickoff starts open: "¿Qué es este proyecto y para quién\?"/);
  assert.match(skillText, /At most 5 questions per sitting/);
  assert.match(skillText, /Every question carries your recommended answer/);
  assert.match(skillText, /--quote "<the person's words>"/);
  assert.match(skillText, /ai1 okf project question add --about <category>/);
  assert.match(skillText, /changed only through `ai1 okf project`, never by hand/);
});

test('okf-project at session start: nothing before the project context starts; then the doubt rule, gaps, out of scope, open questions and must requirements once started, capped; silent on resume [project-requirements:S2] [project-requirements:S5]', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  const hookOptions = {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  const readSessionStart = (source = 'startup') => runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, hookOptions).hookSpecificOutput?.additionalContext || '';
  const notStartedText = readSessionStart();
  assert.doesNotMatch(notStartedText, /Project doubts|Project context \(/);
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  fillProductSection(bundleDirectory, 'Purpose', 'Sell shoes online.');
  for (const outTitle of ['Login with Google', 'Native mobile app', 'Marketplace for other shops']) {
    addRequirement(bundleDirectory, { title: outTitle, state: 'out-of-scope', reason: 'not for v1', now: FIXED_NOW });
  }
  addRequirement(bundleDirectory, { title: 'Pay by card', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Nice to have dark mode', priority: 'should', now: FIXED_NOW });
  addQuestion(bundleDirectory, { text: 'Where is it deployed?', about: 'deploy', now: FIXED_NOW });
  settleQuestion(bundleDirectory, 'Q01', { status: 'assumed', text: 'Dokploy', now: FIXED_NOW });
  const startedText = readSessionStart();
  assert.match(startedText, /Project doubts: when a decision depends on something neither the code nor the bundle answers/);
  assert.match(startedText, /Project context \(`\.ai1\/okf\/product\.md`, `\.ai1\/okf\/requirements\/`\): missing users, constraints, stack and structure, run and test, deploy, integrations and data, decision makers\./);
  assert.match(startedText, /\/ai1:okf-interview-project \(never in the middle of a task\)/);
  assert.match(startedText, /`ai1 okf project req add\|set` \(never by hand\)/);
  assert.match(startedText, /- R001 Login with Google\n- R002 Native mobile app\n- \.\.\. and 1 more: `ai1 okf project req list --state out-of-scope`/);
  assert.match(startedText, /- Q01 Where is it deployed\? \(assumed: Dokploy\)/);
  assert.match(startedText, /Active must requirements:\n- R004 Pay by card/);
  assert.doesNotMatch(startedText, /dark mode/);
  assert.doesNotMatch(readSessionStart('resume'), /Project doubts/);
});
