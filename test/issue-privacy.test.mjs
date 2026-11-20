import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPrivateNames, findPrivateData, findGitRoot, listRepoNames, listSessionPaths, parseRemoteSlug } from '../src/core/issue-privacy.mjs';
import { buildAutomaticReport, runIssueCommand } from '../src/cli/issue-command.mjs';
import { createFakeRepo } from './helpers.mjs';

const hitValues = (privateHits) => privateHits.map((privateHit) => `${privateHit.kind}:${privateHit.value}`);

test('collectPrivateNames: folder and remote names of the repo; none for the ai1 repo; common words skipped [issue-privacy-check:S1]', () => {
  const clientRepo = createFakeRepo('acme-portal', 'git@github.com:acme-corp/acme-portal-web.git');
  const names = collectPrivateNames({ projectRoot: clientRepo, homeDirectory: '/home/tester', userName: 'runner' });
  assert.deepEqual(names.map((privateName) => privateName.name).sort(), ['acme-corp', 'acme-portal', 'acme-portal-web', 'tester']);
  const ai1Checkout = createFakeRepo('ai1-feature', 'https://github.com/Edvantage26/ai1.git');
  assert.deepEqual(listRepoNames(ai1Checkout), []);
  assert.deepEqual(parseRemoteSlug('https://github.com/acme-corp/acme-portal'), { owner: 'acme-corp', name: 'acme-portal' });
});

test('findGitRoot: a worktree (.git file) reads the remote of its common dir', () => {
  const mainRepo = createFakeRepo('acme-portal', 'git@github.com:acme-corp/acme-portal.git');
  const worktreeAdmin = join(mainRepo, '.git', 'worktrees', 'fix-a');
  mkdirSync(worktreeAdmin, { recursive: true });
  writeFileSync(join(worktreeAdmin, 'commondir'), '../..\n');
  const worktreeRoot = join(mkdtempSync(join(tmpdir(), 'ai1-privacy-wt-')), 'fix-a');
  mkdirSync(join(worktreeRoot, 'src'), { recursive: true });
  writeFileSync(join(worktreeRoot, '.git'), `gitdir: ${worktreeAdmin}\n`);
  assert.equal(findGitRoot(join(worktreeRoot, 'src', 'x.mjs')), worktreeRoot);
  assert.deepEqual(listRepoNames(worktreeRoot), ['fix-a', 'acme-corp', 'acme-portal']);
});

test('findPrivateData: names, home paths, emails, IPs, hosts and secrets, each with its placeholder [issue-privacy-check:S1]', () => {
  const privateNames = [{ name: 'acme-portal', kind: 'repo name' }, { name: 'José Pérez', kind: 'contact' }];
  const privateHits = findPrivateData({
    title: 'sizing: gate blocks in Acme-Portal',
    body: [
      'Seen in /home/tester/acme-portal/src and C:\\Users\\tester\\code.',
      'Jose Perez wrote from jose@acme.example.io to deploy.acme.dev (10.1.2.3).',
      'See https://grafana.internal.acme.tech/d/1 and token ghp_abcdefghijklmnopqrstuvwxyz0123456789.',
    ].join('\n'),
  }, privateNames);
  assert.deepEqual(hitValues(privateHits), [
    'repo name:acme-portal',
    'home path:/home/tester',
    'home path:C:\\Users\\tester',
    'email:jose@acme.example.io',
    'host:deploy.acme.dev',
    'ip:10.1.2.3',
    'contact:José Pérez',
    'host:grafana.internal.acme.tech',
    'secret:(a token or key)',
  ]);
  assert.equal(privateHits[0].where, 'title');
  assert.equal(privateHits.find((privateHit) => privateHit.kind === 'ip').placeholder, '<ip>');
});

test('findPrivateData: placeholders, the ai1 repo, files, versions and public domains pass [issue-privacy-check:S4]', () => {
  const cleanBody = [
    'Run `cd <repo>/.ai1/work/<slug> && sed -i s/a/b/ plan.md` in /home/<user>/x.',
    'See https://github.com/Edvantage26/ai1/issues/5, `src/sizing/sizing-work.mjs`, hooks.json, e.g. node:path.',
    '- ai1: 0.54.0', '- Claude Code: 2.1.319 (Claude Code)', '- Node: v22.22.3', '- localhost:3000 and 127.0.0.1',
    'Docs at https://docs.anthropic.com/en and https://nodejs.org/api.',
  ].join('\n');
  assert.deepEqual(findPrivateData({ title: 'sizing: a plan written from Bash is refused', body: cleanBody }, [{ name: 'acme-portal', kind: 'repo name' }]), []);
});

test('findPrivateData: the automatic report always passes [issue-privacy-check:S4]', () => {
  const automaticReport = buildAutomaticReport({
    ai1Version: '0.54.0', claudeCodeVersion: '2.1.319 (Claude Code)', nodeVersion: 'v22.22.3', operatingSystem: 'linux x64', host: 'terminal',
    repoHasAi1Config: true, enabledFeatures: ['okf', 'sizing'], unknownConfigEntries: [],
    pendingErrors: [{ module: 'sizing-gate', error: 'TypeError at src/sizing/sizing-gate.mjs:42', count: 2, first: '2026-11-19T10:00:00Z', last: '2026-11-20T10:00:00Z' }],
  });
  assert.deepEqual(findPrivateData(automaticReport, collectPrivateNames({ projectRoot: createFakeRepo('acme-portal', 'git@github.com:acme-corp/acme-portal.git'), userName: 'tester' })), []);
});

test('ai1 issue check: lists the repo name with its placeholder and exits 1; passes once replaced [issue-privacy-check:S1]', () => {
  const clientRepo = createFakeRepo('acme-portal', 'git@github.com:acme-corp/acme-portal.git');
  const draftPath = join(clientRepo, 'draft.md');
  writeFileSync(draftPath, '## What happened\nIn acme-portal the gate refused a quick edit.\n');
  const writtenLines = [];
  const readOption = (optionName) => (optionName === '--title' ? 'sizing: gate refuses a quick edit' : undefined);
  assert.equal(runIssueCommand(clientRepo, ['check', draftPath], { readOption, writeOutput: (line) => writtenLines.push(line) }), 1);
  assert.match(writtenLines[0], /- line 2: repo name `acme-portal` -> `<repo>`/);
  writeFileSync(draftPath, '## What happened\nIn <repo> the gate refused a quick edit.\n');
  assert.equal(runIssueCommand(clientRepo, ['check', draftPath], { readOption, writeOutput: (line) => writtenLines.push(line) }), 0);
  assert.match(writtenLines[1], /passed/);
  assert.throws(() => runIssueCommand(clientRepo, ['check'], { readOption, writeOutput: () => {} }), /usage: ai1 issue check/);
});

test('listSessionPaths: home paths in the transcript tail', () => {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ai1-privacy-tr-')), 't.jsonl');
  writeFileSync(transcriptPath, `${JSON.stringify({ message: { content: [{ type: 'tool_use', input: { command: 'cat /home/tester/acme-portal/README.md' } }] } })}\n`);
  assert.deepEqual(listSessionPaths(transcriptPath), ['/home/tester/acme-portal/README.md']);
  assert.deepEqual(listSessionPaths(join(tmpdir(), 'missing-transcript.jsonl')), []);
});
