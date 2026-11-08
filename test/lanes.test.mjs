import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { listShellWriteTargets } from '../src/core/shell-writes.mjs';
import { isApprovalMessage } from '../src/lanes/lanes-approval.mjs';
import { createTemporaryProject } from './helpers.mjs';

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createLanesRepo(lanesConfig = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false, lanes: true }, verify: ['npm test'], ...lanesConfig });
  mkdirSync(join(projectRoot, 'src'));
  writeFileSync(join(projectRoot, 'src', 'app.js'), 'console.log(1);\n');
  runGit(projectRoot, ['init', '-q']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return projectRoot;
}

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'jig-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'jig-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function startSession(projectRoot, options, source = 'startup') {
  return runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, options);
}

function sendPrompt(projectRoot, options, promptText) {
  return runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: projectRoot, prompt: promptText }, options);
}

function useTool(projectRoot, options, toolName, toolInput) {
  return runHookEvent('PreToolUse', { session_id: 'session-1', cwd: projectRoot, tool_name: toolName, tool_input: toolInput }, options);
}

function writePlan(projectRoot, slug, status, title = 'Billing export') {
  const planDirectory = join(projectRoot, '.jig', 'work', slug);
  mkdirSync(planDirectory, { recursive: true });
  const planPath = join(planDirectory, 'plan.md');
  writeFileSync(planPath, `---\ntitle: ${title}\nstatus: ${status}\n---\n\n# Goal\nExport invoices.\n`);
  return planPath;
}

const editCode = (projectRoot) => ({ file_path: join(projectRoot, 'src', 'app.js'), old_string: '1', new_string: '2' });

test('lanes-brief: the recipe names the three lanes, the verify command and the deep skill', () => {
  const projectRoot = createLanesRepo();
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /quick: .*run `npm test`/);
  assert.match(contextText, /plan: /);
  assert.match(contextText, /deep: .*\/jig:deep/);
  assert.match(contextText, /lightest lane/);
  assert.equal(readFileSync(join(projectRoot, '.jig', '.gitignore'), 'utf8'), '*\n', '.jig ignores itself');
});

test('lanes-brief: silent on resume, and off unless the repo enables lanes', () => {
  const projectRoot = createLanesRepo();
  assert.doesNotMatch(startSession(projectRoot, hookOptions(), 'resume').hookSpecificOutput.additionalContext, /Lanes:/);
  const plainRepo = createTemporaryProject({ features: { okf: false } });
  assert.doesNotMatch(startSession(plainRepo, hookOptions()).hookSpecificOutput.additionalContext, /Lanes:/);
});

test('lanes-brief: after compaction the active plan comes back with its progress', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  const planPath = writePlan(projectRoot, 'billing', 'approved');
  writeFileSync(join(projectRoot, '.jig', 'work', 'billing', 'progress.md'), 'Step 1 - green - src/export.js\nStep 2 - green - src/csv.js\n');
  const contextText = startSession(projectRoot, options, 'compact').hookSpecificOutput.additionalContext;
  assert.match(contextText, /\.jig\/work\/billing\/plan\.md/);
  assert.match(contextText, /Step 2 - green/);
  assert.match(contextText, /trust these files/);
  assert.ok(existsSync(planPath));
});

test('lanes-brief: an old unfinished plan is listed at startup without its progress', () => {
  const projectRoot = createLanesRepo();
  const planPath = writePlan(projectRoot, 'old-idea', 'draft', 'Old idea');
  utimesSync(planPath, 1_000_000, 1_000_000);
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /old-idea\/plan\.md.*Old idea.*status: draft/);
  assert.match(contextText, /only if the person asks/);
});

test('lanes-gate: a draft design blocks code edits but not the plan or the bundle', () => {
  const projectRoot = createLanesRepo({ knowledge: '.okf' });
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'draft');
  const deniedEdit = useTool(projectRoot, options, 'Edit', editCode(projectRoot));
  assert.equal(deniedEdit.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deniedEdit.hookSpecificOutput.permissionDecisionReason, /not approved by the person/);
  assert.equal(useTool(projectRoot, options, 'Write', { file_path: join(projectRoot, '.jig', 'work', 'billing', 'plan.md'), content: 'x' }), null);
  assert.equal(useTool(projectRoot, options, 'Write', { file_path: join(projectRoot, '.okf', 'decisions', 'x.md'), content: 'x' }), null);
  assert.equal(useTool(projectRoot, options, 'Write', { file_path: '/tmp/scratch.txt', content: 'x' }), null, 'outside the project is not gated');
});

test('lanes-gate: shell writes to code are refused too, reads are not', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'ready');
  assert.equal(useTool(projectRoot, options, 'Bash', { command: "sed -i 's/1/2/' src/app.js" }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'echo x > src/new.js' }).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'cat src/app.js && npm test' }), null);
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'echo step >> .jig/work/billing/progress.md' }), null);
});

test('lanes-gate: a plan written in the file as approved, without the person, still blocks', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'approved');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)).hookSpecificOutput.permissionDecision, 'deny');
});

test('lanes-approval: the person approves a ready design and edits open', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  const planPath = writePlan(projectRoot, 'billing', 'ready');
  const approvalOutput = sendPrompt(projectRoot, options, 'Aprobado, adelante');
  assert.match(approvalOutput.hookSpecificOutput.additionalContext, /approved the design `\.jig\/work\/billing\/plan\.md`/);
  assert.match(readFileSync(planPath, 'utf8'), /status: approved/);
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null);
});

test('lanes-approval: a yes while the design is a draft, or a yes with conditions, approves nothing', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'draft');
  assert.equal(sendPrompt(projectRoot, options, 'sí'), null);
  writePlan(projectRoot, 'billing', 'ready');
  assert.equal(sendPrompt(projectRoot, options, 'vale, pero cambia el paso 2'), null);
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)).hookSpecificOutput.permissionDecision, 'deny');
});

test('lanes-approval: going back to ready asks for a new approval', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'ready');
  sendPrompt(projectRoot, options, 'ok');
  writePlan(projectRoot, 'billing', 'ready');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)).hookSpecificOutput.permissionDecision, 'deny');
  sendPrompt(projectRoot, options, 'go ahead');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null);
});

test('isApprovalMessage: short plain yes only', () => {
  for (const approval of ['aprobado', 'Sí, adelante', 'ok', 'LGTM', 'go ahead', 'dale', 'perfecto, apruebo']) assert.equal(isApprovalMessage(approval), true, approval);
  for (const notApproval of ['no', 'espera', 'ok but use postgres', 'cambia el paso 3', '', 'explícame mejor el enfoque B']) assert.equal(isApprovalMessage(notApproval), false, notApproval);
  assert.equal(isApprovalMessage(`ok ${'x'.repeat(200)}`), false, 'long messages are not a plain yes');
});

test('lanes-gate: finished plans and plans from earlier sessions do not block', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  const oldPlanPath = writePlan(projectRoot, 'old-idea', 'draft');
  utimesSync(oldPlanPath, 1_000_000, 1_000_000);
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'done');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null);
});

test('lanes-escalate: past the size of a quick change it asks once', () => {
  const projectRoot = createLanesRepo({ modules: { 'lanes-escalate': { max_files: 3, max_lines: 1000 } } });
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'a.js'), 'a\n');
  writeFileSync(join(projectRoot, 'src', 'b.js'), 'b\n');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null, '2 files: still quick');
  writeFileSync(join(projectRoot, 'src', 'c.js'), 'c\n');
  const askOutput = useTool(projectRoot, options, 'Edit', editCode(projectRoot));
  assert.equal(askOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(askOutput.hookSpecificOutput.permissionDecisionReason, /changed 3 files .* without a plan/);
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null, 'asked once per session');
});

test('lanes-escalate: lines count too, and an active plan means no question', () => {
  const projectRoot = createLanesRepo({ modules: { 'lanes-escalate': { max_files: 50, max_lines: 10 } } });
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'big.js'), 'line\n'.repeat(20));
  writePlan(projectRoot, 'billing', 'ready');
  sendPrompt(projectRoot, options, 'aprobado');
  assert.equal(useTool(projectRoot, options, 'Edit', editCode(projectRoot)), null);
  const otherProject = createLanesRepo({ modules: { 'lanes-escalate': { max_files: 50, max_lines: 10 } } });
  const otherOptions = hookOptions();
  startSession(otherProject, otherOptions);
  writeFileSync(join(otherProject, 'src', 'big.js'), 'line\n'.repeat(20));
  assert.equal(useTool(otherProject, otherOptions, 'Edit', editCode(otherProject)).hookSpecificOutput.permissionDecision, 'ask');
});

test('listShellWriteTargets: redirects, tee, in-place edits, copies and inline scripts', () => {
  assert.deepEqual(listShellWriteTargets('echo x > a.txt 2>&1').targetPaths, ['a.txt']);
  assert.deepEqual(listShellWriteTargets('printf x | tee -a log.md >/dev/null').targetPaths, ['log.md']);
  assert.deepEqual(listShellWriteTargets("sed -i 's/a/b/' one.js two.js").targetPaths, ['one.js', 'two.js']);
  assert.deepEqual(listShellWriteTargets('cp a.js b.js && mv b.js lib/').targetPaths, ['b.js', 'lib/']);
  assert.deepEqual(listShellWriteTargets('cat a.js; grep -rn x src; npm test').targetPaths, []);
  assert.equal(listShellWriteTargets("python3 - <<'EOF'\nprint(1)\nEOF").runsInlineScript, true);
  assert.equal(listShellWriteTargets('python3 tool.py --check').runsInlineScript, false);
});
