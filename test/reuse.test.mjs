import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemporaryProject } from './helpers.mjs';
import { claudeProjectFolderName } from '../src/core/project-paths.mjs';

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
