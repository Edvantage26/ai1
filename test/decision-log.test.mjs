import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { appendDecisionLog, decisionLogPath, readDecisionLog } from '../src/core/decision-log.mjs';
import { summarizeDecisionLog, formatDecisionSummary } from '../src/cli/log-command.mjs';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const pluginDataEnvironment = () => ({ CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) });

test('decision log: one line per module run, metadata only', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = pluginDataEnvironment();
  runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard && echo secret-value'), { environment, reportInternalError: () => {} });
  const logEntries = readDecisionLog(projectRoot, environment);
  const dangerEntry = logEntries.find((logEntry) => logEntry.module === 'danger');
  assert.equal(dangerEntry.decision, 'ask');
  assert.equal(dangerEntry.event, 'PreToolUse');
  assert.equal(dangerEntry.tool, 'Bash');
  assert.equal(dangerEntry.session, 'test-session');
  assert.ok(dangerEntry.chars > 0 && dangerEntry.ms >= 0);
  assert.ok(logEntries.some((logEntry) => logEntry.module === 'config-guard' && logEntry.decision === 'allow'), 'allows are logged too');
  assert.doesNotMatch(JSON.stringify(logEntries), /secret-value|reset --hard/, 'no command text');
});

test('decision log: off with AI1_DECISION_LOG=0, and rotated above 2 MB', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  const disabledEnvironment = { ...pluginDataEnvironment(), AI1_DECISION_LOG: '0' };
  runHookEvent('PreToolUse', bashPayload(projectRoot, 'git status'), { environment: disabledEnvironment });
  assert.equal(existsSync(decisionLogPath(projectRoot, disabledEnvironment)), false);
  const environment = pluginDataEnvironment();
  const logPath = decisionLogPath(projectRoot, environment);
  writeFileSync(logPath, `${JSON.stringify({ at: '2026-01-01T00:00:00Z', module: 'old', decision: 'allow' })}\n${'x'.repeat(2 * 1024 * 1024)}\n`);
  appendDecisionLog([{ at: '2026-01-02T00:00:00Z', module: 'new', decision: 'allow' }], projectRoot, environment);
  assert.ok(existsSync(`${logPath}.1`));
  assert.deepEqual(readDecisionLog(projectRoot, environment).map((logEntry) => logEntry.module), ['old', 'new'], 'broken lines skipped, old file first');
});

test('ai1 log summary: per module, filtered by session and time, latest noteworthy entries', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  const logEntries = [
    { at: '2026-11-09T11:00:00Z', session: 'a', event: 'PreToolUse', tool: 'Bash', module: 'danger', decision: 'ask', ms: 2, chars: 100 },
    { at: '2026-11-09T11:30:00Z', session: 'a', event: 'PreToolUse', tool: 'Bash', module: 'danger', decision: 'allow', ms: 1, chars: 0 },
    { at: '2026-11-09T11:40:00Z', session: 'a', event: 'UserPromptSubmit', module: 'okf-recall', decision: 'context', ms: 20, chars: 900 },
    { at: '2026-11-08T11:00:00Z', session: 'b', event: 'Stop', module: 'verify-gate', decision: 'block', ms: 5, chars: 50 },
  ];
  const lastDay = summarizeDecisionLog(logEntries, { sinceHours: 24, now });
  assert.equal(lastDay.entries, 3);
  assert.deepEqual(lastDay.modules.map((moduleSummary) => moduleSummary.module), ['okf-recall', 'danger'], 'slowest first');
  assert.deepEqual(lastDay.modules[1], { module: 'danger', runs: 2, decisions: { ask: 1, allow: 1 }, totalMs: 3, maxMs: 2, chars: 100, avgMs: 1.5 });
  assert.deepEqual(lastDay.recent.map((logEntry) => logEntry.decision), ['ask']);
  assert.equal(summarizeDecisionLog(logEntries, { sessionId: 'b', now }).modules[0].module, 'verify-gate');
  assert.match(formatDecisionSummary(lastDay), /okf-recall: 1 runs \(context 1\); 20 ms total.*900 chars added/);
  assert.match(formatDecisionSummary(summarizeDecisionLog([], {})), /no decisions recorded/);
});
