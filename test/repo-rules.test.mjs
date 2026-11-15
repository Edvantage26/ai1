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

test('flags: "i" makes pattern case-insensitive; other flags are refused [okf-skill-findings:S8]', () => {
  const caseInsensitiveRule = { id: 'no-group-by', on: 'bash', pattern: 'from\\s+prices\\b[\\s\\S]*group\\s+by', flags: 'i', action: 'ask', message: 'Use the summary table.' };
  assert.deepEqual(listRepoRuleProblems(caseInsensitiveRule), []);
  const bashCall = (commandLine) => ({ tool_name: 'Bash', tool_input: { command: commandLine } });
  assert.equal(findRepoRuleMatches(bashCall('psql -c "SELECT x FROM PRICES GROUP BY x"'), '/repo', [caseInsensitiveRule]).length, 1);
  assert.equal(findRepoRuleMatches(bashCall('psql -c "SELECT x FROM PRICES GROUP BY x"'), '/repo', [{ ...caseInsensitiveRule, flags: undefined }]).length, 0, 'without flags the case matters');
  assert.match(listRepoRuleProblems({ ...caseInsensitiveRule, flags: 'g' }).join(), /"flags" may only hold i, m, s or u/);
});

test('mcp rules: tool against the MCP tool name, pattern against its JSON input; only for mcp rules [okf-skill-findings:S8]', () => {
  const mcpRule = { id: 'no-scan-via-mcp', on: 'mcp', tool: '^mcp__postgres__', pattern: 'from\\s+prices\\b[\\s\\S]*group\\s+by', flags: 'i', action: 'ask', message: 'Use the summary table.' };
  assert.deepEqual(listRepoRuleProblems(mcpRule), []);
  const mcpCall = (toolName, sqlText) => ({ tool_name: toolName, tool_input: { sql: sqlText } });
  assert.equal(findRepoRuleMatches(mcpCall('mcp__postgres__query', 'select x from prices group by x'), '/repo', [mcpRule]).length, 1);
  assert.equal(findRepoRuleMatches(mcpCall('mcp__redis__get', 'select x from prices group by x'), '/repo', [mcpRule]).length, 0, 'another MCP server');
  assert.equal(findRepoRuleMatches(mcpCall('mcp__postgres__query', 'select x from prices limit 5'), '/repo', [mcpRule]).length, 0);
  assert.equal(findRepoRuleMatches({ tool_name: 'Bash', tool_input: { command: 'select x from prices group by x' } }, '/repo', [mcpRule]).length, 0, 'an mcp rule never applies to Bash');
  assert.match(listRepoRuleProblems({ id: 'x', on: 'mcp', action: 'ask', message: 'm' }).join(), /an mcp rule needs "tool", "pattern" or both/);
  assert.match(listRepoRuleProblems({ id: 'x', on: 'bash', tool: 'a', pattern: 'b', action: 'ask', message: 'm' }).join(), /"tool" only applies to mcp rules/);
  assert.match(listRepoRuleProblems({ id: 'x', on: 'mcp', tool: 'a', paths: ['x'], action: 'ask', message: 'm' }).join(), /"paths" only applies to edit rules/);
});

test('an MCP tool call loads only repo-rules, which asks for a matching mcp rule (also in bypass mode) [okf-skill-findings:S8]', async () => {
  const { loadModulesForEvent } = await import('../src/core/module-index.mjs');
  const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  assert.deepEqual((await loadModulesForEvent('PreToolUse', 'mcp__postgres__query')).map((loadedModule) => loadedModule.id), ['repo-rules']);
  const projectRoot = mkdtempSync(join(tmpdir(), 'ai1-mcp-rule-'));
  mkdirSync(join(projectRoot, '.ai1'));
  writeFileSync(join(projectRoot, '.ai1', 'config.json'), JSON.stringify({ rules: [{ id: 'no-scan-via-mcp', on: 'mcp', tool: '^mcp__postgres__', pattern: 'group\\s+by', flags: 'i', action: 'ask', message: 'Use the summary table.' }] }));
  const hookOutput = runHookEvent('PreToolUse', { session_id: 's', cwd: projectRoot, tool_name: 'mcp__postgres__query', tool_input: { sql: 'SELECT x FROM prices GROUP BY x' }, permission_mode: 'bypassPermissions' }, { environment: { AI1_DECISION_LOG: '0' }, reportInternalError: () => {} });
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(hookOutput.hookSpecificOutput.permissionDecisionReason, /no-scan-via-mcp/);
});
