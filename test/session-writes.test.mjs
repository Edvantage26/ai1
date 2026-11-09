import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shellCommandOnlyReads, toolUseMayWriteFiles } from '../src/core/session-writes.mjs';

test('shellCommandOnlyReads: reading commands, read-only git and the verify command only read', () => {
  assert.equal(shellCommandOnlyReads('cd /repo && cat a.md | grep -n x | head -20'), true);
  assert.equal(shellCommandOnlyReads('git -C /repo log --oneline -5; git diff --stat'), true);
  assert.equal(shellCommandOnlyReads('find . -name "*.mjs" -print | sort | uniq -c'), true);
  assert.equal(shellCommandOnlyReads('npm test 2>&1 | tail -3', ['npm test']), true);
  assert.equal(shellCommandOnlyReads('ls src 2>/dev/null'), true);
});

test('shellCommandOnlyReads: anything that writes or is unknown may write', () => {
  assert.equal(shellCommandOnlyReads('npm test', []), false, 'not a verify command here');
  assert.equal(shellCommandOnlyReads('echo x > notes.txt'), false);
  assert.equal(shellCommandOnlyReads('sed -i s/a/b/ src/app.js'), false);
  assert.equal(shellCommandOnlyReads('git checkout -- src'), false);
  assert.equal(shellCommandOnlyReads('find . -name "*.tmp" -delete'), false);
  assert.equal(shellCommandOnlyReads('sort -o out.txt in.txt'), false);
  assert.equal(shellCommandOnlyReads('python3 - <<EOF\nprint(1)\nEOF'), false);
  assert.equal(shellCommandOnlyReads('cat $(make-list)'), false);
  assert.equal(shellCommandOnlyReads('npx prettier --write src'), false);
});

test('toolUseMayWriteFiles: edits and subagents may write, reading tools do not', () => {
  assert.equal(toolUseMayWriteFiles({ name: 'Edit', input: { file_path: 'a.js' } }), true);
  assert.equal(toolUseMayWriteFiles({ name: 'Agent', input: { prompt: 'x' } }), true);
  assert.equal(toolUseMayWriteFiles({ name: 'Read', input: { file_path: 'a.js' } }), false);
  assert.equal(toolUseMayWriteFiles({ name: 'mcp__docs__search', input: {} }), false);
  assert.equal(toolUseMayWriteFiles({ name: 'Bash', input: { command: 'git status' } }), false);
  assert.equal(toolUseMayWriteFiles({ name: 'Bash', input: { command: 'npm install' } }), true);
});
