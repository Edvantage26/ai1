import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectRoots, findMainCheckout, readGitDirectories } from '../src/core/project-roots.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

// A repo with jig.json and one commit, plus a linked worktree under .claude/worktrees/feature.
function createRepoWithWorktree(jigConfig = { features: { okf: false } }) {
  const mainRoot = realpathSync(mkdtempSync(join(tmpdir(), 'jig-roots-')));
  mkdirSync(join(mainRoot, '.claude'), { recursive: true });
  writeFileSync(join(mainRoot, '.claude', 'jig.json'), JSON.stringify(jigConfig));
  mkdirSync(join(mainRoot, 'src'));
  writeFileSync(join(mainRoot, 'src', 'app.js'), 'console.log(1);\n');
  writeFileSync(join(mainRoot, '.gitignore'), '.claude/worktrees/\n.jig/\n');
  runGit(mainRoot, ['init', '-q']);
  runGit(mainRoot, ['add', '.']);
  runGit(mainRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  const worktreeRoot = join(mainRoot, '.claude', 'worktrees', 'feature');
  runGit(mainRoot, ['worktree', 'add', '-q', '-b', 'wt/feature', worktreeRoot]);
  return { mainRoot, worktreeRoot };
}

test('outside worktrees both roots are the launch directory', () => {
  const { mainRoot } = createRepoWithWorktree();
  assert.deepEqual(resolveProjectRoots({ cwd: mainRoot }, { CLAUDE_PROJECT_DIR: mainRoot }), { projectRoot: mainRoot, sharedRoot: mainRoot });
  assert.deepEqual(resolveProjectRoots({ cwd: join(mainRoot, 'src') }, { CLAUDE_PROJECT_DIR: mainRoot }), { projectRoot: mainRoot, sharedRoot: mainRoot });
});

test('after EnterWorktree the tree root follows cwd and the shared root stays at the main checkout', () => {
  const { mainRoot, worktreeRoot } = createRepoWithWorktree();
  const environment = { CLAUDE_PROJECT_DIR: mainRoot };
  assert.deepEqual(resolveProjectRoots({ cwd: worktreeRoot }, environment), { projectRoot: worktreeRoot, sharedRoot: mainRoot });
  assert.deepEqual(resolveProjectRoots({ cwd: join(worktreeRoot, 'src') }, environment), { projectRoot: worktreeRoot, sharedRoot: mainRoot });
});

test('a session launched inside a worktree keeps it as tree root and finds the main checkout', () => {
  const { mainRoot, worktreeRoot } = createRepoWithWorktree();
  assert.deepEqual(resolveProjectRoots({ cwd: worktreeRoot }, { CLAUDE_PROJECT_DIR: worktreeRoot }), { projectRoot: worktreeRoot, sharedRoot: mainRoot });
  assert.equal(findMainCheckout(worktreeRoot), mainRoot);
  assert.equal(readGitDirectories(worktreeRoot).isLinkedWorktree, true);
  assert.equal(readGitDirectories(mainRoot).isLinkedWorktree, false);
});

test('cwd in another repository does not move the tree root', () => {
  const { mainRoot } = createRepoWithWorktree();
  const { mainRoot: otherRoot } = createRepoWithWorktree();
  assert.deepEqual(resolveProjectRoots({ cwd: otherRoot }, { CLAUDE_PROJECT_DIR: mainRoot }), { projectRoot: mainRoot, sharedRoot: mainRoot });
});

test('a launch folder that is not a repository is kept as is', () => {
  const parentFolder = realpathSync(mkdtempSync(join(tmpdir(), 'jig-parent-')));
  assert.deepEqual(resolveProjectRoots({ cwd: parentFolder }, { CLAUDE_PROJECT_DIR: parentFolder }), { projectRoot: parentFolder, sharedRoot: parentFolder });
});

test('a deep-lane plan in the main checkout gates edits made inside a worktree', () => {
  const { mainRoot, worktreeRoot } = createRepoWithWorktree({ features: { okf: false, lanes: true } });
  const options = {
    environment: { CLAUDE_PROJECT_DIR: mainRoot, CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'jig-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'jig-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: mainRoot, source: 'startup' }, options);
  mkdirSync(join(mainRoot, '.jig', 'work', 'feature'), { recursive: true });
  writeFileSync(join(mainRoot, '.jig', 'work', 'feature', 'plan.md'), '---\ntitle: Feature\nstatus: ready\n---\n# Goal\n');
  const editPayload = {
    session_id: 'session-1', cwd: worktreeRoot, tool_name: 'Edit',
    tool_input: { file_path: join(worktreeRoot, 'src', 'app.js'), old_string: '1', new_string: '2' },
  };
  const deniedOutput = runHookEvent('PreToolUse', editPayload, options);
  assert.equal(deniedOutput.hookSpecificOutput.permissionDecision, 'deny');
  runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: worktreeRoot, prompt: 'aprobado' }, options);
  const allowedOutput = runHookEvent('PreToolUse', editPayload, options);
  assert.notEqual(allowedOutput?.hookSpecificOutput?.permissionDecision, 'deny');
});
