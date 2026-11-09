import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import toolLoop, { toolCallSignature } from '../src/verify/tool-loop.mjs';
import { buildHookOutput } from '../src/core/hook-io.mjs';

let toolUseCounter = 0;

// A transcript the agent's calls are appended to, and a PreToolUse run for each new call.
function createSession() {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ai1-tool-loop-')), 'session.jsonl');
  writeFileSync(transcriptPath, '');
  const sessionEnvironment = { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) };
  const appendToolUse = (toolUseId, toolName, toolInput) => appendFileSync(transcriptPath, `${JSON.stringify({ message: { content: [{ type: 'tool_use', id: toolUseId, name: toolName, input: toolInput }] } })}\n`);
  return {
    // A call the hook does not see (Read, Grep...): only in the transcript.
    unseenCall(toolName, toolInput) {
      toolUseCounter += 1;
      appendToolUse(`toolu_${toolUseCounter}`, toolName, toolInput);
    },
    // A call the PreToolUse hook sees, already written to the transcript (as Claude Code does).
    hookedCall(toolName, toolInput, moduleOptions = {}) {
      toolUseCounter += 1;
      const toolUseId = `toolu_${toolUseCounter}`;
      appendToolUse(toolUseId, toolName, toolInput);
      return toolLoop.run({
        hookInput: { session_id: 'session-1', transcript_path: transcriptPath, tool_name: toolName, tool_input: toolInput, tool_use_id: toolUseId },
        projectRoot: '/repo',
        environment: sessionEnvironment,
        moduleOptions,
      });
    },
  };
}

const POLL = { command: 'gh run view 123 --json status' };

test('tool-loop: 5 identical calls in a row tell the agent once; a different call resets it', () => {
  const session = createSession();
  for (let callNumber = 1; callNumber <= 4; callNumber += 1) assert.equal(session.hookedCall('Bash', POLL).kind, 'allow', `call ${callNumber}`);
  const reminder = session.hookedCall('Bash', POLL);
  assert.equal(reminder.kind, 'context');
  assert.match(reminder.text, /last 5 tool calls were the same call with the same input \(`Bash: gh run view 123 --json status`\)/);
  assert.match(reminder.text, /background instead of polling/);
  assert.equal(session.hookedCall('Bash', POLL).kind, 'allow', 'told once');
  assert.equal(session.hookedCall('Bash', { command: 'npm test' }).kind, 'allow');
  for (let callNumber = 1; callNumber <= 4; callNumber += 1) session.hookedCall('Bash', POLL);
  assert.equal(session.hookedCall('Bash', POLL).kind, 'context', 'told again after a reset');
});

test('tool-loop: a call the hook does not see (Read) breaks the streak', () => {
  const session = createSession();
  for (let callNumber = 1; callNumber <= 3; callNumber += 1) session.hookedCall('Bash', POLL);
  session.unseenCall('Read', { file_path: '/repo/log.txt' });
  assert.equal(session.hookedCall('Bash', POLL).kind, 'allow');
  assert.equal(session.hookedCall('Bash', POLL).kind, 'allow');
});

test('tool-loop: the same command with another description is the same call; repeat_threshold is an option', () => {
  assert.equal(toolCallSignature('Bash', { command: 'ls', description: 'a' }), toolCallSignature('Bash', { command: 'ls', description: 'b' }));
  assert.notEqual(toolCallSignature('Bash', { command: 'ls' }), toolCallSignature('Bash', { command: 'ls -a' }));
  const session = createSession();
  session.hookedCall('Bash', POLL, { repeat_threshold: 3 });
  session.hookedCall('Bash', POLL, { repeat_threshold: 3 });
  assert.equal(session.hookedCall('Bash', POLL, { repeat_threshold: 3 }).kind, 'context');
});

test('tool-loop: without a transcript it still counts the calls it sees', () => {
  const sessionEnvironment = { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) };
  const decisions = [1, 2, 3, 4, 5].map((callNumber) => toolLoop.run({
    hookInput: { session_id: 'no-transcript', tool_name: 'Bash', tool_input: POLL, tool_use_id: `toolu_nt_${callNumber}` },
    projectRoot: '/repo',
    environment: sessionEnvironment,
    moduleOptions: {},
  }));
  assert.deepEqual(decisions.map((decision) => decision.kind), ['allow', 'allow', 'allow', 'allow', 'context']);
});

test('PreToolUse context reaches the agent as additionalContext', () => {
  assert.deepEqual(buildHookOutput('PreToolUse', { kind: 'context', text: 'hint' }), { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'hint' } });
});
