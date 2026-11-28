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

const HOT_SIBLING = { ...SIBLING_WITH_RULES, features: { worktrees: false }, modules: { 'foreign-repo': { hot_max_files: 3 } } };
const HOT_SIBLING_WITH_WORKTREES = { ...HOT_SIBLING, features: {} };

function writeTranscript(transcriptPath, transcriptEvents) {
  writeFileSync(transcriptPath, transcriptEvents.map((transcriptEvent) => `${JSON.stringify(transcriptEvent)}\n`).join(''));
}

function verifyRunEvents(runId, command, endMilliseconds, isError = false) {
  return [
    { type: 'assistant', timestamp: new Date(endMilliseconds - 1000).toISOString(), message: { content: [{ type: 'tool_use', id: runId, name: 'Bash', input: { command } }] } },
    { type: 'user', timestamp: new Date(endMilliseconds).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: runId, is_error: isError, content: isError ? 'failed' : 'ok' }] } },
  ];
}

test('a repo that works in worktrees is hot-edited in a worktree, never in its main checkout; then the stop waits for its verify [foreign-repo-hot-edits:S4]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace({ launchConfig: { features: { verify: false } } });
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING_WITH_WORKTREES);
  const mainCheckoutOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(mainCheckoutOutput), 'deny');
  assert.match(mainCheckoutOutput.hookSpecificOutput.permissionDecisionReason, /ai1 worktree create <name>/);
  const worktreeRoot = join(workspaceRoot, 'hot-wt');
  runGit(hotRoot, ['worktree', 'add', '-q', worktreeRoot]);
  const editedFile = join(worktreeRoot, 'src', 'app.js');
  const worktreeOutput = runHookEvent('PreToolUse', editPayload(launchRoot, editedFile), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(worktreeOutput), null, 'an edit inside one of its worktrees goes through');
  assert.ok(worktreeOutput.hookSpecificOutput.additionalContext.includes(`ai1 verify --cwd ${worktreeRoot}`));
  writeFileSync(editedFile, 'console.log(2);\n');

  const transcriptPath = join(workspaceRoot, 'transcript.jsonl');
  writeTranscript(transcriptPath, []);
  const stopPayload = { session_id: 'session-1', hook_event_name: 'Stop', cwd: launchRoot, transcript_path: transcriptPath };
  const blockedOutput = runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} });
  assert.equal(blockedOutput?.decision, 'block', 'the stop is blocked even with verify off in the launch repo');
  assert.ok(blockedOutput.reason.includes(`ai1 verify --cwd ${worktreeRoot}`));
  assert.equal(runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} })?.decision, undefined, 'asked once per situation');

  writeFileSync(editedFile, 'console.log(3);\n');
  writeTranscript(transcriptPath, verifyRunEvents('verify-1', `ai1 verify --cwd ${worktreeRoot}`, Date.now() + 5000));
  assert.equal(runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} })?.decision, undefined, 'a passing verify there after the last edit lets it stop');
});

test('a failed verify of the hot-edited repo blocks the stop once [foreign-repo-hot-edits:S4]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  const editedFile = join(hotRoot, 'src', 'app.js');
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, editedFile), { environment, reportInternalError: () => {} })), null);
  writeFileSync(editedFile, 'console.log(2);\n');
  const transcriptPath = join(workspaceRoot, 'transcript.jsonl');
  writeTranscript(transcriptPath, verifyRunEvents('verify-1', `cd ${launchRoot} && ai1 verify --cwd ${hotRoot}`, Date.now() + 5000, true));
  const stopPayload = { session_id: 'session-1', hook_event_name: 'Stop', cwd: launchRoot, transcript_path: transcriptPath };
  assert.equal(runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} })?.decision, 'block');
});

test('a repo with hot edits on is edited here without delegating, under its guards, told once to read its CLAUDE.md and bundle [foreign-repo-hot-edits:S2]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  const firstOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(firstOutput), null, 'not refused');
  assert.match(firstOutput.hookSpecificOutput.additionalContext, /Hot edit: .*allows up to 3 files/);
  assert.match(firstOutput.hookSpecificOutput.additionalContext, /Read its CLAUDE\.md and `\.ai1\/okf\/index\.md`/);
  const secondOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'other.js'), 'Write'), { environment, reportInternalError: () => {} });
  assert.doesNotMatch(JSON.stringify(secondOutput || {}), /Hot edit/, 'told once per repo and session');
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'generated', 'x.js'), 'Write'), { environment, reportInternalError: () => {} })), 'deny', 'its rules apply');
});

test('hot edits stop at the cap: a 4th file is refused with the files already changed and the way to delegate [foreign-repo-hot-edits:S3]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  for (const fileName of ['a.js', 'b.js', 'c.js']) {
    assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', fileName), 'Write'), { environment, reportInternalError: () => {} })), null);
  }
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'a.js')), { environment, reportInternalError: () => {} })), null, 'a file already counted does not count twice');
  const cappedOutput = runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'd.js'), 'Write'), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(cappedOutput), 'deny');
  const reasonText = cappedOutput.hookSpecificOutput.permissionDecisionReason;
  assert.match(reasonText, /already changed 3 file\(s\)/);
  assert.ok(reasonText.includes(join(hotRoot, 'src', 'c.js').split('\\').join('/')), 'names the files already changed');
  assert.match(reasonText, /\/ai1:session-delegate-change/);
});

test('without hot_max_files, or with 0, every edit is still delegated [foreign-repo-hot-edits:S2]', () => {
  const { workspaceRoot, launchRoot, siblingRoot, environment } = createWorkspace();
  const offRoot = createRepository(workspaceRoot, 'off', { features: {}, modules: { 'foreign-repo': { hot_max_files: 0 } } });
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(siblingRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), 'deny');
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(offRoot, 'src', 'app.js')), { environment, reportInternalError: () => {} })), 'deny');
});

// A hot repo with its own knowledge bundle: a concept that describes src/app.js.
function addBundle(repoRoot) {
  mkdirSync(join(repoRoot, '.ai1', 'okf', 'features'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Hot bundle\n\n* [Overview](overview.md)\n* [App](features/app.md)\n');
  writeFileSync(join(repoRoot, '.ai1', 'okf', 'overview.md'), '---\ntype: Overview\n---\nHello.\n');
  writeFileSync(join(repoRoot, '.ai1', 'okf', 'features', 'app.md'), '---\ntype: Feature\ntitle: The app\nresource: src/app.js\n---\nPrints 1.\n');
  return join(repoRoot, '.ai1', 'okf', 'features', 'app.md');
}

test('a file of another repo with ai1 names the concept of its bundle that describes it, once; an edit asks to update it', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  const conceptPath = addBundle(hotRoot);
  const readPayload = { session_id: 'session-1', hook_event_name: 'PostToolUse', cwd: launchRoot, tool_name: 'Read', tool_input: { file_path: join(hotRoot, 'src', 'app.js') } };
  const readOutput = runHookEvent('PostToolUse', readPayload, { environment, reportInternalError: () => {} });
  assert.ok(readOutput.hookSpecificOutput.additionalContext.includes(`described there by \`${conceptPath}\` (The app)`));
  assert.doesNotMatch(JSON.stringify(runHookEvent('PostToolUse', readPayload, { environment, reportInternalError: () => {} }) || {}), /described there/, 'once per concept');
  const editOutput = runHookEvent('PostToolUse', { ...readPayload, tool_name: 'Edit' }, { environment, reportInternalError: () => {} });
  assert.match(editOutput.hookSpecificOutput.additionalContext, /you changed .*Update it if the change affects/);
});

test('the bundle files of a hot repo do not count toward its cap', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  const conceptPath = addBundle(hotRoot);
  for (const fileName of ['a.js', 'b.js', 'c.js']) runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', fileName), 'Write'), { environment, reportInternalError: () => {} });
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, conceptPath), { environment, reportInternalError: () => {} })), null);
  assert.equal(decisionOf(runHookEvent('PreToolUse', editPayload(launchRoot, join(hotRoot, 'src', 'd.js'), 'Write'), { environment, reportInternalError: () => {} })), 'deny', 'a 4th code file still is');
});

test('at stop, a changed file whose concept there was not updated is reminded once, and a broken bundle there blocks until fixed', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const hotRoot = createRepository(workspaceRoot, 'hot', HOT_SIBLING);
  const conceptPath = addBundle(hotRoot);
  const editedFile = join(hotRoot, 'src', 'app.js');
  runHookEvent('PreToolUse', editPayload(launchRoot, editedFile), { environment, reportInternalError: () => {} });
  writeFileSync(editedFile, 'console.log(2);\n');
  const transcriptPath = join(workspaceRoot, 'transcript.jsonl');
  writeTranscript(transcriptPath, verifyRunEvents('verify-1', `ai1 verify --cwd ${hotRoot}`, Date.now() + 5000));
  const stopPayload = { session_id: 'session-1', hook_event_name: 'Stop', cwd: launchRoot, transcript_path: transcriptPath };
  const pendingOutput = runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} });
  assert.equal(pendingOutput?.decision, 'block');
  assert.ok(pendingOutput.reason.includes(`\`${editedFile}\` -> \`${conceptPath}\` (The app)`));
  assert.equal(runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} })?.decision, undefined, 'reminded once');

  runHookEvent('PreToolUse', editPayload(launchRoot, conceptPath), { environment, reportInternalError: () => {} });
  writeFileSync(conceptPath, '---\ntitle: The app, no type\nresource: src/app.js\n---\nPrints 2.\n');
  const brokenOutput = runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} });
  assert.equal(brokenOutput?.decision, 'block');
  assert.match(brokenOutput.reason, /validator reports 1 ERROR/);
  writeFileSync(conceptPath, '---\ntype: Feature\ntitle: The app\nresource: src/app.js\n---\nPrints 2.\n');
  assert.equal(runHookEvent('Stop', stopPayload, { environment, reportInternalError: () => {} })?.decision, undefined, 'a fixed bundle and an updated concept let it stop');
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
