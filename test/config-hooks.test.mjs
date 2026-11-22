import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { configRepoDirectory, readConfigState, writeConfigState } from '../src/config/config-repo.mjs';
import { runConfigCommand } from '../src/config/config-command.mjs';
import { createTemporaryProject } from './helpers.mjs';

Object.assign(process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' });

function writeFile(filePath, text) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, text);
}

const git = (directory, ...gitArguments) => execFileSync('git', ['-C', directory, ...gitArguments], { encoding: 'utf8' }).trim();

function createPersonWithConfigRepo() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const pathOptions = { homeDirectory, environment: {} };
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Rules\n');
  runConfigCommand(['init'], { pathOptions, writeOutput: () => {}, writeError: () => {} });
  return { homeDirectory, pathOptions, repoDirectory: configRepoDirectory(pathOptions) };
}

function runHook(eventName, workingDirectory, homeDirectory) {
  return runHookEvent(eventName, { session_id: 'session-1', cwd: workingDirectory, source: 'startup', hook_event_name: eventName }, {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory,
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  });
}

const plainFolder = () => mkdtempSync(join(tmpdir(), 'ai1-plain-'));

test('at the end of a session in a folder without ai1, a new skill and an edited CLAUDE.md are committed to the config repo, nothing pushed [ai1-config:S2]', () => {
  const { homeDirectory, repoDirectory } = createPersonWithConfigRepo();
  const commitsBefore = Number(git(repoDirectory, 'rev-list', '--count', 'HEAD'));
  writeFile(join(homeDirectory, '.claude', 'skills', 'monitor-tool', 'SKILL.md'), 'monitors\n');
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Rules, edited in a session\n');
  writeFile(join(homeDirectory, '.config', 'ai1', 'skills', 'okf', 'customization.md'), '- a rule of mine\n');
  const hookOutput = runHook('Stop', plainFolder(), homeDirectory);
  assert.equal(hookOutput, null, 'a clean commit says nothing');
  assert.equal(Number(git(repoDirectory, 'rev-list', '--count', 'HEAD')), commitsBefore + 1);
  assert.match(git(repoDirectory, 'log', '-1', '--format=%s'), /^config: /);
  assert.deepEqual(git(repoDirectory, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['ai1/skills/okf/customization.md', 'claude/CLAUDE.md', 'claude/skills/monitor-tool/SKILL.md']);
});

test('the same in a repo with ai1 set up; a secret-like line is held back and told to the person [ai1-config:S2]', () => {
  const { homeDirectory, repoDirectory } = createPersonWithConfigRepo();
  writeFile(join(homeDirectory, '.claude', 'skills', 'api-tool', 'SKILL.md'), 'API_TOKEN=sk-live-9f8e7d6c5b4a39281706f5e4d3c2b1a0\n');
  const hookOutput = runHook('Stop', createTemporaryProject(), homeDirectory);
  assert.match(JSON.stringify(hookOutput), /not committed, a line looks like a secret: claude\/skills\/api-tool\/SKILL\.md/);
  assert.ok(!git(repoDirectory, 'ls-files').includes('api-tool'));
});

test('at session start, a change pulled into the repo is copied into place; a conflict is named; a sync over 12 hours old with a remote asks for ai1 config sync [ai1-config:S3]', () => {
  const { homeDirectory, pathOptions, repoDirectory } = createPersonWithConfigRepo();
  writeFile(join(repoDirectory, 'claude', 'skills', 'from-other-machine', 'SKILL.md'), 'arrived\n');
  git(repoDirectory, 'add', '--all');
  git(repoDirectory, 'commit', '--quiet', '-m', 'from another machine');
  const startText = JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory));
  assert.match(startText, /1 change\(s\) from the person's config repo were copied into place/);
  assert.match(startText, /ai1 plugin is installed but inactive here/, 'the setup line is still there in a folder without ai1');
  assert.equal(readFileSync(join(homeDirectory, '.claude', 'skills', 'from-other-machine', 'SKILL.md'), 'utf8'), 'arrived\n');

  writeFile(join(repoDirectory, 'claude', 'CLAUDE.md'), '# Rules from the other machine\n');
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Rules edited here\n');
  assert.match(JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory)), /left untouched: claude\/CLAUDE\.md/);

  git(repoDirectory, 'remote', 'add', 'origin', mkdtempSync(join(tmpdir(), 'ai1-remote-')));
  writeConfigState({ ...readConfigState(pathOptions), lastSyncAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString() }, pathOptions);
  assert.match(JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory)), /Run `ai1 config sync`/);
});

test('creating a user-level skill with a config repo: once per session, where it goes and the technology template with its stack line [ai1-config:S6]', () => {
  const { homeDirectory } = createPersonWithConfigRepo();
  const environment = { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) };
  const writeSkill = (skillName, sessionId = 'session-1') => runHookEvent('PostToolUse', { session_id: sessionId, cwd: plainFolder(), hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(homeDirectory, '.claude', 'skills', skillName, 'SKILL.md') } }, { environment, homeDirectory, reportInternalError: (errorMessage) => { throw new Error(errorMessage); } });
  const hintText = JSON.stringify(writeSkill('queue-tool'));
  assert.match(hintText, /queue-tool is a skill of the person's own config: it is committed to their config repo when the session ends/);
  assert.match(hintText, /ai1 config new-skill/);
  assert.match(hintText, /--setup \\"queue-tool\\"/);
  assert.equal(writeSkill('other-tool'), null, 'once per session');
  assert.match(JSON.stringify(writeSkill('other-tool', 'session-2')), /other-tool/);
  const noRepoHome = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const withoutRepo = runHookEvent('PostToolUse', { session_id: 's', cwd: plainFolder(), hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: join(noRepoHome, '.claude', 'skills', 'x', 'SKILL.md') } }, { environment, homeDirectory: noRepoHome, reportInternalError: (errorMessage) => { throw new Error(errorMessage); } });
  assert.equal(withoutRepo, null);
});

test('without a config repo but with a global CLAUDE.md or user skills, the session start offers /ai1:core-setup-config, at most every 30 days, never after ai1 config off; the skill covers adopt, clone and new [ai1-config:S7]', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const pathOptions = { homeDirectory, environment: {} };
  assert.doesNotMatch(JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory)), /core-setup-config/, 'nothing of the person to keep yet');
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Mine\n');
  const offerText = JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory));
  assert.match(offerText, /"systemMessage":"ai1\/config-sync-start: your Claude Code config .*is in no config repo.*\/ai1:core-setup-config keeps it in a private repo/);
  assert.match(offerText, /`ai1 config off` stops this note/);
  assert.doesNotMatch(offerText, /additionalContext[^}]*core-setup-config/, 'a message to the person, not context for the agent');
  assert.doesNotMatch(JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory)), /core-setup-config/, 'not again within 30 days');
  writeConfigState({ ...readConfigState(pathOptions), setupOfferedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() }, pathOptions);
  assert.match(JSON.stringify(runHook('SessionStart', createTemporaryProject({}), homeDirectory)), /core-setup-config/, 'also in a repo with ai1');
  writeConfigState({ ...readConfigState(pathOptions), setupOfferedAt: null }, pathOptions);
  runConfigCommand(['off'], { pathOptions, writeOutput: () => {}, writeError: () => {} });
  assert.doesNotMatch(JSON.stringify(runHook('SessionStart', plainFolder(), homeDirectory)), /core-setup-config/);
  const skillText = readFileSync(new URL('../skills/core-setup-config/SKILL.md', import.meta.url), 'utf8');
  for (const route of ['ai1 config adopt <folder>', 'ai1 config clone <owner/repo or git url>', 'ai1 config init --remote <url>']) assert.ok(skillText.includes(route), route);
  assert.match(skillText, /No rule in CLAUDE\.md is needed for that/);
});

test('without a config repo, or with ai1 config off, the hooks do nothing', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  writeFile(join(homeDirectory, '.claude', 'skills', 'x', 'SKILL.md'), 'x\n');
  assert.equal(runHook('Stop', plainFolder(), homeDirectory), null);
  const { homeDirectory: offHome, pathOptions, repoDirectory } = createPersonWithConfigRepo();
  runConfigCommand(['off'], { pathOptions, writeOutput: () => {}, writeError: () => {} });
  const commitsBefore = git(repoDirectory, 'rev-list', '--count', 'HEAD');
  writeFile(join(offHome, '.claude', 'skills', 'y', 'SKILL.md'), 'y\n');
  runHook('Stop', plainFolder(), offHome);
  assert.equal(git(repoDirectory, 'rev-list', '--count', 'HEAD'), commitsBefore);
});
