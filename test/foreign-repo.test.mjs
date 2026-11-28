import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { allowRepository } from '../src/delegate/delegate-state.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function createRepository(parentDirectory, repoName, ai1Config) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'app.js'), 'console.log(1);\n');
  if (ai1Config) {
    mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
    writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify(ai1Config));
  }
  runGit(repoRoot, ['init', '-q']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

// A workspace with a launch repo (ai1 on), a sibling with ai1, a sibling without, and isolated state.
function createWorkspace({ launchConfig = { features: {} } } = {}) {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-foreign-')));
  const launchRoot = launchConfig === null ? workspaceRoot : createRepository(workspaceRoot, 'launch', launchConfig);
  const siblingRoot = createRepository(workspaceRoot, 'sibling', { features: {} });
  const plainRoot = createRepository(workspaceRoot, 'plain');
  const environment = { AI1_DECISION_LOG: '0', CLAUDE_PLUGIN_DATA: join(workspaceRoot, '.plugin-data'), CLAUDE_PROJECT_DIR: launchRoot };
  return { workspaceRoot, launchRoot, siblingRoot, plainRoot, environment };
}

function editPayload(launchRoot, filePath, toolName = 'Edit') {
  return { session_id: 'session-1', hook_event_name: 'PreToolUse', cwd: launchRoot, tool_name: toolName, tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' }, permission_mode: 'bypassPermissions' };
}

function decisionOf(hookOutput) {
  return hookOutput?.hookSpecificOutput?.permissionDecision || null;
}

test('editing a file of a sibling repo with ai1 is refused with the way to delegate it [foreign-repo-delegation:S1]', () => {
  const { launchRoot, siblingRoot, environment } = createWorkspace();
  const hookOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(siblingRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(hookOutput), 'deny', 'a deny is kept in bypass mode');
  const reasonText = hookOutput.hookSpecificOutput.permissionDecisionReason;
  assert.match(reasonText, /^ai1\/foreign-repo:/);
  assert.ok(reasonText.includes(siblingRoot), 'names the other repository');
  assert.ok(reasonText.includes(`ai1 delegate --cwd ${siblingRoot}`), 'gives the command to delegate');
  // a shell write into the sibling counts too
  const shellPayload = { ...editPayload(launchRoot, ''), tool_name: 'Bash', tool_input: { command: `echo x > ${join(siblingRoot, 'notes.txt')}` } };
  assert.equal(decisionOf(runHookEvent('PreToolUse', shellPayload, { environment, reportInternalError: () => {} })), 'deny');
});

test('edits inside the launch repo are untouched, and the sibling can switch the feature off [foreign-repo-delegation:S1]', () => {
  const { launchRoot, environment, workspaceRoot } = createWorkspace();
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(launchRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), null);
  const optedOutRoot = createRepository(workspaceRoot, 'opted-out', { features: { delegate: false } });
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(optedOutRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), null);
});

test('the edited repo decides: the launch repo switching delegate off does not lift the refusal [foreign-repo-delegation:S1]', () => {
  const { launchRoot, siblingRoot, environment } = createWorkspace({ launchConfig: { features: { delegate: false } } });
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(siblingRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), 'deny');
});

test('once the person says the edit must be made here, edits to that repo go through for the session [foreign-repo-delegation:S1]', () => {
  const { launchRoot, siblingRoot, environment } = createWorkspace();
  allowRepository('session-1', siblingRoot, 'hazlo aquí', environment);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(siblingRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), null);
});

test('a repo without ai1 gets one line of context, once per session [foreign-repo-delegation:S5]', () => {
  const { launchRoot, plainRoot, environment } = createWorkspace();
  const firstOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(plainRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(firstOutput), null);
  assert.match(firstOutput.hookSpecificOutput.additionalContext, /without ai1\): read its CLAUDE\.md/);
  const secondOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(plainRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.doesNotMatch(JSON.stringify(secondOutput || {}), /read its CLAUDE\.md/);
});

test('a submodule of the launch repo is part of the project [foreign-repo-delegation:S5]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const childSource = createRepository(workspaceRoot, 'child-source', { features: {} });
  runGit(launchRoot, ['submodule', 'add', '-q', childSource, 'child']);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(launchRoot, 'child', 'src', 'app.js')), { environment, reportInternalError: () => {} })), null);
});

test('launched where ai1 is inactive, an edit of a repo with ai1 is still refused, and nothing else runs [foreign-repo-delegation:S6]', () => {
  const { workspaceRoot, siblingRoot, environment } = createWorkspace({ launchConfig: null });
  const hookOutput = runHookEvent('PreToolUse', editPayload(workspaceRoot, join(siblingRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(hookOutput), 'deny');
  const resetPayload = { ...editPayload(workspaceRoot, ''), tool_name: 'Bash', tool_input: { command: 'git reset --hard' } };
  assert.equal(runHookEvent('PreToolUse', resetPayload, { environment, reportInternalError: () => {} }), null, 'danger stays off where ai1 is inactive');
});

// A sibling with its own rules: a deny on edits under generated/, an ask on `npm install`.
const SIBLING_WITH_RULES = {
  features: {},
  rules: [
    { id: 'no-generated', on: 'edit', action: 'deny', paths: ['generated/**'], message: 'generated/ is rebuilt, never edited.' },
    { id: 'use-pnpm', on: 'bash', action: 'ask', pattern: '^npm install', message: 'this repo uses pnpm.' },
  ],
};

test('a repo allowed here keeps its own rules: its deny refuses, its ask asks even in bypass, also for commands run there [foreign-repo-hot-edits:S1]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const ruledRoot = createRepository(workspaceRoot, 'ruled', SIBLING_WITH_RULES);
  allowRepository('session-1', ruledRoot, 'hazlo aquí', environment);
  const deniedOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(ruledRoot, 'generated', 'api.js'), 'Write'), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(deniedOutput), 'deny');
  assert.match(deniedOutput.hookSpecificOutput.permissionDecisionReason, /\[no-generated\] generated\/ is rebuilt/);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(ruledRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), null, 'an edit no rule matches goes through');
  const installPayload = { ...editPayload(launchRoot, ''), tool_name: 'Bash', tool_input: { command: `cd ${ruledRoot} && npm install left-pad` } };
  const askedOutput = runHookEvent('PreToolUse', installPayload, { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(askedOutput), 'ask', 'the ask of the other repo is kept in bypass mode');
  assert.match(askedOutput.hookSpecificOutput.permissionDecisionReason, /\[use-pnpm\]/);
  const cwdPayload = { ...installPayload, tool_input: { command: 'npm install x' }, cwd: ruledRoot };
  assert.equal(decisionOf(runHookEvent('PreToolUse', cwdPayload, { environment, reportInternalError: () => {} })), 'ask', 'a command whose cwd is in the other repo counts');
  const elsewherePayload = { ...installPayload, tool_input: { command: 'npm install left-pad' } };
  assert.equal(decisionOf(runHookEvent('PreToolUse', elsewherePayload, { environment, reportInternalError: () => {} })), null, 'the other repo\'s rules do not apply to commands run in the launch repo');
});

test('a change to the ai1 config of a repo allowed here asks, even in bypass [foreign-repo-hot-edits:S1]', () => {
  const { workspaceRoot, siblingRoot, environment } = createWorkspace({ launchConfig: null });
  allowRepository('session-1', siblingRoot, 'hazlo aquí', environment);
  const configOutput = runHookEvent('PreToolUse', editPayload(workspaceRoot, join(siblingRoot, '.ai1', 'config.json')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(configOutput), 'ask');
  assert.match(configOutput.hookSpecificOutput.permissionDecisionReason, /configuration of/);
  const resetPayload = { ...editPayload(workspaceRoot, ''), tool_name: 'Bash', tool_input: { command: `git -C ${siblingRoot} reset --hard` } };
  assert.equal(decisionOf(runHookEvent('PreToolUse', resetPayload, { environment, reportInternalError: () => {} })), 'ask', 'its danger applies where the launch folder runs none');
});

test('allowing a repo covers its worktrees too [foreign-repo-hot-edits:S1]', () => {
  const { launchRoot, environment, workspaceRoot } = createWorkspace();
  const ruledRoot = createRepository(workspaceRoot, 'ruled', SIBLING_WITH_RULES);
  const worktreeRoot = join(workspaceRoot, 'ruled-wt');
  runGit(ruledRoot, ['worktree', 'add', '-q', worktreeRoot]);
  allowRepository('session-1', ruledRoot, 'hazlo aquí', environment);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(worktreeRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), null);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(worktreeRoot, 'generated', 'x.js'), 'Write'), { environment, reportInternalError: () => {} })), 'deny');
});
