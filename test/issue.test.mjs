import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectIssueEnvironment, formatIssueEnvironment, buildNewIssueUrl, runIssueCommand } from '../src/cli/issue-command.mjs';
import { createTemporaryProject } from './helpers.mjs';

const pluginVersion = JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
const answerClaudeVersion = () => ({ status: 0, stdout: '2.1.0 (Claude Code)\n', stderr: '' });

test('issue env: versions, host and the repo features, without paths', () => {
  const projectRoot = createTemporaryProject({ version: 1, features: { okf: true, lanes: true, someday: true } });
  const issueEnvironment = collectIssueEnvironment(projectRoot, { environment: {}, runCommand: answerClaudeVersion, platformName: 'linux', architectureName: 'x64', nodeVersion: 'v22.0.0' });
  assert.equal(issueEnvironment.ai1Version, pluginVersion);
  assert.equal(issueEnvironment.claudeCodeVersion, '2.1.0 (Claude Code)');
  assert.equal(issueEnvironment.host, 'terminal');
  assert.ok(issueEnvironment.enabledFeatures.includes('okf') && issueEnvironment.enabledFeatures.includes('lanes'));
  assert.deepEqual(issueEnvironment.unknownConfigEntries, ['feature "someday"']);
  const environmentText = formatIssueEnvironment(issueEnvironment);
  assert.match(environmentText, /- OS: linux x64/);
  assert.match(environmentText, /unknown to this version: feature "someday"/);
  assert.ok(!environmentText.includes(projectRoot));
});

test('issue env: no config, and Claude Code missing', () => {
  const projectRoot = createTemporaryProject();
  const issueEnvironment = collectIssueEnvironment(projectRoot, { environment: { PASEO_AGENT_ID: 'x' }, runCommand: () => ({ status: 1, stdout: '', stderr: 'not found' }) });
  assert.equal(issueEnvironment.claudeCodeVersion, 'unknown');
  assert.equal(issueEnvironment.host, 'paseo');
  assert.match(formatIssueEnvironment(issueEnvironment), /- Repo: no \.ai1\/config\.json/);
});

test('new issue link: title and body encoded, title only when too long', () => {
  const shortLink = buildNewIssueUrl('Hook fails & stops', 'Steps:\n1. run');
  assert.ok(shortLink.url.startsWith('https://github.com/Edvantage26/ai1/issues/new?'));
  assert.equal(new URL(shortLink.url).searchParams.get('title'), 'Hook fails & stops');
  assert.equal(new URL(shortLink.url).searchParams.get('body'), 'Steps:\n1. run');
  assert.equal(shortLink.includesBody, true);
  const longLink = buildNewIssueUrl('Long', 'x'.repeat(9000));
  assert.equal(longLink.includesBody, false);
  assert.equal(new URL(longLink.url).searchParams.get('body'), null);
});

test('ai1 issue url reads the body file; unknown subcommands print the usage', () => {
  const bodyPath = join(mkdtempSync(join(tmpdir(), 'ai1-issue-')), 'body.md');
  writeFileSync(bodyPath, 'What happened');
  const writtenLines = [];
  const commandArguments = ['url', '--title', 'Bug', '--body-file', bodyPath];
  const readOption = (optionName) => commandArguments[commandArguments.indexOf(optionName) + 1];
  assert.equal(runIssueCommand('/unused', commandArguments, { readOption, writeOutput: (line) => writtenLines.push(line) }), 0);
  assert.equal(new URL(writtenLines[0]).searchParams.get('body'), 'What happened');
  assert.throws(() => runIssueCommand('/unused', ['url'], { readOption: () => undefined, writeOutput: () => {} }), /--body-file/);
  assert.equal(runIssueCommand('/unused', ['nope'], { readOption: () => undefined, writeOutput: () => {} }), 1);
});
