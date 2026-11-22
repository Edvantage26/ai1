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
  validatePlanRequirements, verifyRequirements, setRequirementCheckCommand,
} from '../src/okf/okf-project.mjs';
import { describeProjectContext } from '../src/okf/okf-project-brief.mjs';
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

test('gap map: operations is missing until the Operations concept has text, partial naming the empty topics, clear when all are written; its Deploy answers deploy [project-operations:S1] [project-operations:S2]', () => {
  const { bundleDirectory } = createBundle();
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  const categoryById = () => Object.fromEntries(buildGapMap(bundleDirectory).categories.map((projectCategory) => [projectCategory.id, projectCategory]));
  assert.equal(categoryById().operations.status, 'missing');
  assert.equal(categoryById().deploy.status, 'missing');
  const operationsPath = join(bundleDirectory, 'operations.md');
  const fillOperationsSection = (heading, sectionText) => writeFileSync(operationsPath, readFileSync(operationsPath, 'utf8').replace(`## ${heading}\n`, `## ${heading}\n\n${sectionText}\n`));
  fillOperationsSection('Deploy', 'Push to main; the platform builds and deploys.');
  fillOperationsSection('Logs', 'TODO');
  assert.deepEqual([categoryById().operations.status, categoryById().operations.why], ['partial', 'empty: Environments, Database, Access, Monitoring, Alerts; placeholder: Logs']);
  assert.equal(categoryById().deploy.status, 'clear');
  for (const heading of ['Environments', 'Database', 'Access', 'Monitoring', 'Alerts']) fillOperationsSection(heading, 'none');
  fillOperationsSection('Logs', '`app logs --follow`');
  writeFileSync(operationsPath, readFileSync(operationsPath, 'utf8').replace('TODO', ''));
  assert.equal(categoryById().operations.status, 'clear');
  addQuestion(bundleDirectory, { text: 'Where do alerts go?', about: 'operations', now: FIXED_NOW });
  assert.deepEqual([categoryById().operations.status, categoryById().operations.why], ['partial', 'Q01 pending']);
  assert.deepEqual(validateOkfBundle(bundleDirectory).errors ?? [], []);
});

test('operations stay generic: the interview skill asks for them with no tool, host or vendor of anyone in particular; what the project lacks becomes an open question about operations [project-operations:S4] [project-operations:S5]', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/okf-interview-project/SKILL.md', import.meta.url)), 'utf8');
  const projectSourceText = readFileSync(fileURLToPath(new URL('../src/okf/okf-project.mjs', import.meta.url)), 'utf8');
  assert.match(skillText, /`operations\.md` \(`type: Operations`\)/);
  assert.match(skillText, /open question `--about operations`/);
  for (const checkedText of [skillText, projectSourceText]) {
    assert.doesNotMatch(checkedText, /dokploy|openobserve|uptime kuma|telegram|1password|grafana|datadog|sentry|edvantage|baboon/i);
  }
});

test('init: writes Product, Operations, requirements index and questions, links them from the root index, and the bundle stays conformant [project-operations:S2]', () => {
  const { bundleDirectory } = createBundle();
  const writtenPaths = initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  assert.deepEqual(writtenPaths.sort(), ['index.md', 'operations.md', 'product.md', 'requirements/index.md', 'requirements/questions.md']);
  const rootIndexText = readFileSync(join(bundleDirectory, 'index.md'), 'utf8');
  assert.match(rootIndexText, /\]\(product\.md\)/);
  assert.match(rootIndexText, /\[Operations\]\(operations\.md\)/);
  const operationsText = readFileSync(join(bundleDirectory, 'operations.md'), 'utf8');
  assert.match(operationsText, /^type: Operations$/m);
  assert.deepEqual([...operationsText.matchAll(/^## (.+)$/gm)].map((headingMatch) => headingMatch[1]), ['Deploy', 'Environments', 'Logs', 'Database', 'Access', 'Monitoring', 'Alerts']);
  assert.match(operationsText, /never its value/);
  assert.doesNotMatch(readFileSync(join(bundleDirectory, 'product.md'), 'utf8'), /^## Operations$/m);
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
  settleQuestion(bundleDirectory, 'Q01', { status: 'assumed', text: 'containers on a VPS, like the other projects', now: FIXED_NOW });
  settleQuestion(bundleDirectory, 'q02', { status: 'answered', text: 'the client', where: 'product.md', now: FIXED_NOW });
  const questions = listQuestions(bundleDirectory);
  assert.deepEqual(questions.map((question) => [question.id, question.status, question.about]), [['Q01', 'assumed', 'deploy'], ['Q02', 'answered', 'decision-makers']]);
  assert.equal(questions[0].assumption, 'containers on a VPS, like the other projects (2026-11-21)');
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
  assert.equal(runCli('question', 'assume', 'Q01', 'containers', 'like', 'the', 'rest'), 'Q01: assumed');
  assert.equal(runCli('question', 'list'), 'Q01 [assumed, deploy] Where is it deployed?');
  const gapsText = runCli('gaps');
  assert.match(gapsText, /✓ scope \(what is out\): clear/);
  assert.match(gapsText, /✗ deploy: missing \(Q01 pending\)/);
  mkdirSync(join(projectRoot, '.ai1', 'work', 'google-auth'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'google-auth', 'plan.md'), '# Goal\nAdd a login with Google.\n');
  assert.match(runCli('conflicts', 'google-auth'), /R001 Login with Google/);
  assert.equal(JSON.parse(runCli('gaps', '--json')).started, true);
  assert.ok(readFileSync(join(bundleDirectory, 'requirements', 'questions.md'), 'utf8').includes('- assumption: containers like the rest'));
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

test('supersede: a new requirement replaces an old one, which stays with superseded_by and its history; superseded is never validated nor listed as in force', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Sell shoes online', now: FIXED_NOW });
  const replacement = addRequirement(bundleDirectory, { title: 'Marketplace where shops sell shoes', supersedes: 'R001', quote: 'ya no es una tienda, es un marketplace', now: new Date('2026-12-01T09:00:00Z') });
  assert.equal(replacement.id, 'R002');
  const oldRequirement = findRequirement(listRequirements(bundleDirectory), 'R001');
  assert.equal(oldRequirement.state, 'superseded');
  assert.equal(oldRequirement.supersededBy, 'R002');
  const oldText = readFileSync(join(bundleDirectory, oldRequirement.relativePath), 'utf8');
  assert.match(oldText, /- 2026-12-01 active -> superseded \(by R002\): "ya no es una tienda, es un marketplace"/);
  assert.match(readFileSync(join(bundleDirectory, replacement.relativePath), 'utf8'), /- 2026-12-01 active \(replaces R001\)/);
  assert.match(readFileSync(join(bundleDirectory, 'requirements', 'index.md'), 'utf8'), /## superseded\n\n\* \[R001 Sell shoes online\]\(R001-sell-shoes-online\.md\) - superseded by R002/);
  assert.throws(() => setRequirementState(bundleDirectory, 'R002', 'superseded'), /--by <id>/);
  assert.throws(() => addRequirement(bundleDirectory, { title: 'X', supersedes: 'R009' }), /no requirement R009/);
  assert.deepEqual(validatePlanRequirements(bundleDirectory, 'plan-a', ['R001'], { projectRoot }), ['R001: superseded by R002, not validated (list that one instead)']);
  assert.deepEqual(validateOkfBundle(bundleDirectory).errors, []);
});

test('check commands: verify reopens a validated requirement whose check fails, leaves passing ones; plan-done validates only when the check passes', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Pay by card', checkCommand: 'npm test -- payments', now: FIXED_NOW });
  addRequirement(bundleDirectory, { title: 'Export invoices', now: FIXED_NOW });
  setRequirementCheckCommand(bundleDirectory, 'R002', 'npm test -- invoices', { now: FIXED_NOW });
  const ranCommands = [];
  const passingRun = (checkCommand) => { ranCommands.push(checkCommand); return 0; };
  const failingPayments = (checkCommand) => (checkCommand.includes('payments') ? 3 : 0);
  assert.deepEqual(validatePlanRequirements(bundleDirectory, 'checkout', ['R001'], { projectRoot, runCommand: failingPayments }), ['R001: check `npm test -- payments` failed (exit 3), not validated']);
  assert.deepEqual(validatePlanRequirements(bundleDirectory, 'checkout', ['R001'], { projectRoot, runCommand: passingRun }), ['R001: validated by checkout']);
  assert.deepEqual(ranCommands, ['npm test -- payments']);
  const checkResults = verifyRequirements(bundleDirectory, projectRoot, { runCommand: failingPayments, now: new Date('2026-12-02T09:00:00Z') });
  assert.deepEqual(checkResults.map((checkResult) => [checkResult.id, checkResult.passed, checkResult.reopened]), [['R001', false, true], ['R002', true, false]]);
  const reopenedRequirement = findRequirement(listRequirements(bundleDirectory), 'R001');
  assert.equal(reopenedRequirement.state, 'active');
  assert.match(readFileSync(join(bundleDirectory, reopenedRequirement.relativePath), 'utf8'), /- 2026-12-02 validated -> active \(check failed: `npm test -- payments` exit 3\)/);
  assert.equal(findRequirement(listRequirements(bundleDirectory), 'R002').state, 'active', 'a passing check never validates by itself');
  assert.deepEqual(verifyRequirements(bundleDirectory, projectRoot, { requirementId: 'R002', runCommand: passingRun }).map((checkResult) => checkResult.id), ['R002']);
  assert.deepEqual(validateOkfBundle(bundleDirectory).errors, []);
});

test('ai1 okf project from the command line: req add --supersedes and --check-command, req command, verify with real commands and its exit code', () => {
  const { projectRoot, bundleDirectory } = createBundle();
  const runCli = (...cliArguments) => execFileSync(process.execPath, [AI1_CLI, 'okf', 'project', ...cliArguments], { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  runCli('req', 'add', '--title', 'Sell shoes online');
  assert.equal(runCli('req', 'add', '--title', 'Marketplace for shoe shops', '--supersedes', 'R001', '--check-command', 'node -e "process.exit(0)"'), 'R002: created requirements/R002-marketplace-for-shoe-shops.md; R001 superseded by R002');
  assert.equal(runCli('verify'), 'R002 passes: node -e "process.exit(0)"');
  setRequirementState(bundleDirectory, 'R002', 'validated', { plan: 'marketplace' });
  assert.equal(runCli('req', 'command', 'R002', 'node -e "process.exit(4)"'), 'R002: check command set');
  let failureOutput = '';
  try {
    runCli('verify', 'R002');
  } catch (commandFailure) {
    failureOutput = String(commandFailure.stdout);
    assert.equal(commandFailure.status, 1);
  }
  assert.match(failureOutput, /R002 FAILS \(exit 4\): node -e "process\.exit\(4\)" - was validated, back to active/);
  assert.equal(findRequirement(listRequirements(bundleDirectory), 'R002').state, 'active');
});

test('the requirement rules: what and why vs how, changed only from the person\'s words, in the skill and at session start', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/okf-interview-project/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skillText, /\*\*What is a requirement\.\*\* It says what the project must achieve and why/);
  assert.match(skillText, /Requirements change only\s+from the person's words, never from what the code does/);
  assert.match(skillText, /--supersedes <id>/);
  assert.match(skillText, /ai1 okf project verify/);
  const { bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Pay by card', now: FIXED_NOW });
  const contextText = describeProjectContext(buildGapMap(bundleDirectory)).filter((contextPart) => typeof contextPart === 'string').join('\n');
  assert.match(contextText, /Requirements say what the project must achieve and why .*; how it is built goes in the other concepts/);
  assert.match(contextText, /never from what the code does: when a message contradicts one .* confirm in one line/);
  assert.match(contextText, /`req add --supersedes <id>`/);
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

test('/ai1:okf-interview-project reads the project documents outside the repo before asking: from its customization, links and related repos; cites them; asks once for more and offers to save a new folder (issue #11)', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/okf-interview-project/SKILL.md', import.meta.url)), 'utf8');
  const inferStep = skillText.slice(skillText.indexOf('## 2. Infer before asking'), skillText.indexOf('## 3. Ask'));
  assert.match(inferStep, /the project's documents \*\*outside the repo\*\*/);
  assert.match(inferStep, /the folders the customization below names/);
  assert.match(inferStep, /links in\s+the README, CLAUDE\.md or the bundle to documents outside the repo/);
  assert.match(inferStep, /--from\s+"<document name>"/);
  assert.match(inferStep, /tell the person which documents you read and ask once whether there\s+are more to read first/);
  assert.match(inferStep, /offer once to save it with \/ai1:core-customize-skill/);
  assert.match(inferStep, /Never ask what\s+the repo or those documents answer/);
  assert.doesNotMatch(skillText, /~\/[A-Za-z]/, 'no personal paths in the public plugin');
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
  settleQuestion(bundleDirectory, 'Q01', { status: 'assumed', text: 'containers', now: FIXED_NOW });
  const startedText = readSessionStart();
  assert.match(startedText, /Project doubts: when a decision depends on something neither the code nor the bundle answers/);
  assert.match(startedText, /Project context \(`\.ai1\/okf\/product\.md`, `\.ai1\/okf\/requirements\/`\): missing users, constraints, stack and structure, technical vision, run and test, deploy, operations, integrations and data, decision makers\./);
  assert.match(startedText, /\/ai1:okf-interview-project \(never in the middle of a task\)/);
  assert.match(startedText, /record it with their words via `ai1 okf project req add\|set`/);
  assert.match(startedText, /- R001 Login with Google\n- R002 Native mobile app\n- \.\.\. and 1 more: `ai1 okf project req list --state out-of-scope`/);
  assert.match(startedText, /- Q01 Where is it deployed\? \(assumed: containers\)/);
  assert.match(startedText, /Active must requirements:\n- R004 Pay by card/);
  assert.doesNotMatch(startedText, /dark mode/);
  assert.doesNotMatch(readSessionStart('resume'), /Project doubts/);
});
