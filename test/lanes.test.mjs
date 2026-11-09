import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { listShellWriteTargets } from '../src/core/shell-writes.mjs';
import { isApprovalMessage } from '../src/lanes/lanes-approval.mjs';
import { listPlanSlugsWrittenBy } from '../src/lanes/lanes-work.mjs';
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
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
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
  const planDirectory = join(projectRoot, '.ai1', 'work', slug);
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
  assert.match(contextText, /deep: .*\/ai1:lanes-design-before-code/);
  assert.match(contextText, /lightest lane/);
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'work', '.gitignore'), 'utf8'), '*\n', '.ai1/work ignores itself');
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
  writeFileSync(join(projectRoot, '.ai1', 'work', 'billing', 'progress.md'), 'Step 1 - green - src/export.js\nStep 2 - green - src/csv.js\n');
  const contextText = startSession(projectRoot, options, 'compact').hookSpecificOutput.additionalContext;
  assert.match(contextText, /\.ai1\/work\/billing\/plan\.md/);
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
  const projectRoot = createLanesRepo({ knowledge: '.ai1/okf' });
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'draft');
  const deniedEdit = useTool(projectRoot, options, 'Edit', editCode(projectRoot));
  assert.equal(deniedEdit.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(deniedEdit.hookSpecificOutput.permissionDecisionReason, /not approved by the person/);
  assert.equal(useTool(projectRoot, options, 'Write', { file_path: join(projectRoot, '.ai1', 'work', 'billing', 'plan.md'), content: 'x' }), null);
  assert.equal(useTool(projectRoot, options, 'Write', { file_path: join(projectRoot, '.ai1', 'okf', 'decisions', 'x.md'), content: 'x' }), null);
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
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'echo step >> .ai1/work/billing/progress.md' }), null);
});

test('lanes-gate: inline interpreter scripts ask while the design waits, and pass once approved', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  writePlan(projectRoot, 'billing', 'ready');
  const inlineScript = "python3 - <<'EOF'\nopen('src/app.js', 'w').write('x')\nEOF";
  const askedScript = useTool(projectRoot, options, 'Bash', { command: inlineScript });
  assert.equal(askedScript.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(askedScript.hookSpecificOutput.permissionDecisionReason, /inline script/);
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'node -e "console.log(1)"' }).hookSpecificOutput.permissionDecision, 'ask');
  sendPrompt(projectRoot, options, 'aprobado');
  assert.equal(useTool(projectRoot, options, 'Bash', { command: inlineScript }), null);
});

test('lanes-gate: inline scripts pass when no design waits', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(useTool(projectRoot, options, 'Bash', { command: 'python3 -c "print(1)"' }), null);
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
  assert.match(approvalOutput.hookSpecificOutput.additionalContext, /approved the design `\.ai1\/work\/billing\/plan\.md`/);
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
  // Seen on 2026-11-09: a question with a conditional "si" approved a design.
  for (const notApproval of ['o que si hay un error proponga enviar un issue, eso cuadraria?', 'y si lo hacemos en dos pasos', 'ok?', '¿vale así?']) assert.equal(isApprovalMessage(notApproval), false, notApproval);
  for (const approval of ['si', 'sí', 'si adelante con todo', 'Sí, aprobado']) assert.equal(isApprovalMessage(approval), true, approval);
  // "acepto la propuesta" answers the agent's own proposal: a yes, never a request to note it down for later.
  for (const approval of ['acepto la propuesta', 'Aceptado', 'accepted']) assert.equal(isApprovalMessage(approval), true, approval);
  for (const notApproval of ['acepto, pero cambia el paso 2', '¿acepto así?']) assert.equal(isApprovalMessage(notApproval), false, notApproval);
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

test('listShellWriteTargets: a cd earlier in the line moves the relative targets after it', () => {
  assert.deepEqual(listShellWriteTargets("cd /repo && sed -i 's/a/b/' .ai1/work/x/plan.md").targetPaths, ['/repo/.ai1/work/x/plan.md']);
  assert.deepEqual(listShellWriteTargets('echo a > before.txt; cd sub && cd deeper && echo b > after.txt').targetPaths, ['before.txt', 'sub/deeper/after.txt']);
  assert.deepEqual(listShellWriteTargets('cd /repo && cp a.js /tmp/b.js').targetPaths, ['/tmp/b.js'], 'absolute targets stay');
  assert.deepEqual(listShellWriteTargets('cd ~/x && touch a; cd $DIR && touch b').targetPaths, ['a', 'b'], 'unknown directories leave targets as written');
});

test('lanes-gate: from a worktree, cd to the main checkout and write its plan is not refused as a worktree plan', () => {
  const mainRoot = createLanesRepo();
  const worktreeRoot = join(mainRoot, '.claude', 'worktrees', 'feature');
  runGit(mainRoot, ['worktree', 'add', '-q', '-b', 'feature', worktreeRoot]);
  const options = hookOptions();
  const runCommand = (commandLine) => runHookEvent('PreToolUse', {
    session_id: 'session-1', cwd: worktreeRoot, tool_name: 'Bash', tool_input: { command: commandLine },
  }, { ...options, environment: { ...options.environment, CLAUDE_PROJECT_DIR: mainRoot } });
  assert.equal(runCommand(`cd ${mainRoot} && sed -i 's/a/b/' .ai1/work/feature/plan.md`), null);
  assert.equal(runCommand("sed -i 's/a/b/' .ai1/work/feature/plan.md").hookSpecificOutput.permissionDecision, 'deny', 'without the cd it is the worktree plan');
});

// A transcript whose tool calls are `toolUses` ({ name, input }), for a session with that id.
function writeTranscript(options, sessionId, toolUses) {
  const transcriptPath = join(options.homeDirectory, `${sessionId}.jsonl`);
  const transcriptLines = toolUses.map((toolUse, toolIndex) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `${sessionId}-${toolIndex}`, ...toolUse }] } }));
  writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
  return transcriptPath;
}

function runAs(sessionId, transcriptPath, eventName, projectRoot, options, extraInput) {
  return runHookEvent(eventName, { session_id: sessionId, cwd: projectRoot, transcript_path: transcriptPath, ...extraInput }, options);
}

test('lanes: another session\'s new draft does not block this session, and its own draft does', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  const longTranscript = writeTranscript(options, 'long-session', [{ name: 'Read', input: { file_path: join(projectRoot, 'src', 'app.js') } }]);
  runAs('long-session', longTranscript, 'SessionStart', projectRoot, options, { source: 'startup' });
  const otherPlanPath = writePlan(projectRoot, 'prod-guard', 'draft');
  writeTranscript(options, 'other-session', [{ name: 'Write', input: { file_path: otherPlanPath, content: '...' } }]);
  const editByLongSession = { tool_name: 'Edit', tool_input: editCode(projectRoot) };
  assert.equal(runAs('long-session', longTranscript, 'PreToolUse', projectRoot, options, editByLongSession), null);
  const ownPlanPath = writePlan(projectRoot, 'billing', 'draft');
  writeTranscript(options, 'long-session', [
    { name: 'Read', input: { file_path: join(projectRoot, 'src', 'app.js') } },
    { name: 'Write', input: { file_path: ownPlanPath, content: '...' } },
  ]);
  assert.match(runAs('long-session', longTranscript, 'PreToolUse', projectRoot, options, editByLongSession).hookSpecificOutput.permissionDecisionReason, /billing\/plan\.md/);
});

test('lanes-approval: a yes approves this session\'s ready design, never another session\'s', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  const otherPlanPath = writePlan(projectRoot, 'prod-guard', 'ready');
  const thisTranscript = writeTranscript(options, 'this-session', [{ name: 'Read', input: { file_path: otherPlanPath } }]);
  runAs('this-session', thisTranscript, 'SessionStart', projectRoot, options, { source: 'startup' });
  assert.equal(runAs('this-session', thisTranscript, 'UserPromptSubmit', projectRoot, options, { prompt: 'ok' }), null);
  assert.match(readFileSync(otherPlanPath, 'utf8'), /status: ready/);
  const ownPlanPath = writePlan(projectRoot, 'billing', 'ready');
  writeTranscript(options, 'this-session', [
    { name: 'Read', input: { file_path: otherPlanPath } },
    { name: 'Write', input: { file_path: ownPlanPath, content: '...' } },
    { name: 'Bash', input: { command: `sed -i 's/^status: draft$/status: ready/' ${ownPlanPath}` } },
  ]);
  assert.match(runAs('this-session', thisTranscript, 'UserPromptSubmit', projectRoot, options, { prompt: 'ok' }).hookSpecificOutput.additionalContext, /billing\/plan\.md/);
  assert.match(readFileSync(otherPlanPath, 'utf8'), /status: ready/);
});

test('listPlanSlugsWrittenBy: writes to a plan count, reading it does not', () => {
  const planPath = '/repo/.ai1/work/billing/plan.md';
  assert.deepEqual(listPlanSlugsWrittenBy({ name: 'Edit', input: { file_path: planPath } }), ['billing']);
  assert.deepEqual(listPlanSlugsWrittenBy({ name: 'Bash', input: { command: `sed -i 's/a/b/' ${planPath}` } }), ['billing']);
  assert.deepEqual(listPlanSlugsWrittenBy({ name: 'Bash', input: { command: `cat ${planPath}` } }), []);
  assert.deepEqual(listPlanSlugsWrittenBy({ name: 'Read', input: { file_path: planPath } }), []);
  assert.deepEqual(listPlanSlugsWrittenBy({ name: 'Write', input: { file_path: '/repo/.ai1/work/billing/progress.md' } }), []);
});

test('lanes-gate: from a worktree, a plan written in the worktree\'s .ai1/work/ is refused with the main checkout path', () => {
  const mainRoot = createLanesRepo();
  const worktreeRoot = join(mainRoot, '.claude', 'worktrees', 'feature');
  runGit(mainRoot, ['worktree', 'add', '-q', '-b', 'feature', worktreeRoot]);
  const options = hookOptions();
  const writePlan = (planPath) => runHookEvent('PreToolUse', {
    session_id: 'session-1', cwd: worktreeRoot, tool_name: 'Write', tool_input: { file_path: planPath, content: '---\nstatus: draft\n---\n' },
  }, { ...options, environment: { ...options.environment, CLAUDE_PROJECT_DIR: mainRoot } });
  const misplacedOutput = writePlan(join(worktreeRoot, '.ai1', 'work', 'feature', 'plan.md'));
  assert.equal(misplacedOutput.hookSpecificOutput.permissionDecision, 'deny');
  assert.ok(misplacedOutput.hookSpecificOutput.permissionDecisionReason.includes(join(mainRoot, '.ai1', 'work', 'feature', 'plan.md')));
  assert.equal(writePlan(join(mainRoot, '.ai1', 'work', 'feature', 'plan.md')), null, 'the main checkout path is free');
});

function writeScenarioPlan(projectRoot, slug, status) {
  const planPath = writePlan(projectRoot, slug, status);
  writeFileSync(planPath, `${readFileSync(planPath, 'utf8')}\n# Behaviour\n- S1: Given a, when b, then c.\n- S2: Given d, when e, then f.\n`);
  return planPath;
}

test('lanes-gate: a plan with scenarios is not closed by hand - Edit, Write and MultiEdit point to ai1 plan-done', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  const planPath = writeScenarioPlan(projectRoot, 'login-lock', 'approved');
  const planText = readFileSync(planPath, 'utf8');
  const toolInputs = {
    Edit: { file_path: planPath, old_string: 'status: approved', new_string: 'status: done' },
    Write: { file_path: planPath, content: planText.replace('status: approved', 'status: done') },
    MultiEdit: { file_path: planPath, edits: [{ old_string: 'Export invoices.', new_string: 'Export.' }, { old_string: 'status: approved', new_string: "status: 'done'" }] },
  };
  for (const [toolName, toolInput] of Object.entries(toolInputs)) {
    const gateOutput = useTool(projectRoot, options, toolName, toolInput);
    assert.equal(gateOutput?.hookSpecificOutput.permissionDecision, 'deny', toolName);
    assert.match(gateOutput.hookSpecificOutput.permissionDecisionReason, /ai1 plan-done login-lock/);
  }
});

test('lanes-gate: approved scenarios cannot be dropped unless the plan goes back to ready; rewording and plans without scenarios are free', () => {
  const projectRoot = createLanesRepo();
  const options = hookOptions();
  const planPath = writeScenarioPlan(projectRoot, 'login-lock', 'approved');
  const dropScenario = { file_path: planPath, old_string: '- S2: Given d, when e, then f.\n', new_string: '' };
  assert.match(useTool(projectRoot, options, 'Edit', dropScenario).hookSpecificOutput.permissionDecisionReason, /drops approved behaviour scenarios \(S2\)/);
  const toNone = { file_path: planPath, content: readFileSync(planPath, 'utf8').replace(/# Behaviour[\s\S]*$/, '# Behaviour\nNone - changed my mind\n') };
  assert.equal(useTool(projectRoot, options, 'Write', toNone).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(useTool(projectRoot, options, 'Write', { ...toNone, content: toNone.content.replace('status: approved', 'status: ready') }), null);
  assert.equal(useTool(projectRoot, options, 'Edit', { file_path: planPath, old_string: 'then c.', new_string: 'then the account locks.' }), null);
  assert.equal(useTool(projectRoot, options, 'Edit', { file_path: planPath, old_string: '- S2:', new_string: '- S3: Given g, when h, then i.\n- S2:' }), null);
  const plainPlanPath = writePlan(projectRoot, 'billing', 'approved');
  assert.equal(useTool(projectRoot, options, 'Edit', { file_path: plainPlanPath, old_string: 'status: approved', new_string: 'status: done' }), null);
});
