import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configRepoDirectory } from '../src/config/config-repo.mjs';
import { runConfigCommand } from '../src/config/config-command.mjs';

const GIT_IDENTITY = { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com' };
Object.assign(process.env, GIT_IDENTITY);

function writeFile(filePath, text) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, text);
}

function createHome() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  return { homeDirectory, pathOptions: { homeDirectory, environment: {} } };
}

function runConfig(pathOptions, ...commandArguments) {
  const outputs = [];
  const errors = [];
  const exitCode = runConfigCommand(commandArguments, { pathOptions, writeOutput: (text) => outputs.push(text), writeError: (text) => errors.push(text) });
  return { exitCode, output: outputs.join('\n'), error: errors.join('\n') };
}

const git = (directory, ...gitArguments) => execFileSync('git', ['-C', directory, ...gitArguments], { encoding: 'utf8' }).trim();

test('init captures what is already in ~/.claude, clone puts it on a second machine, a session\'s change is committed and travels back with sync [ai1-config:S1] [ai1-config:S3]', () => {
  const remoteDirectory = mkdtempSync(join(tmpdir(), 'ai1-remote-'));
  git(remoteDirectory, 'init', '--quiet', '--bare', '-b', 'main');
  const firstMachine = createHome();
  writeFile(join(firstMachine.homeDirectory, '.claude', 'CLAUDE.md'), '# My rules\n');
  writeFile(join(firstMachine.homeDirectory, '.claude', 'skills', 'deploy-tool', 'SKILL.md'), 'deploy\n');
  writeFile(join(firstMachine.homeDirectory, '.claude', 'settings.json'), JSON.stringify({ env: { FLAG: '1' }, internal: 2 }));
  writeFile(join(firstMachine.homeDirectory, '.claude', 'history.jsonl'), 'not mine');
  assert.equal(runConfig(firstMachine.pathOptions, 'init', '--remote', remoteDirectory).exitCode, 0);
  const firstRepo = configRepoDirectory(firstMachine.pathOptions);
  assert.deepEqual(git(firstRepo, 'ls-files').split('\n').sort(), ['.gitattributes', '.gitignore', 'README.md', 'ai1-config.json', 'claude/CLAUDE.md', 'claude/settings.json', 'claude/skills/deploy-tool/SKILL.md']);
  assert.equal(readFileSync(join(firstRepo, '.gitattributes'), 'utf8'), '* -text\n', 'byte-exact on every OS');
  assert.deepEqual(JSON.parse(readFileSync(join(firstRepo, 'claude', 'settings.json'), 'utf8')), { env: { FLAG: '1' } });
  assert.equal(runConfig(firstMachine.pathOptions, 'push').exitCode, 0);

  const secondMachine = createHome();
  writeFile(join(secondMachine.homeDirectory, '.claude', 'settings.json'), JSON.stringify({ internal: 9 }));
  const cloned = runConfig(secondMachine.pathOptions, 'clone', remoteDirectory);
  assert.equal(cloned.exitCode, 0, cloned.error);
  assert.equal(readFileSync(join(secondMachine.homeDirectory, '.claude', 'CLAUDE.md'), 'utf8'), '# My rules\n');
  assert.deepEqual(JSON.parse(readFileSync(join(secondMachine.homeDirectory, '.claude', 'settings.json'), 'utf8')), { internal: 9, env: { FLAG: '1' } });
  assert.match(runConfig(secondMachine.pathOptions, 'status').output, /files: \d+ in-sync$/m);

  writeFile(join(secondMachine.homeDirectory, '.claude', 'skills', 'deploy-tool', 'SKILL.md'), 'deploy, improved on machine 2\n');
  assert.match(runConfig(secondMachine.pathOptions, 'commit').output, /committed: config: claude\/skills\/deploy-tool\/SKILL\.md/);
  assert.equal(runConfig(secondMachine.pathOptions, 'push').exitCode, 0);
  const synced = runConfig(firstMachine.pathOptions, 'sync');
  assert.match(synced.output, /pulled/);
  assert.equal(readFileSync(join(firstMachine.homeDirectory, '.claude', 'skills', 'deploy-tool', 'SKILL.md'), 'utf8'), 'deploy, improved on machine 2\n');
});

test('a file whose new lines look like a secret is held back and named; --include commits it after checking [ai1-config:S2]', () => {
  const { homeDirectory, pathOptions } = createHome();
  runConfig(pathOptions, 'init');
  writeFile(join(homeDirectory, '.claude', 'CLAUDE.md'), '# Rules\n');
  writeFile(join(homeDirectory, '.claude', 'skills', 'api-tool', 'SKILL.md'), 'Call it with\nAPI_TOKEN=sk-live-9f8e7d6c5b4a39281706f5e4d3c2b1a0\n');
  const committed = runConfig(pathOptions, 'commit');
  assert.match(committed.output, /committed: config: claude\/CLAUDE\.md/);
  assert.match(committed.output, /held back \(a line looks like a secret\): claude\/skills\/api-tool\/SKILL\.md/);
  const repoDirectory = configRepoDirectory(pathOptions);
  assert.ok(!git(repoDirectory, 'ls-files').includes('api-tool'));
  assert.match(runConfig(pathOptions, 'commit', '--include', 'claude/skills/api-tool/SKILL.md').output, /committed/);
  assert.ok(git(repoDirectory, 'ls-files').includes('api-tool'));
});

test('adopt: a config repo wired with symlinks is reordered to the layout, moved, its symlinks turned into copies, a link elsewhere kept [ai1-config:S5]', { skip: process.platform === 'win32' && 'symlinks need rights on Windows' }, () => {
  const { homeDirectory, pathOptions } = createHome();
  const oldRepo = join(homeDirectory, 'my-config');
  writeFile(join(oldRepo, '.claude', 'CLAUDE.md'), '# Global\n');
  writeFile(join(oldRepo, '.claude', 'settings.json'), JSON.stringify({ env: { A: '1' }, enabledPlugins: { 'x@y': true }, internalThing: true }));
  writeFile(join(oldRepo, '.claude', 'skills', 'accounts', 'scripts', 'accounts.sh'), '#!/bin/sh\n');
  writeFile(join(oldRepo, '.config', 'ai1', 'skills', 'okf', 'overlay.md'), '- my okf rule\n');
  writeFile(join(oldRepo, 'CLAUDE.md'), '# Home\n');
  writeFile(join(oldRepo, 'skills-lock.json'), '{}\n');
  writeFile(join(oldRepo, 'install.sh'), '#!/bin/sh\n');
  git(oldRepo, 'init', '--quiet', '-b', 'main');
  git(oldRepo, 'add', '--all');
  git(oldRepo, 'commit', '--quiet', '-m', 'old layout');
  mkdirSync(join(homeDirectory, '.claude'), { recursive: true });
  mkdirSync(join(homeDirectory, '.config', 'ai1', 'skills', 'okf'), { recursive: true });
  mkdirSync(join(homeDirectory, '.local', 'bin'), { recursive: true });
  symlinkSync(join(oldRepo, '.claude', 'CLAUDE.md'), join(homeDirectory, '.claude', 'CLAUDE.md'));
  symlinkSync(join(oldRepo, '.claude', 'settings.json'), join(homeDirectory, '.claude', 'settings.json'));
  symlinkSync(join(oldRepo, '.claude', 'skills'), join(homeDirectory, '.claude', 'skills'));
  symlinkSync(join(oldRepo, '.config', 'ai1', 'skills', 'okf', 'overlay.md'), join(homeDirectory, '.config', 'ai1', 'skills', 'okf', 'overlay.md'));
  symlinkSync(join(oldRepo, 'CLAUDE.md'), join(homeDirectory, 'CLAUDE.md'));
  symlinkSync(join(oldRepo, 'skills-lock.json'), join(homeDirectory, 'skills-lock.json'));
  symlinkSync(join(oldRepo, '.claude', 'skills', 'accounts', 'scripts', 'accounts.sh'), join(homeDirectory, '.local', 'bin', 'accounts'));

  const adopted = runConfig(pathOptions, 'adopt', oldRepo, '--auto-push');
  assert.equal(adopted.exitCode, 0, adopted.error);
  const repoDirectory = configRepoDirectory(pathOptions);
  assert.deepEqual(git(repoDirectory, 'ls-files').split('\n').sort(), ['.gitattributes', 'ai1-config.json', 'ai1/skills/okf/customization.md', 'claude/CLAUDE.md', 'claude/settings.json', 'claude/skills/accounts/scripts/accounts.sh', 'home/CLAUDE.md', 'home/skills-lock.json', 'install.sh']);
  assert.match(adopted.output, /left in the repo as they are \(not synced\): \.gitattributes, install\.sh/);
  assert.deepEqual(JSON.parse(readFileSync(join(repoDirectory, 'claude', 'settings.json'), 'utf8')), { env: { A: '1' }, enabledPlugins: { 'x@y': true } });
  const options = JSON.parse(readFileSync(join(repoDirectory, 'ai1-config.json'), 'utf8'));
  assert.equal(options.autoPush, true);
  assert.deepEqual(options.links, [{ repo: 'claude/skills/accounts/scripts/accounts.sh', target: '~/.local/bin/accounts' }]);
  for (const copiedPath of [join('.claude', 'CLAUDE.md'), join('.claude', 'settings.json'), join('.claude', 'skills', 'accounts', 'scripts', 'accounts.sh'), 'CLAUDE.md', 'skills-lock.json']) {
    assert.ok(!lstatSync(join(homeDirectory, copiedPath)).isSymbolicLink(), `${copiedPath} is a copy now`);
  }
  assert.ok(lstatSync(join(homeDirectory, '.claude', 'skills')).isDirectory());
  assert.equal(readFileSync(join(homeDirectory, '.config', 'ai1', 'skills', 'okf', 'customization.md'), 'utf8'), '- my okf rule\n');
  assert.deepEqual(JSON.parse(readFileSync(join(homeDirectory, '.claude', 'settings.json'), 'utf8')).internalThing, true, 'Claude Code\'s keys stay in the target');
  assert.ok(lstatSync(join(homeDirectory, '.local', 'bin', 'accounts')).isSymbolicLink());
  assert.ok(lstatSync(oldRepo).isSymbolicLink(), 'the old path points to the new place');
  assert.match(runConfig(pathOptions, 'status').output, /files: \d+ in-sync$/m);
});

test('new-skill writes the technology template (when it applies, integrate, audit, operate, when done) and names its stack line [ai1-config:S6]', () => {
  const { homeDirectory, pathOptions } = createHome();
  runConfig(pathOptions, 'init');
  const created = runConfig(pathOptions, 'new-skill', 'uptime-checks');
  assert.equal(created.exitCode, 0, created.error);
  const skillText = readFileSync(join(homeDirectory, '.claude', 'skills', 'uptime-checks', 'SKILL.md'), 'utf8');
  for (const heading of ['## When it applies', '## Integrate', '## Audit', '## Operate', '## When done']) assert.ok(skillText.includes(heading), heading);
  assert.match(skillText, /^name: uptime-checks$/m);
  assert.match(created.output, /ai1 okf stack add --scope user .*--setup "uptime-checks"/);
  assert.match(runConfig(pathOptions, 'new-skill', 'Bad Name').error, /lowercase with dashes/);
  assert.match(runConfig(pathOptions, 'status').output, /capture-new: claude\/skills\/uptime-checks\/SKILL\.md/);
});

test('without a config repo every command but init, clone and adopt says how to start; off and machine are kept in the state', () => {
  const { pathOptions } = createHome();
  assert.match(runConfig(pathOptions, 'status').error, /no config repo yet: ai1 config init \| clone <remote> \| adopt <dir>/);
  runConfig(pathOptions, 'init');
  assert.match(runConfig(pathOptions, 'off').output, /config sync off/);
  assert.match(runConfig(pathOptions, 'machine', 'Work Laptop').output, /machines\/work-laptop\//);
  assert.match(runConfig(pathOptions, 'status').output, /machine work-laptop, sync OFF/);
  assert.ok(existsSync(configRepoDirectory(pathOptions)));
});
