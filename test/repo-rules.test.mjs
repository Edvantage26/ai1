import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { findRepoRuleMatches } from '../src/guards/repo-rules.mjs';
import { listRepoRuleProblems, splitRepoRules } from '../src/core/repo-rules-config.mjs';
import { loadHarnessConfig } from '../src/core/config.mjs';
import { KNOWN_MODULE_IDS } from '../src/core/module-index.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const REPO_RULES = [
  { id: 'use-pnpm', on: 'bash', pattern: '^npm (install|i|ci)\\b', action: 'deny', message: 'this repo uses pnpm: run pnpm install.' },
  { id: 'no-migrate', on: 'bash', pattern: 'scripts/migrate', action: 'ask', message: 'migrations touch shared data.' },
  { id: 'generated-code', on: 'edit', paths: ['src/generated/**'], action: 'deny', message: 'generated: change the schema and run codegen.' },
  { id: 'no-console', on: 'edit', paths: ['src/**/*.ts'], pattern: 'console\\.log', action: 'ask', message: 'use the logger.' },
];
const projectRoot = '/repo';
const matchedIds = (hookInput) => findRepoRuleMatches(hookInput, projectRoot, REPO_RULES).map((repoRule) => repoRule.id);

test('repo-rules: bash rules match each simple command', () => {
  assert.deepEqual(matchedIds({ tool_name: 'Bash', tool_input: { command: 'cd app && npm install' } }), ['use-pnpm']);
  assert.deepEqual(matchedIds({ tool_name: 'Bash', tool_input: { command: 'bash -c "node scripts/migrate.js"' } }), ['no-migrate']);
  assert.deepEqual(matchedIds({ tool_name: 'Bash', tool_input: { command: 'pnpm install && npm test' } }), []);
});

test('repo-rules: edit rules match by paths and by the new text', () => {
  assert.deepEqual(matchedIds({ tool_name: 'Write', tool_input: { file_path: join(projectRoot, 'src/generated/api.ts'), content: 'x' } }), ['generated-code']);
  assert.deepEqual(matchedIds({ tool_name: 'Edit', tool_input: { file_path: join(projectRoot, 'src/app.ts'), old_string: 'a', new_string: 'console.log(a)' } }), ['no-console']);
  assert.deepEqual(matchedIds({ tool_name: 'Edit', tool_input: { file_path: join(projectRoot, 'src/app.ts'), old_string: 'console.log(a)', new_string: 'logger.info(a)' } }), []);
  assert.deepEqual(matchedIds({ tool_name: 'MultiEdit', tool_input: { file_path: join(projectRoot, 'src/app.ts'), edits: [{ old_string: 'a', new_string: 'console.log(1)' }] } }), ['no-console']);
  assert.deepEqual(matchedIds({ tool_name: 'Edit', tool_input: { file_path: join(projectRoot, 'docs/app.md'), old_string: 'a', new_string: 'console.log(a)' } }), []);
});

test('repo-rules: a bad rule is dropped with a notice, the rest keep working', () => {
  const { validRules, notices } = splitRepoRules([
    REPO_RULES[0],
    { id: 'Bad Id', on: 'bash', pattern: 'x', action: 'ask', message: 'm' },
    { id: 'broken-regex', on: 'bash', pattern: '(', action: 'ask', message: 'm' },
    { id: 'edit-without-target', on: 'edit', action: 'ask', message: 'm' },
    { id: 'use-pnpm', on: 'bash', pattern: 'y', action: 'ask', message: 'm' },
  ]);
  assert.deepEqual(validRules.map((repoRule) => repoRule.id), ['use-pnpm']);
  assert.equal(notices.length, 4);
  assert.match(notices[1], /rules\[2\] \(broken-regex\) is ignored: "pattern" is not a valid regular expression/);
  assert.match(notices[3], /is repeated/);
  assert.deepEqual(listRepoRuleProblems({ id: 'x', on: 'bash', paths: ['a'], action: 'warn', message: '', extra: 1 }), [
    'unknown field "extra"', '"action" must be ask or deny', '"message" must say why and what to do instead', '"paths" only applies to edit rules', 'a bash rule needs "pattern"',
  ]);
});

test('repo-rules: config loading keeps valid rules and turns bad ones into notices; a non-list is invalid', () => {
  const loadedConfig = loadHarnessConfig(createTemporaryProject({ rules: [REPO_RULES[0], { id: 'x' }] }), KNOWN_MODULE_IDS);
  assert.equal(loadedConfig.status, 'ok');
  assert.deepEqual(loadedConfig.config.rules.map((repoRule) => repoRule.id), ['use-pnpm']);
  assert.match(loadedConfig.notices[0], /rules\[1\] \(x\) is ignored/);
  assert.deepEqual(loadedConfig.unknownEntries, []);
  assert.equal(loadHarnessConfig(createTemporaryProject({ rules: {} }), KNOWN_MODULE_IDS).status, 'invalid');
  assert.deepEqual(loadHarnessConfig(createTemporaryProject({}), KNOWN_MODULE_IDS).config.rules, []);
});

test('repo-rules runs through the dispatcher: deny wins and names the rule', () => {
  const repoRoot = createTemporaryProject({ version: 1, rules: REPO_RULES });
  const denyOutput = runHookEvent('PreToolUse', bashPayload(repoRoot, 'npm install && node scripts/migrate.js'));
  assert.equal(denyOutput.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(denyOutput.hookSpecificOutput.permissionDecisionReason, /ai1\/repo-rules: \[use-pnpm\] this repo uses pnpm.*\[no-migrate\]/);
  const askOutput = runHookEvent('PreToolUse', bashPayload(repoRoot, 'node scripts/migrate.js'));
  assert.equal(askOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(runHookEvent('PreToolUse', bashPayload(repoRoot, 'pnpm install')), null);
});
