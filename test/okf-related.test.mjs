import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadHarnessConfig } from '../src/core/config.mjs';
import { findBundleIndex, findRelatedEntry, listRelatedCandidates, remoteIdentity, resolveRelatedEntries } from '../src/okf/okf-related.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function createRepository(parentDirectory, repoName, { files = {}, origin } = {}) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, 'README.md'), `# ${repoName}\n`);
  for (const [relativePath, fileText] of Object.entries(files)) {
    mkdirSync(join(repoRoot, relativePath, '..'), { recursive: true });
    writeFileSync(join(repoRoot, relativePath), fileText);
  }
  runGit(repoRoot, ['init', '-q']);
  if (origin) runGit(repoRoot, ['remote', 'add', 'origin', origin]);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

function createWorkspace() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'ai1-related-')));
}

test('related in .ai1/config.json: valid entries kept, a bad one dropped with a notice, a non-list is an error [related-repositories:S3]', () => {
  const workspaceRoot = createWorkspace();
  const repoRoot = createRepository(workspaceRoot, 'app', { files: { '.ai1/config.json': JSON.stringify({ related: [
    { name: 'worker', path: '../worker', owns: ['the ingest contract'] },
    { name: 'no-place' },
    { name: 'typo', path: '../x', ownz: [] },
  ] }) } });
  const loadedConfig = loadHarnessConfig(repoRoot);
  assert.equal(loadedConfig.status, 'ok');
  assert.deepEqual(loadedConfig.config.related.map((relatedEntry) => relatedEntry.name), ['worker']);
  assert.equal(loadedConfig.notices.length, 2);
  assert.match(loadedConfig.notices[0], /related\[1\] \(no-place\) is ignored: needs "path" or "remote"/);
  assert.match(loadedConfig.notices[1], /related\[2\] \(typo\) is ignored: unknown field "ownz"/);
  writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify({ related: { name: 'x' } }));
  assert.equal(loadHarnessConfig(repoRoot).status, 'invalid');
});

test('a related repository is found by its path (worktrees of it count) or by its remote, never by text [related-repositories:S1]', () => {
  const workspaceRoot = createWorkspace();
  const appRoot = createRepository(workspaceRoot, 'app');
  const workerRoot = createRepository(workspaceRoot, 'worker', { origin: 'git@github.com:acme/worker.git', files: { '.okf/index.md': '# worker\n' } });
  const webRoot = createRepository(workspaceRoot, 'web', { origin: 'https://github.com/acme/web.git' });
  const workerWorktree = join(workspaceRoot, 'worker-wt');
  runGit(workerRoot, ['worktree', 'add', '-q', '-b', 'wt/x', workerWorktree]);
  const relatedEntries = [{ name: 'worker', path: '../worker' }, { name: 'web', remote: 'acme/web' }];
  assert.equal(findRelatedEntry(appRoot, relatedEntries, workerRoot).name, 'worker');
  assert.equal(findRelatedEntry(appRoot, relatedEntries, workerWorktree).name, 'worker');
  assert.equal(findRelatedEntry(appRoot, relatedEntries, webRoot).name, 'web');
  assert.equal(findRelatedEntry(appRoot, [{ name: 'other', path: '../nowhere' }], workerRoot), null);
  assert.equal(remoteIdentity('git@github.com:Acme/Worker.git'), 'acme/worker');
  assert.equal(findBundleIndex(workerRoot), join(workerRoot, '.okf', 'index.md'), '.okf counts when .ai1/okf is missing');
  const [resolvedWorker, resolvedWeb] = resolveRelatedEntries(appRoot, relatedEntries);
  assert.equal(resolvedWorker.bundleIndex, join(workerRoot, '.okf', 'index.md'));
  assert.equal(resolvedWeb.repoRoot, null, 'a remote-only entry has no local place');
});

test('candidates: sibling repos the docs name and same-owner URLs, not related yet, shaped as entries [related-repositories:S4]', () => {
  const workspaceRoot = createWorkspace();
  createRepository(workspaceRoot, 'worker', { origin: 'git@github.com:acme/worker.git', files: { '.ai1/okf/index.md': '# w\n' } });
  createRepository(workspaceRoot, 'api');
  createRepository(workspaceRoot, 'unmentioned');
  createRepository(workspaceRoot, 'already');
  const appRoot = createRepository(workspaceRoot, 'app', { origin: 'git@github.com:acme/app.git', files: {
    'CLAUDE.md': 'The worker sends to the api. See also already.\n',
    '.ai1/okf/index.md': 'Contract with [billing](https://github.com/acme/billing) and https://github.com/other/thing.\n',
  } });
  const candidates = listRelatedCandidates(appRoot, [{ name: 'already', path: '../already' }], join(appRoot, '.ai1', 'okf'));
  assert.deepEqual(candidates, [
    { name: 'worker', path: '../worker', remote: 'acme/worker', has_bundle: true },
    { name: 'billing', path: null, remote: 'acme/billing', has_bundle: null },
  ], 'api is too short, unmentioned is not named, already is related, other/thing has another owner');
});
