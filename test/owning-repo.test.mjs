import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeOwningRepository } from '../src/core/owning-repo.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function createRepository(parentDirectory, repoName, { withAi1 = false } = {}) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'app.js'), 'console.log(1);\n');
  if (withAi1) {
    mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
    writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify({ features: {} }));
  }
  runGit(repoRoot, ['init', '-q']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

function createWorkspace() {
  return realpathSync(mkdtempSync(join(tmpdir(), 'ai1-owning-')));
}

test('a file of the launch repository, or of one of its linked worktrees, belongs to the launch repository [foreign-repo-delegation:S5]', () => {
  const workspaceRoot = createWorkspace();
  const launchRoot = createRepository(workspaceRoot, 'launch', { withAi1: true });
  assert.equal(describeOwningRepository(join(launchRoot, 'src', 'app.js'), launchRoot).relation, 'launch');
  assert.equal(describeOwningRepository('src/new-file.js', launchRoot).relation, 'launch');
  const worktreeRoot = join(workspaceRoot, 'launch-wt');
  runGit(launchRoot, ['worktree', 'add', '-q', '-b', 'wt/x', worktreeRoot]);
  assert.equal(describeOwningRepository(join(worktreeRoot, 'src', 'app.js'), launchRoot).relation, 'launch');
});

test('a sibling repository is foreign, and says whether it has ai1 [foreign-repo-delegation:S1]', () => {
  const workspaceRoot = createWorkspace();
  const launchRoot = createRepository(workspaceRoot, 'launch', { withAi1: true });
  const siblingRoot = createRepository(workspaceRoot, 'sibling', { withAi1: true });
  const plainRoot = createRepository(workspaceRoot, 'plain');
  assert.deepEqual(describeOwningRepository(join(siblingRoot, 'src', 'app.js'), launchRoot), { repoRoot: siblingRoot, relation: 'foreign', hasAi1: true });
  assert.deepEqual(describeOwningRepository('../plain/src/app.js', launchRoot), { repoRoot: plainRoot, relation: 'foreign', hasAi1: false });
  // a linked worktree of the sibling is the sibling, and reads its main checkout's config
  const siblingWorktree = join(workspaceRoot, 'sibling-wt');
  runGit(siblingRoot, ['worktree', 'add', '-q', '-b', 'wt/y', siblingWorktree]);
  assert.equal(describeOwningRepository(join(siblingWorktree, 'src', 'app.js'), launchRoot).hasAi1, true);
});

test('submodules of the launch repository, nested ones too, are part of it [foreign-repo-delegation:S5]', () => {
  const workspaceRoot = createWorkspace();
  const commonsSource = createRepository(workspaceRoot, 'commons-source');
  const childSource = createRepository(workspaceRoot, 'child-source');
  runGit(childSource, ['submodule', 'add', '-q', commonsSource, 'commons']);
  runGit(childSource, ['commit', '-qm', 'add commons']);
  const superRoot = createRepository(workspaceRoot, 'super', { withAi1: true });
  runGit(superRoot, ['submodule', 'add', '-q', childSource, 'child']);
  runGit(superRoot, ['submodule', 'update', '--init', '--recursive', '-q']);
  assert.equal(describeOwningRepository(join(superRoot, 'child', 'src', 'app.js'), superRoot).relation, 'submodule');
  assert.equal(describeOwningRepository(join(superRoot, 'child', 'commons', 'src', 'app.js'), superRoot).relation, 'submodule');
});

test('outside any launch repository every repository is foreign [foreign-repo-delegation:S6]', () => {
  const workspaceRoot = createWorkspace();
  const siblingRoot = createRepository(workspaceRoot, 'sibling', { withAi1: true });
  assert.deepEqual(describeOwningRepository(join(siblingRoot, 'src', 'app.js'), workspaceRoot), { repoRoot: siblingRoot, relation: 'foreign', hasAi1: true });
  assert.equal(describeOwningRepository(join(workspaceRoot, 'loose.txt'), workspaceRoot), null);
});
