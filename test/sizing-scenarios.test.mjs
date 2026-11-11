import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScenarioCoverage, findScenarioTags, listRepoFiles, readPlanScenarios } from '../src/sizing/sizing-scenarios.mjs';
import { createTemporaryProject } from './helpers.mjs';

const PLAN_WITH_SCENARIOS = `---
title: Login lock
status: approved
---

# Goal
Lock accounts.

## Behavior
- S1: Given 3 failed logins, when the 4th fails, then the account locks for 15 minutes.
- S2: Given a locked account, when 15 minutes pass, then login works again.
Some note that is not a scenario.

# Steps
- S9: not a scenario, outside the section
`;

function createGitRepo(repoFiles) {
  const repoRoot = createTemporaryProject();
  for (const [relativePath, fileText] of Object.entries(repoFiles)) {
    mkdirSync(join(repoRoot, relativePath, '..'), { recursive: true });
    writeFileSync(join(repoRoot, relativePath), fileText);
  }
  execFileSync('git', ['-C', repoRoot, 'init', '-q']);
  return repoRoot;
}

test('readPlanScenarios: ids of the Behaviour section only, either spelling, # or ##', () => {
  assert.deepEqual(readPlanScenarios(PLAN_WITH_SCENARIOS), { hasBehaviourSection: true, scenarioIds: ['S1', 'S2'], duplicateIds: [] });
});

test('readPlanScenarios: None, no section, duplicates and headings inside code fences', () => {
  assert.deepEqual(readPlanScenarios('# Behaviour\nNone - internal refactor\n'), { hasBehaviourSection: true, scenarioIds: [], duplicateIds: [] });
  assert.deepEqual(readPlanScenarios('# Goal\nx\n'), { hasBehaviourSection: false, scenarioIds: [], duplicateIds: [] });
  assert.deepEqual(readPlanScenarios('# Behaviour\n- S1: a\n- S3: b\n- S1: c\n').duplicateIds, ['S1']);
  const quotedTemplate = '# Design\n```markdown\n# Behaviour\n- S1: Given x\n```\n';
  assert.deepEqual(readPlanScenarios(quotedTemplate), { hasBehaviourSection: false, scenarioIds: [], duplicateIds: [] });
});

test('findScenarioTags: first location per tag, untracked files count, docs, .ai1 and binaries do not', () => {
  const repoRoot = createGitRepo({
    'test/login.test.js': "test('x', () => {});\ntest('locks after 4 failures [login-lock:S1]', () => {});\n",
    'test/other.test.js': '// [login-lock:S1] again\n',
    'README.md': 'example tag [login-lock:S2]\n',
    '.ai1/work/login-lock/notes.txt': '[login-lock:S2]\n',
    'fixtures/blob.bin': Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('[login-lock:S2]')]),
    'node_modules/dependency/index.js': '[login-lock:S2]\n',
    '.gitignore': 'node_modules/\n',
  });
  const scenarioLocations = findScenarioTags(repoRoot, 'login-lock', ['S1', 'S2']);
  assert.equal(scenarioLocations.get('S1'), 'test/login.test.js:2');
  assert.equal(scenarioLocations.has('S2'), false);
});

test('findScenarioTags: the tag is exact - another slug or a lowercase id does not match', () => {
  const repoRoot = createGitRepo({ 'a.test.js': '[login:S1] [login-lock:s1] [login-lock: S1]\n' });
  assert.equal(findScenarioTags(repoRoot, 'login-lock', ['S1']).size, 0);
});

test('checkScenarioCoverage: covered locations and missing ids', () => {
  const repoRoot = createGitRepo({ 'test/login.test.js': '// [login-lock:S2]\n' });
  const scenarioCoverage = checkScenarioCoverage(repoRoot, 'login-lock', PLAN_WITH_SCENARIOS);
  assert.deepEqual(scenarioCoverage.missingIds, ['S1']);
  assert.equal(scenarioCoverage.coveredLocations.get('S2'), 'test/login.test.js:1');
});

test('listRepoFiles: outside a git repository it throws (plan-done fails closed)', () => {
  assert.throws(() => listRepoFiles(createTemporaryProject()));
});
