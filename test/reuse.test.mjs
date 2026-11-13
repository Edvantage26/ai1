import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryProject } from './helpers.mjs';
import { claudeProjectFolderName } from '../src/core/project-paths.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';

const AI1_BIN = fileURLToPath(new URL('../bin/ai1', import.meta.url));

function createReuseRepo(extraFiles = {}) {
  const repoRoot = createTemporaryProject({ version: 1, features: { reuse: true } });
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  for (const [relativePath, fileText] of Object.entries(extraFiles)) {
    mkdirSync(join(repoRoot, relativePath, '..'), { recursive: true });
    writeFileSync(join(repoRoot, relativePath), fileText);
  }
  return repoRoot;
}

function writePastSession(homeDirectory, workingDirectory, sessionId, { prompt, commands = [], timestamp = '2026-11-01T10:00:00Z' }) {
  const transcriptFolder = join(homeDirectory, '.claude', 'projects', claudeProjectFolderName(workingDirectory));
  mkdirSync(transcriptFolder, { recursive: true });
  const transcriptEvents = [
    { type: 'user', timestamp, message: { role: 'user', content: [{ type: 'text', text: prompt }] } },
    { type: 'user', isMeta: true, timestamp, message: { role: 'user', content: 'o2 logging injected meta text' } },
    ...commands.map((commandLine, commandIndex) => ({ type: 'assistant', timestamp, message: { content: [{ type: 'tool_use', id: `tool-${commandIndex}`, name: 'Bash', input: { command: commandLine } }] } })),
  ];
  writeFileSync(join(transcriptFolder, `${sessionId}.jsonl`), `${transcriptEvents.map((transcriptEvent) => JSON.stringify(transcriptEvent)).join('\n')}\n`);
}

function runReuse(repoRoot, homeDirectory, commandArguments, environment = {}) {
  return execFileSync('node', [AI1_BIN, 'reuse', ...commandArguments], {
    cwd: repoRoot, encoding: 'utf8', env: { ...process.env, HOME: homeDirectory, CLAUDE_CODE_SESSION_ID: '', ...environment },
  });
}

test('reuse search lists only this repo and its worktrees, never the current session, plus matching project pieces [reuse:S3]', () => {
  const repoRoot = createReuseRepo({
    '.claude/skills/o2-setup/SKILL.md': '---\nname: o2-setup\ndescription: Configure o2 logging for a service\n---\nBody\n',
    '.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: Deploy the app\n---\nBody\n',
    '.mcp.json': JSON.stringify({ mcpServers: { observability: { url: 'https://o2.example/mcp', description: 'o2 logging queries' } } }),
  });
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  writePastSession(homeDirectory, repoRoot, 'main-session', { prompt: 'Configura o2 logging en el backend', commands: ['pip install o2-logging'] });
  writePastSession(homeDirectory, join(repoRoot, '.claude', 'worktrees', 'feature-x'), 'worktree-session', { prompt: 'add logging', commands: ['curl https://o2.example/api/default/x/_json'], timestamp: '2026-11-05T10:00:00Z' });
  writePastSession(homeDirectory, repoRoot, 'current-session', { prompt: 'o2 logging again' });
  writePastSession(homeDirectory, `${repoRoot}-other`, 'other-repo-session', { prompt: 'o2 logging in another repo' });
  writePastSession(homeDirectory, '/elsewhere/repo', 'unrelated-session', { prompt: 'o2 logging elsewhere' });
  writePastSession(homeDirectory, repoRoot, 'unrelated-here', { prompt: 'fix the deploy button' });

  const reportText = runReuse(repoRoot, homeDirectory, ['search', 'o2 logging'], { CLAUDE_CODE_SESSION_ID: 'current-session' });
  assert.match(reportText, /seen in 2 past session\(s\)/);
  assert.match(reportText, /2026-11-05 worktree-session: "add logging" \(1 prompts, 1 tool calls; logging, o2\)/, 'newest first, worktrees of this repo included');
  assert.match(reportText, /2026-11-01 main-session: "Configura o2 logging en el backend" \(1 prompts, 1 tool calls; o2, logging\)/);
  assert.doesNotMatch(reportText, /current-session|other-repo-session|unrelated-session|unrelated-here/);
  assert.match(reportText, /already in this project/);
  assert.match(reportText, /- skill o2-setup \(\.claude\/skills\/o2-setup\/SKILL\.md\): Configure o2 logging/);
  assert.match(reportText, /- mcp observability \(\.mcp\.json\)/);
  assert.doesNotMatch(reportText, /skill deploy/);

  const jsonResult = JSON.parse(runReuse(repoRoot, homeDirectory, ['search', 'o2 logging', '--json']));
  assert.deepEqual(jsonResult.sessionMatches.map((sessionMatch) => sessionMatch.sessionId).sort(), ['current-session', 'main-session', 'worktree-session'], 'without a session id nothing is skipped');
  assert.match(runReuse(repoRoot, homeDirectory, ['search', 'kubernetes helm']), /not seen in past sessions of this repo\.\nnothing in this project/);
});

test('reuse dismiss keeps a declined proposal in .ai1/reuse.json and search reports it [reuse:S4]', () => {
  const repoRoot = createReuseRepo();
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  assert.match(runReuse(repoRoot, homeDirectory, ['dismiss', 'o2-setup', '--keywords', 'o2 logging backend', 'one-off migration']), /dismissed o2-setup in \.ai1\/reuse\.json/);
  const reuseState = JSON.parse(readFileSync(join(repoRoot, '.ai1', 'reuse.json'), 'utf8'));
  assert.deepEqual(reuseState.dismissed.map(({ slug, keywords, reason }) => ({ slug, keywords, reason })), [{ slug: 'o2-setup', keywords: ['o2', 'logging', 'backend'], reason: 'one-off migration' }]);
  assert.match(runReuse(repoRoot, homeDirectory, ['search', 'logging backend']), /dismissed: o2-setup - one-off migration \(\d{4}-\d\d-\d\d\); do not propose it again/);
  assert.doesNotMatch(runReuse(repoRoot, homeDirectory, ['search', 'deploy button']), /dismissed/);
  assert.throws(() => runReuse(repoRoot, homeDirectory, ['dismiss', 'no-keywords', 'why']), (commandError) => commandError.status === 1 && /usage: ai1 reuse/.test(commandError.stdout));
});

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function appendToolCalls(transcriptPath, callCount) {
  const transcriptLines = Array.from({ length: callCount }, (unused, callIndex) => JSON.stringify({ type: 'assistant', timestamp: '2026-11-13T10:00:00Z', message: { content: [{ type: 'tool_use', id: `tool-${Math.random()}-${callIndex}`, name: 'Bash', input: { command: 'ls' } }] } }));
  appendFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
}

const stopTurn = (repoRoot, options, transcriptPath) => runHookEvent('Stop', { session_id: 'session-1', cwd: repoRoot, transcript_path: transcriptPath }, options);

test('reuse-check asks once after 8 tool calls since the last check, again after 8 more, at most twice [reuse:S1]', () => {
  const repoRoot = createReuseRepo();
  const options = hookOptions();
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  appendToolCalls(transcriptPath, 5);
  assert.equal(stopTurn(repoRoot, options, transcriptPath), null, '5 calls: not yet');
  appendToolCalls(transcriptPath, 3);
  const firstCheck = stopTurn(repoRoot, options, transcriptPath);
  assert.equal(firstCheck.decision, 'block');
  assert.match(firstCheck.reason, /^ai1\/reuse-check: Reuse: this task took 8 tool calls\. Judge silently whether this kind of work will be asked again in this repo/);
  assert.match(firstCheck.reason, /low .*finish without writing anything about it; the person never hears about a reuse check that found nothing/);
  assert.match(firstCheck.reason, /run `ai1 reuse search "<3-5 keywords>"`/);
  assert.match(firstCheck.reason, /A yes means you load \/ai1:reuse-encapsulate; a no means `ai1 reuse dismiss/);
  assert.equal(stopTurn(repoRoot, options, transcriptPath), null, 'silent right after a check');
  appendToolCalls(transcriptPath, 8);
  assert.match(stopTurn(repoRoot, options, transcriptPath).reason, /took 8 tool calls/);
  appendToolCalls(transcriptPath, 20);
  assert.equal(stopTurn(repoRoot, options, transcriptPath), null, 'at most twice per session');
});

test('reuse-check is silent under the threshold, with the feature off, and honours minToolCalls [reuse:S2]', () => {
  const quietRepo = createReuseRepo();
  const quietOptions = hookOptions();
  const quietTranscript = join(quietOptions.homeDirectory, 'transcript.jsonl');
  appendToolCalls(quietTranscript, 7);
  assert.equal(stopTurn(quietRepo, quietOptions, quietTranscript), null);

  const offRepo = createTemporaryProject({ version: 1, features: { reuse: false } });
  const offOptions = hookOptions();
  const offTranscript = join(offOptions.homeDirectory, 'transcript.jsonl');
  appendToolCalls(offTranscript, 30);
  assert.equal(stopTurn(offRepo, offOptions, offTranscript), null);

  const tunedRepo = createTemporaryProject({ version: 1, features: { reuse: true }, modules: { 'reuse-check': { minToolCalls: 3 } } });
  const tunedOptions = hookOptions();
  const tunedTranscript = join(tunedOptions.homeDirectory, 'transcript.jsonl');
  appendToolCalls(tunedTranscript, 3);
  assert.equal(stopTurn(tunedRepo, tunedOptions, tunedTranscript).decision, 'block');
});

test('reuse-brief: look up past work before redoing it, how to propose, only this repo; silent on resume and when off', () => {
  const repoRoot = createReuseRepo();
  const startSession = (projectRoot, source) => runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, hookOptions());
  const contextText = startSession(repoRoot, 'startup').hookSpecificOutput.additionalContext;
  assert.match(contextText, /Reuse: work that comes back in this repo becomes a reusable piece/);
  assert.match(contextText, /run `ai1 reuse search "<3-5 keywords>"` first/);
  assert.match(contextText, /Do not stop the task to ask\. A yes means loading \/ai1:reuse-encapsulate/);
  assert.match(contextText, /Only this repo: never search, cite or propose from other repos' sessions\./);
  assert.doesNotMatch(startSession(repoRoot, 'resume')?.hookSpecificOutput?.additionalContext || '', /Reuse:/);
  const offRepo = createTemporaryProject({ version: 1, features: { reuse: false } });
  assert.doesNotMatch(startSession(offRepo, 'startup')?.hookSpecificOutput?.additionalContext || '', /Reuse:/);
});

test('/ai1:reuse-encapsulate picks the container from its table, completes before creating, and is customizable [reuse:S5]', async () => {
  const { SKILL_CUSTOMIZATION_INDEX } = await import('../src/core/skill-customization-index.mjs');
  const skillText = readFileSync(fileURLToPath(new URL('../skills/reuse-encapsulate/SKILL.md', import.meta.url)), 'utf8');
  assert.match(skillText, /^name: reuse-encapsulate$/m);
  for (const container of ['A guard rule', 'A hook in `.claude/settings.json`', 'A script in the repo', 'A project skill', 'An MCP server entry in `.mcp.json`', '**Complete it**', '**Merge or restructure**']) {
    assert.ok(skillText.includes(container), `container row: ${container}`);
  }
  assert.match(skillText, /Run `ai1 reuse search/);
  assert.match(skillText, /Never use other repos' sessions/);
  assert.match(skillText, /## Fixed rules/);
  assert.deepEqual(SKILL_CUSTOMIZATION_INDEX['reuse-encapsulate'], { customizable: true, scopes: ['project', 'user'] });
});
