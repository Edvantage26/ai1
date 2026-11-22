// The developer's technical vision (decisions tagged technical-vision), who said what (--from), the
// technical-vision gap category and plans that name what the vision says to avoid.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryProject } from './helpers.mjs';
import {
  addRequirement, setRequirementState, findRequirement, listRequirements, buildGapMap, initProjectContext,
  addTechnicalDecision, setTechnicalDecisionState, listTechnicalDecisions, findAvoidedTermsInPlan,
} from '../src/okf/okf-project.mjs';
import { validateOkfBundle } from '../src/okf/okf-validate.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
const FIXED_NOW = new Date('2026-11-20T10:00:00Z');

function createBundle() {
  const projectRoot = createTemporaryProject({ features: { okf: true } });
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  mkdirSync(bundleDirectory, { recursive: true });
  writeFileSync(join(bundleDirectory, 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Bundle\n');
  return { projectRoot, bundleDirectory };
}

test('technical decisions: proposed with why, alternatives and what to avoid, from the developer; accepted or replaced keep their history; listed in the requirements index; the bundle stays conformant', () => {
  const { bundleDirectory } = createBundle();
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  const created = addTechnicalDecision(bundleDirectory, {
    title: 'Payments with Stripe Checkout', decision: 'Card payments go through Stripe Checkout with a webhook.',
    why: 'Hosted page, no card data on our side.', alternatives: 'Redsys; PayPal', avoid: 'PayPal; card data on our servers',
    from: 'developer', quote: 'lo imagino con Stripe', now: FIXED_NOW,
  });
  assert.deepEqual(created, { slug: 'payments-with-stripe-checkout', relativePath: 'decisions/payments-with-stripe-checkout.md' });
  const decisionText = readFileSync(join(bundleDirectory, created.relativePath), 'utf8');
  assert.match(decisionText, /^type: Decision$/m);
  assert.match(decisionText, /^tags: \[decision, technical-vision, proposed\]$/m);
  assert.match(decisionText, /# Alternatives considered\n\n- Redsys\n- PayPal/);
  assert.match(decisionText, /- 2026-11-20 proposed: "lo imagino con Stripe" \(developer\)/);
  assert.deepEqual(listTechnicalDecisions(bundleDirectory).map((technicalDecision) => [technicalDecision.slug, technicalDecision.decisionState, technicalDecision.from, technicalDecision.avoid]),
    [['payments-with-stripe-checkout', 'proposed', 'developer', ['PayPal', 'card data on our servers']]]);
  addTechnicalDecision(bundleDirectory, { title: 'Payments with Redsys', from: 'client', now: FIXED_NOW });
  setTechnicalDecisionState(bundleDirectory, 'payments-with-stripe-checkout', 'replaced', { by: 'payments-with-redsys', reason: 'the bank requires it', from: 'client', now: FIXED_NOW });
  assert.match(readFileSync(join(bundleDirectory, created.relativePath), 'utf8'), /- 2026-11-20 proposed -> replaced \(by payments-with-redsys; the bank requires it\) \(client\)/);
  assert.match(readFileSync(join(bundleDirectory, 'requirements', 'index.md'), 'utf8'), /## Technical vision\n\n\* \[Payments with Redsys\]\(\.\.\/decisions\/payments-with-redsys\.md\) - proposed, from client/);
  assert.throws(() => addTechnicalDecision(bundleDirectory, { title: 'Payments with Redsys' }), /already exists/);
  assert.throws(() => setTechnicalDecisionState(bundleDirectory, 'nope', 'accepted'), /no technical decision nope/);
  const validationReport = validateOkfBundle(bundleDirectory);
  assert.deepEqual(validationReport.errors, []);
  assert.deepEqual(validationReport.warnings, []);
});

test('technical vision category: missing until a decision in force or a Product section; a replaced decision alone does not count', () => {
  const { bundleDirectory } = createBundle();
  initProjectContext(bundleDirectory, { projectTitle: 'Shop', now: FIXED_NOW });
  const statusOf = () => buildGapMap(bundleDirectory).categories.find((projectCategory) => projectCategory.id === 'technical-vision').status;
  assert.equal(statusOf(), 'missing');
  addTechnicalDecision(bundleDirectory, { title: 'Backend in FastAPI', now: FIXED_NOW });
  addTechnicalDecision(bundleDirectory, { title: 'Backend in Django', now: FIXED_NOW });
  assert.equal(statusOf(), 'clear');
  setTechnicalDecisionState(bundleDirectory, 'backend-in-fastapi', 'replaced', { by: 'backend-in-django', now: FIXED_NOW });
  setTechnicalDecisionState(bundleDirectory, 'backend-in-django', 'replaced', { by: 'backend-in-fastapi', now: FIXED_NOW });
  assert.equal(statusOf(), 'missing');
});

test('--from records who said it in requirement history', () => {
  const { bundleDirectory } = createBundle();
  addRequirement(bundleDirectory, { title: 'Integrate with their SAP', quote: 'tiene que hablar con su SAP', from: 'client', now: FIXED_NOW });
  setRequirementState(bundleDirectory, 'R001', 'validated', { plan: 'sap', from: 'developer', now: FIXED_NOW });
  const requirementText = readFileSync(join(bundleDirectory, findRequirement(listRequirements(bundleDirectory), 'R001').relativePath), 'utf8');
  assert.match(requirementText, /- 2026-11-20 active: "tiene que hablar con su SAP" \(client\)/);
  assert.match(requirementText, /- 2026-11-20 active -> validated \(plan sap\) \(developer\)/);
});

test('conflicts: a plan naming what a decision in force says to avoid is reported, as whole words; replaced decisions do not count', () => {
  const { bundleDirectory } = createBundle();
  addTechnicalDecision(bundleDirectory, { title: 'Payments with Stripe', avoid: 'PayPal; Mongo DB', now: FIXED_NOW });
  const technicalDecisions = listTechnicalDecisions(bundleDirectory);
  assert.deepEqual(findAvoidedTermsInPlan('# Goal\nAdd PayPal as a second payment method and store it in mongo db.', technicalDecisions).map((avoidedTerm) => avoidedTerm.term), ['PayPal', 'Mongo DB']);
  assert.deepEqual(findAvoidedTermsInPlan('# Goal\nAdd paypalish rounding.', technicalDecisions), []);
  addTechnicalDecision(bundleDirectory, { title: 'Payments with Redsys', now: FIXED_NOW });
  setTechnicalDecisionState(bundleDirectory, 'payments-with-stripe', 'replaced', { by: 'payments-with-redsys', now: FIXED_NOW });
  assert.deepEqual(findAvoidedTermsInPlan('# Goal\nAdd PayPal.', listTechnicalDecisions(bundleDirectory)), []);
});

test('ai1 okf project decision add/set/list and conflicts from the command line', () => {
  const { projectRoot } = createBundle();
  const runCli = (...cliArguments) => execFileSync(process.execPath, [AI1_CLI, 'okf', 'project', ...cliArguments], { cwd: projectRoot, encoding: 'utf8' }).trim();
  assert.equal(runCli('decision', 'add', '--title', 'Auth with the existing OAuth proxy', '--avoid', 'Auth0', '--from', 'developer', '--state', 'accepted'), 'auth-with-the-existing-oauth-proxy: created decisions/auth-with-the-existing-oauth-proxy.md');
  assert.equal(runCli('decision', 'list'), 'auth-with-the-existing-oauth-proxy [accepted, from developer] Auth with the existing OAuth proxy (avoid: Auth0)');
  mkdirSync(join(projectRoot, '.ai1', 'work', 'login'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'login', 'plan.md'), '# Goal\nLogin with Auth0.\n');
  assert.match(runCli('conflicts', 'login'), /names what the technical vision says to avoid[\s\S]*- Auth0: Auth with the existing OAuth proxy \(decisions\/auth-with-the-existing-oauth-proxy\.md, accepted\)/);
  assert.equal(runCli('decision', 'set', 'auth-with-the-existing-oauth-proxy', 'replaced'), 'auth-with-the-existing-oauth-proxy: accepted -> replaced');
});
