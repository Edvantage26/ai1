import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import testGuard, { findTestGuardFindings } from '../src/verify/test-guard.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-test-guard-')));
mkdirSync(join(projectRoot, 'test', 'fixtures'), { recursive: true });
mkdirSync(join(projectRoot, 'src'), { recursive: true });
const EXISTING_TEST = "import assert from 'node:assert/strict';\ntest('adds', () => {\n  assert.equal(add(1, 2), 3);\n  assert.equal(add(0, 0), 0);\n});\n";
writeFileSync(join(projectRoot, 'test', 'math.test.mjs'), EXISTING_TEST);
writeFileSync(join(projectRoot, 'test', 'fixtures', 'data.json'), '{}');
writeFileSync(join(projectRoot, 'src', 'math.mjs'), 'export const add = (a, b) => a + b;\n');

function ruleIdsFor(toolName, toolInput, moduleOptions = {}) {
  return findTestGuardFindings({ cwd: projectRoot, tool_name: toolName, tool_input: toolInput }, projectRoot, moduleOptions).map((testFinding) => testFinding.ruleId);
}

const testFile = join(projectRoot, 'test', 'math.test.mjs');

const EXPECTED_FINDINGS = [
  // Legitimate work on tests passes.
  ['new test file', 'Write', { file_path: join(projectRoot, 'test', 'more.test.mjs'), content: "test('x', () => { assert.ok(true); });" }, []],
  ['assertion added', 'Edit', { file_path: testFile, old_string: 'assert.equal(add(1, 2), 3);', new_string: 'assert.equal(add(1, 2), 3);\n  assert.equal(add(2, 2), 4);' }, []],
  ['assertion changed', 'Edit', { file_path: testFile, old_string: 'assert.equal(add(1, 2), 3);', new_string: 'assert.equal(add(1, 2), 3, "sum");' }, []],
  ['source file', 'Edit', { file_path: join(projectRoot, 'src', 'math.mjs'), old_string: 'a + b', new_string: 'b + a' }, []],
  ['skip in source is not a test', 'Edit', { file_path: join(projectRoot, 'src', 'math.mjs'), old_string: 'a + b', new_string: 'it.skip(a + b)' }, []],
  // Weakening.
  ['skip added', 'Edit', { file_path: testFile, old_string: "test('adds'", new_string: "test.skip('adds'" }, ['test-skip-added']],
  ['focus added', 'Edit', { file_path: testFile, old_string: "test('adds'", new_string: "test.only('adds'" }, ['test-skip-added']],
  ['node:test skip option', 'Edit', { file_path: testFile, old_string: "test('adds', ", new_string: "test('adds', { skip: true }, " }, ['test-skip-added']],
  ['pytest skip', 'Edit', { file_path: join(projectRoot, 'tests', 'test_math.py'), old_string: 'def test_add():', new_string: '@pytest.mark.skip\ndef test_add():' }, ['test-skip-added']],
  ['assertion removed', 'Edit', { file_path: testFile, old_string: '  assert.equal(add(0, 0), 0);\n', new_string: '' }, ['test-assertions-removed']],
  ['multi-edit summed', 'MultiEdit', { file_path: testFile, edits: [{ old_string: '  assert.equal(add(0, 0), 0);\n', new_string: '' }, { old_string: "test('adds'", new_string: "test('adds'); assert.equal(add(0, 0), 0" }] }, []],
  ['file emptied', 'Write', { file_path: testFile, content: "test('adds', () => {});\n" }, ['test-file-emptied']],
  ['go skip', 'Edit', { file_path: join(projectRoot, 'math_test.go'), old_string: 'func TestAdd(t *testing.T) {', new_string: 'func TestAdd(t *testing.T) {\n\tt.Skip("later")' }, ['test-skip-added']],
  // Shell.
  ['rm of a test', 'Bash', { command: 'rm test/math.test.mjs' }, ['test-file-removed']],
  ['git rm of a test', 'Bash', { command: 'git rm -q test/math.test.mjs' }, ['test-file-removed']],
  ['rm of the test folder', 'Bash', { command: 'rm -r test' }, ['test-file-removed']],
  ['rm of a fixture without assertions', 'Bash', { command: 'rm test/fixtures/data.json' }, []],
  ['mv to a non-test path', 'Bash', { command: 'mv test/math.test.mjs /tmp/' }, ['test-file-removed']],
  ['rename to another test path', 'Bash', { command: 'mv test/math.test.mjs test/sum.test.mjs' }, []],
  ['sed -i on a test', 'Bash', { command: "sed -i '/assert/d' test/math.test.mjs" }, ['test-shell-edit']],
  ['redirect into a test', 'Bash', { command: 'echo "" > test/math.test.mjs' }, ['test-shell-edit']],
  ['inline script naming a test', 'Bash', { command: 'python3 -c "open(\'test/math.test.mjs\',\'w\')"' }, ['test-shell-edit']],
  ['running the tests', 'Bash', { command: 'npm test > /tmp/out.txt' }, []],
];

for (const [caseName, toolName, toolInput, expectedRuleIds] of EXPECTED_FINDINGS) {
  test(`test-guard: ${caseName} -> ${expectedRuleIds.join(', ') || 'allow'}`, () => {
    assert.deepEqual(ruleIdsFor(toolName, toolInput), expectedRuleIds);
  });
}

test('test-guard: test_paths replaces the defaults and ignore_rules switches a rule off', () => {
  const skipEdit = { file_path: testFile, old_string: "test('adds'", new_string: "test.skip('adds'" };
  assert.deepEqual(ruleIdsFor('Edit', skipEdit, { test_paths: ['spec/**'] }), []);
  assert.deepEqual(ruleIdsFor('Edit', skipEdit, { ignore_rules: ['test-skip-added'] }), []);
});

test('test-guard: the reason names the file and says to fix the code', () => {
  const moduleDecision = testGuard.run({ hookInput: { cwd: projectRoot, tool_name: 'Bash', tool_input: { command: 'rm test/math.test.mjs' } }, projectRoot, moduleOptions: {} });
  assert.equal(moduleDecision.kind, 'ask');
  assert.match(moduleDecision.reason, /\[test-file-removed\] removes `test\/math\.test\.mjs`/);
  assert.match(moduleDecision.reason, /fix the code, not the test/);
});

test('test-guard runs through the dispatcher with verify on by default', () => {
  const repoRoot = createTemporaryProject({ version: 1 });
  mkdirSync(join(repoRoot, 'test'));
  writeFileSync(join(repoRoot, 'test', 'a.test.js'), "expect(1).toBe(1);\n");
  const hookOutput = runHookEvent('PreToolUse', bashPayload(repoRoot, 'rm test/a.test.js'));
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(hookOutput.hookSpecificOutput.permissionDecisionReason, /ai1\/test-guard/);
});
