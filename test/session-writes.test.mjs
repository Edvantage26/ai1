import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readNewTranscriptEvents, TOOL_USE_MARKER } from '../src/core/transcript-scan.mjs';
import { shellCommandOnlyReads, toolUseMayWriteFiles, shellCommandWritesOnlyOutside, updateWriteWindows, isInsideWriteWindow } from '../src/core/session-writes.mjs';

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

test('shellCommandWritesOnlyOutside: scratch writes outside the project, nothing unclear', () => {
  const projectRoot = '/home/person/repo';
  assert.equal(shellCommandWritesOnlyOutside('mkdir -p /tmp/scan && echo x > /tmp/scan/a.txt', projectRoot), true);
  assert.equal(shellCommandWritesOnlyOutside('cp src/a.js /tmp/a.js', projectRoot), true);
  assert.equal(shellCommandWritesOnlyOutside('echo x > notes.txt', projectRoot), false, 'relative targets may be in the project');
  assert.equal(shellCommandWritesOnlyOutside('echo x > /home/person/repo/src/a.js', projectRoot), false);
  assert.equal(shellCommandWritesOnlyOutside('mv src/a.js /tmp/a.js', projectRoot), false, 'mv also removes its source');
  assert.equal(shellCommandWritesOnlyOutside('python3 build.py > /tmp/out.txt', projectRoot), false);
  assert.equal(shellCommandWritesOnlyOutside('git status', projectRoot), false, 'no writes: not this case');
  assert.equal(shellCommandWritesOnlyOutside('echo x > /tmp/a', undefined), false);
});

function toolUseEvent(toolUseId, name, input, timestamp) {
  return { timestamp, message: { content: [{ type: 'tool_use', id: toolUseId, name, input }] } };
}

function toolResultEvent(toolUseId, timestamp) {
  return { timestamp, message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'ok' }] } };
}

test('updateWriteWindows: a call that may write is a window from its tool_use to its tool_result', () => {
  const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const windowState = updateWriteWindows({}, [
    toolUseEvent('read', 'Bash', { command: 'git status' }, at(1)),
    toolResultEvent('read', at(2)),
    toolUseEvent('edit', 'Edit', { file_path: 'a.js' }, at(10)),
    toolResultEvent('edit', at(11)),
    toolUseEvent('scratch', 'Bash', { command: 'echo x > /tmp/x' }, at(20)),
    toolResultEvent('scratch', at(21)),
  ], { projectRoot: '/repo' });
  assert.deepEqual(windowState.writeWindows, [{ startMilliseconds: Date.parse(at(10)), endMilliseconds: Date.parse(at(11)) }]);
  assert.equal(isInsideWriteWindow(Date.parse(at(10)) + 500, windowState.writeWindows), true);
  assert.equal(isInsideWriteWindow(Date.parse(at(30)), windowState.writeWindows), false);
  assert.equal(isInsideWriteWindow(Date.parse(at(2)), windowState.writeWindows), false);
});

test('updateWriteWindows: subagents, background shells and events without a time stay open', () => {
  const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const windowState = updateWriteWindows({}, [
    toolUseEvent('agent', 'Agent', { prompt: 'x' }, at(1)),
    toolResultEvent('agent', at(2)),
    toolUseEvent('server', 'Bash', { command: 'npm run dev', run_in_background: true }, at(3)),
    toolResultEvent('server', at(4)),
  ]);
  assert.deepEqual(windowState.writeWindows.map(({ endMilliseconds }) => endMilliseconds), [null, null]);
  assert.equal(isInsideWriteWindow(Date.parse(at(50)), windowState.writeWindows), true);
  const untimedState = updateWriteWindows({}, [toolUseEvent('edit', 'Edit', { file_path: 'a.js' })]);
  assert.deepEqual(untimedState.writeWindows, [{ startMilliseconds: 0, endMilliseconds: null }]);
});

test('updateWriteWindows: a window still waiting for its result is open; state from before windows counts as one window', () => {
  const at = (seconds) => new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
  const windowState = updateWriteWindows({}, [toolUseEvent('edit', 'Edit', { file_path: 'a.js' }, at(5))]);
  assert.equal(isInsideWriteWindow(Date.parse(at(40)), windowState.writeWindows), true);
  updateWriteWindows(windowState, [toolResultEvent('edit', at(6))]);
  assert.equal(isInsideWriteWindow(Date.parse(at(40)), windowState.writeWindows), false);
  assert.deepEqual(updateWriteWindows({ sessionMayHaveWritten: true }, []).writeWindows, [{ startMilliseconds: 0, endMilliseconds: null }]);
  assert.deepEqual(updateWriteWindows({ sessionMayHaveWritten: false }, []).writeWindows, []);
  assert.deepEqual(updateWriteWindows({ writeWindows: [{ startMilliseconds: 0, endMilliseconds: null }] }, [], { restarted: true }).writeWindows, []);
});

test('readNewTranscriptEvents: the request copies Claude Code writes (api-request-blob) are not read as calls', () => {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ai1-transcript-')), 'transcript.jsonl');
  const toolUse = { type: 'tool_use', id: 'edit', name: 'Edit', input: { file_path: 'a.js' } };
  writeFileSync(transcriptPath, [
    { type: 'assistant', timestamp: '2026-01-01T00:00:01.000Z', message: { content: [toolUse] } },
    { type: 'api-request-blob', message: { role: 'assistant', content: [toolUse] } },
  ].map((transcriptEvent) => JSON.stringify(transcriptEvent)).join('\n') + '\n');
  const { events } = readNewTranscriptEvents(transcriptPath, {}, [TOOL_USE_MARKER]);
  assert.deepEqual(events.map((transcriptEvent) => transcriptEvent.type), ['assistant']);
});
