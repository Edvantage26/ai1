import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSessionTranscript } from '../src/okf/okf-session-scan.mjs';

const line = (transcriptEvent) => `${JSON.stringify(transcriptEvent)}\n`;
const toolUse = (toolUseId, name, input) => line({ type: 'assistant', timestamp: '2026-11-15T10:00:00Z', message: { content: [{ type: 'tool_use', id: toolUseId, name, input }] } });
const toolResult = (toolUseId, text) => line({ type: 'user', timestamp: '2026-11-15T10:00:01Z', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text }] }] } });
const notification = (toolUseId, status) => line({ type: 'user', timestamp: '2026-11-15T10:05:00Z', message: { content: `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Agent "Read code" finished</summary>\n</task-notification>` } });

test('background agents count as pending until their task-notification arrives [okf-findings-2:S7]', () => {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ai1-bg-')), 'session.jsonl');
  writeFileSync(transcriptPath, toolUse('toolu_agent', 'Agent', { description: 'Read code', prompt: 'read', run_in_background: true })
    + toolResult('toolu_agent', 'Async agent launched successfully. (internal)\nagentId: a1')
    + Array.from({ length: 10 }, (unused, callIndex) => toolUse(`toolu_bash_${callIndex}`, 'Bash', { command: 'git log -1' })).join(''));
  const scanState = { offset: 0, paths: [], investigationCalls: 0 };
  const scanOptions = { memoryDirectories: [], bundleRelativePath: '.ai1/okf', projectRoot: '/repo' };
  const firstScan = scanSessionTranscript(transcriptPath, scanOptions, scanState);
  assert.equal(firstScan.investigationCalls, 10);
  assert.equal(firstScan.pendingBackgroundAgents, 1, 'the agent is still reading');
  appendFileSync(transcriptPath, notification('toolu_agent', 'completed'));
  assert.equal(scanSessionTranscript(transcriptPath, scanOptions, scanState).pendingBackgroundAgents, 0, 'its report arrived');
});
