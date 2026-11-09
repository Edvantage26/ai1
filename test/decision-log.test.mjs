import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { appendDecisionLog, decisionLogPath, readDecisionLog, listStateDirectoriesToRead } from '../src/core/decision-log.mjs';
import { shortHash } from '../src/core/session-state.mjs';
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

test('decision log: a shell without CLAUDE_PLUGIN_DATA reads every ai1 state dir, merged by time', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const logFileName = `decisions-${shortHash('/repo')}.jsonl`;
  const writeLog = (stateDirectory, logEntries) => {
    mkdirSync(stateDirectory, { recursive: true });
    writeFileSync(join(stateDirectory, logFileName), logEntries.map((logEntry) => JSON.stringify(logEntry)).join('\n') + '\n');
  };
  writeLog(join(homeDirectory, '.claude', 'plugins', 'data', 'ai1-ai1', 'state'), [{ at: '2026-11-09T10:00:00Z', module: 'installed' }]);
  writeLog(join(homeDirectory, '.claude', 'plugins', 'data', 'ai1-inline', 'state'), [{ at: '2026-11-09T09:00:00Z', module: 'plugin-dir' }]);
  writeLog(join(homeDirectory, '.claude', 'plugins', 'data', 'jig-inline', 'state'), [{ at: '2026-11-09T08:00:00Z', module: 'other-plugin' }]);
  writeLog(join(homeDirectory, '.cache', 'ai1'), [{ at: '2026-11-09T11:00:00Z', module: 'fallback' }]);
  assert.deepEqual(readDecisionLog('/repo', {}, homeDirectory).map((logEntry) => logEntry.module), ['plugin-dir', 'installed', 'fallback']);
  assert.equal(listStateDirectoriesToRead({}, homeDirectory).length, 3);
  assert.deepEqual(listStateDirectoriesToRead({ CLAUDE_PLUGIN_DATA: join(homeDirectory, 'none') }, homeDirectory), [], 'the variable wins, and only existing dirs');
});

test('decision log: a thrown module logs its error signature; asks log their rules and tool call; a sidecar names the repo', async () => {
  const { dispatchHookEvent } = await import('../src/core/hook-dispatch.mjs');
  const { ALL_MODULES } = await import('../src/core/registry.mjs');
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = pluginDataEnvironment();
  const throwingModule = { id: 'throws-on-purpose', event: 'PreToolUse', feature: 'core', run() { throw new TypeError('secret-detail /home/someone'); } };
  const dangerModule = ALL_MODULES.find((loadedModule) => loadedModule.id === 'danger');
  dispatchHookEvent('PreToolUse', { ...bashPayload(projectRoot, 'git reset --hard'), tool_use_id: 'toolu_1' }, {
    environment, moduleDefinitions: [throwingModule, dangerModule], runnableModules: [throwingModule, dangerModule], reportInternalError: () => {},
  });
  const logEntries = readDecisionLog(projectRoot, environment);
  const errorEntry = logEntries.find((logEntry) => logEntry.module === 'throws-on-purpose');
  assert.equal(errorEntry.decision, 'error');
  assert.equal(errorEntry.error, 'TypeError at test/decision-log.test.mjs:' + errorEntry.error.split(':').pop());
  assert.doesNotMatch(JSON.stringify(logEntries), /secret-detail|\/home\/someone/);
  const dangerEntry = logEntries.find((logEntry) => logEntry.module === 'danger');
  assert.deepEqual(dangerEntry.rules, ['git-reset-hard']);
  assert.equal(dangerEntry.toolUse, 'toolu_1');
  const sidecar = JSON.parse(readFileSync(decisionLogPath(projectRoot, environment).replace(/\.jsonl$/, '.repo'), 'utf8'));
  assert.equal(sidecar.path, projectRoot);
});

test('decision log: a crash of the hook entry point is logged as module entrypoint', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = pluginDataEnvironment();
  spawnSync(process.execPath, [fileURLToPath(new URL('../bin/ai1-hook.mjs', import.meta.url)), 'PreToolUse'], {
    input: '{ not json', cwd: projectRoot, encoding: 'utf8', env: { PATH: process.env.PATH, ...environment },
  });
  const crashEntry = readDecisionLog(projectRoot, environment).find((logEntry) => logEntry.module === 'entrypoint');
  assert.equal(crashEntry.decision, 'error');
  assert.match(crashEntry.error, /^SyntaxError/);
});

test('ai1 log --all: every repo named by its sidecar, with what the person answered to each ask', async () => {
  const { summarizeAllRepos, formatAllReposSummary } = await import('../src/cli/log-command.mjs');
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const stateDirectory = join(homeDirectory, '.claude', 'plugins', 'data', 'ai1-ai1', 'state');
  mkdirSync(stateDirectory, { recursive: true });
  const writeRepoLog = (repoPath, logEntries) => {
    writeFileSync(join(stateDirectory, `decisions-${shortHash(repoPath)}.jsonl`), logEntries.map((logEntry) => JSON.stringify(logEntry)).join('\n') + '\n');
    writeFileSync(join(stateDirectory, `decisions-${shortHash(repoPath)}.repo`), JSON.stringify({ name: repoPath.split('/').pop(), path: repoPath }));
  };
  const askEntry = (toolUse) => ({ at: '2026-11-09T10:00:00Z', session: 'sess-1', event: 'PreToolUse', tool: 'Edit', module: 'test-guard', decision: 'ask', ms: 1, chars: 100, toolUse, rules: ['test-skip-added'] });
  writeRepoLog('/work/shop', [askEntry('toolu_a'), askEntry('toolu_b'), askEntry('toolu_c'), askEntry('toolu_d'),
    { at: '2026-11-09T10:05:00Z', session: 'sess-1', event: 'Stop', module: 'verify-gate', decision: 'error', ms: 1, chars: 0, error: 'TypeError at src/verify/verify-gate.mjs:90' }]);
  writeRepoLog('/work/blog', [{ at: '2026-11-09T09:00:00Z', session: 'sess-2', event: 'SessionStart', module: 'brief', decision: 'context', ms: 2, chars: 500 }]);
  const projectFolder = join(homeDirectory, '.claude', 'projects', '-work-shop');
  mkdirSync(join(projectFolder, 'sess-1', 'subagents'), { recursive: true });
  const toolResultLine = (toolUseId, isError, contentText) => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError, content: contentText }] } });
  writeFileSync(join(projectFolder, 'sess-1.jsonl'), [
    toolResultLine('toolu_a', false, 'ok'),
    toolResultLine('toolu_b', true, "The user doesn't want to proceed with this tool use. The tool use was rejected"),
    toolResultLine('toolu_c', true, 'String to replace not found'),
  ].join('\n'));
  writeFileSync(join(projectFolder, 'sess-1', 'subagents', 'agent-1.jsonl'), toolResultLine('toolu_d', false, 'ok'));
  const repoSummaries = summarizeAllRepos({ environment: {}, homeDirectory });
  assert.deepEqual(repoSummaries.map((repoSummary) => repoSummary.repo).sort(), ['blog', 'shop']);
  const shopModules = repoSummaries.find((repoSummary) => repoSummary.repo === 'shop').modules;
  const testGuardSummary = shopModules.find((moduleSummary) => moduleSummary.module === 'test-guard');
  assert.deepEqual(testGuardSummary.asks, { approved: 3, refused: 1 }, 'a tool that failed after approval counts as approved; subagent transcripts are read');
  assert.deepEqual(testGuardSummary.rules, { 'test-skip-added': 4 });
  assert.deepEqual(shopModules.find((moduleSummary) => moduleSummary.module === 'verify-gate').errors, { 'TypeError at src/verify/verify-gate.mjs:90': 1 });
  const allText = formatAllReposSummary(repoSummaries);
  assert.match(allText, /== shop \(\/work\/shop\)/);
  assert.match(allText, /test-guard: 4 runs \(ask 4\).*asks answered: approved 3, refused 1; rules: test-skip-added 4/);
  assert.equal(summarizeAllRepos({ environment: {}, homeDirectory, sinceHours: 1, now: Date.parse('2026-11-10T00:00:00Z') }).length, 0, '--since applies');
});
