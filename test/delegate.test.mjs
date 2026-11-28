import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { interpretRun, resumeDelegation, startDelegation } from '../src/delegate/delegate-session.mjs';
import { rememberPermissionMode } from '../src/delegate/delegate-state.mjs';
import { runDelegateCommand } from '../src/cli/delegate-command.mjs';
import dangerModule from '../src/guards/danger.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { hashContractSection } from '../src/sizing/joint-plans.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function createRepository(parentDirectory, repoName, ai1Config) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(repoRoot, { recursive: true });
  writeFileSync(join(repoRoot, 'README.md'), 'hello\n');
  if (ai1Config) {
    mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
    writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify(ai1Config));
    writeFileSync(join(repoRoot, '.gitignore'), '.ai1/work/\n');
  }
  runGit(repoRoot, ['init', '-q', '-b', 'main']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

function createWorkspace() {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-delegate-')));
  const launchRoot = createRepository(workspaceRoot, 'launch', { features: {} });
  const targetRoot = createRepository(workspaceRoot, 'target', { features: {} });
  const environment = { AI1_DECISION_LOG: '0', CLAUDE_PLUGIN_DATA: join(workspaceRoot, '.plugin-data'), CLAUDE_PROJECT_DIR: launchRoot, CLAUDE_CODE_SESSION_ID: 'caller-session' };
  return { workspaceRoot, launchRoot, targetRoot, environment };
}

// runCommand that runs git for real and answers `claude` with `respond(claudeArguments, options)`.
function fakeRunner(respond) {
  const claudeCalls = [];
  const runCommand = (programName, programArguments, commandOptions = {}) => {
    if (programName === 'claude' || programName === '/opt/bin/claude-wrapper') {
      claudeCalls.push({ programArguments, commandOptions });
      return respond(programArguments, commandOptions);
    }
    const commandResult = spawnSync(programName, programArguments, { cwd: commandOptions.cwd, encoding: 'utf8' });
    return { status: commandResult.status ?? 1, stdout: commandResult.stdout || '', stderr: commandResult.stderr || '' };
  };
  return { runCommand, claudeCalls };
}

function claudeJson(fields) {
  return { status: 0, stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, permission_denials: [], ...fields }), stderr: '' };
}

function readSessionId(programArguments) {
  const optionIndex = programArguments.findIndex((programArgument) => programArgument === '--session-id' || programArgument === '--resume');
  return programArguments[optionIndex + 1];
}

test('a delegated change runs claude -p in the other repo and reports status, summary, commits and files [foreign-repo-delegation:S2]', () => {
  const { launchRoot, targetRoot, environment } = createWorkspace();
  rememberPermissionMode('caller-session', 'bypassPermissions', environment);
  const briefPath = join(launchRoot, 'brief.md');
  writeFileSync(briefPath, '# Add a changelog\n\nCreate CHANGELOG.md.\n');
  const { runCommand, claudeCalls } = fakeRunner((programArguments, commandOptions) => {
    writeFileSync(join(commandOptions.cwd, 'CHANGELOG.md'), '# Changelog\n');
    runGit(commandOptions.cwd, ['add', 'CHANGELOG.md']);
    runGit(commandOptions.cwd, ['commit', '-qm', 'docs: add changelog']);
    return claudeJson({ session_id: readSessionId(programArguments), result: 'Added CHANGELOG.md and committed it.\nAI1-DELEGATE: done' });
  });
  const exitCode = runDelegateCommand(launchRoot, ['--cwd', targetRoot, '--brief', briefPath], { readOption: (optionName) => ({ '--cwd': targetRoot, '--brief': briefPath })[optionName], environment, runCommand, writeOutput: (outputText) => { claudeCalls.output = outputText; } });
  assert.equal(exitCode, 0);
  const delegationRecord = JSON.parse(claudeCalls.output);
  assert.equal(delegationRecord.status, 'done');
  assert.equal(delegationRecord.summary, 'Added CHANGELOG.md and committed it.');
  assert.equal(delegationRecord.repo, targetRoot);
  assert.deepEqual(delegationRecord.commits.map((delegatedCommit) => [delegatedCommit.branch, delegatedCommit.subject]), [['main', 'docs: add changelog']]);
  assert.deepEqual(delegationRecord.changed_files, ['CHANGELOG.md']);
  assert.ok(existsSync(join(environment.CLAUDE_PLUGIN_DATA, 'state', 'delegations', `${delegationRecord.session_id}.json`)), 'the result is saved in the state directory');
  const [{ programArguments, commandOptions }] = claudeCalls;
  assert.equal(commandOptions.cwd, targetRoot, 'runs in the other repository');
  assert.equal(commandOptions.extraEnvironment.CLAUDE_PROJECT_DIR, targetRoot, 'its hooks resolve the other repository');
  assert.deepEqual(programArguments.slice(0, 3), ['-p', '--output-format', 'json']);
  assert.ok(programArguments.includes('--session-id'));
  assert.equal(programArguments[programArguments.indexOf('--permission-mode') + 1], 'bypassPermissions', 'inherits the caller session\'s mode');
  assert.match(programArguments.at(-1), /Create CHANGELOG\.md[\s\S]*AI1-DELEGATE: done/, 'the brief plus the protocol');
  assert.match(programArguments.at(-1), /If a tool is denied, stop at once/, 'stops early when it lacks permissions');
  assert.match(programArguments.at(-1), /`\.ai1\/work\/` is local scratch/, 'knows the work folder is not committed');
  assert.match(programArguments.at(-1), /last message is the only thing the caller receives[\s\S]*never a reference to an earlier message/, 'the report is self-contained');
});

test('the delegated session knows it is delegated: no nudges for a person, and its verify and open plans reach the record [foreign-repo-hot-edits:S5]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const targetRoot = createRepository(workspaceRoot, 'verified-target', { features: {}, verify: ['npm test'] });
  const transcriptPath = join(workspaceRoot, 'delegated-transcript.jsonl');
  const nudgeModule = { id: 'reuse-check', personOnly: true, event: 'Stop', feature: 'reuse', run: () => ({ kind: 'block', moduleId: 'reuse-check', reason: 'Reuse: judge whether…' }) };
  let nudgeOutput;
  const { runCommand, claudeCalls } = fakeRunner((programArguments, commandOptions) => {
    // The delegated session: its ai1 sees AI1_DELEGATION, writes a plan, runs its verify and stops.
    const childEnvironment = { ...environment, ...commandOptions.extraEnvironment };
    const planDirectory = join(targetRoot, '.ai1', 'work', 'rename-column');
    mkdirSync(planDirectory, { recursive: true });
    writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Rename the column\nstatus: ready\n---\n');
    const now = Date.now();
    writeFileSync(transcriptPath, [
      { type: 'assistant', timestamp: new Date(now - 2000).toISOString(), message: { content: [{ type: 'tool_use', id: 'plan-1', name: 'Write', input: { file_path: join(planDirectory, 'plan.md') } }] } },
      { type: 'assistant', timestamp: new Date(now - 1000).toISOString(), message: { content: [{ type: 'tool_use', id: 'verify-1', name: 'Bash', input: { command: 'npm test' } }] } },
      { type: 'user', timestamp: new Date(now).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'verify-1', is_error: false, content: 'ok' }] } },
    ].map((transcriptEvent) => `${JSON.stringify(transcriptEvent)}\n`).join(''));
    const stopPayload = { session_id: readSessionId(programArguments), hook_event_name: 'Stop', cwd: targetRoot, transcript_path: transcriptPath };
    runHookEvent('Stop', stopPayload, { environment: childEnvironment, reportInternalError: () => {} });
    nudgeOutput = dispatchHookEvent('Stop', stopPayload, { environment: childEnvironment, moduleDefinitions: [nudgeModule], runnableModules: [nudgeModule], reportInternalError: () => {} });
    return claudeJson({ session_id: readSessionId(programArguments), result: 'Planned the rename.\nAI1-DELEGATE: needs-input: ¿apruebas el plan?' });
  });
  const delegationRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Rename the column', launchRoot, callerSessionId: 'caller-session', environment, runCommand });
  assert.equal(claudeCalls[0].commandOptions.extraEnvironment.AI1_DELEGATION, delegationRecord.session_id, 'the delegated session is told it is delegated');
  assert.equal(nudgeOutput, null, 'a nudge meant for the person stays silent there');
  assert.equal(delegationRecord.verify, 'passed');
  assert.deepEqual(delegationRecord.open_plans.map((openPlan) => [openPlan.slug, openPlan.status]), [['rename-column', 'ready']]);
  assert.equal(delegationRecord.status, 'needs-input', 'the status the agent wrote stays next to what ai1 reports');
  const shownOutput = [];
  runDelegateCommand(launchRoot, ['show', delegationRecord.session_id], { environment, writeOutput: (outputText) => shownOutput.push(outputText) });
  assert.match(shownOutput.join('\n'), /"verify": "passed"/);
});

test('a design session for a joint plan gets the design-only protocol and returns its sub-plan, linked back and pinned to the contract [joint-plans:S1]', () => {
  const { workspaceRoot, launchRoot, environment } = createWorkspace();
  const engineRoot = createRepository(workspaceRoot, 'engine', { features: {} });
  const jointPlanDirectory = join(launchRoot, '.ai1', 'work', 'tenant-options');
  mkdirSync(jointPlanDirectory, { recursive: true });
  const jointPlanPath = join(jointPlanDirectory, 'plan.md');
  writeFileSync(jointPlanPath, '---\ntitle: Tenant options\nstatus: draft\n---\n# Goal\nX.\n\n# Contract\nPOST /chat accepts `tenant_options`.\n');
  const contractHash = hashContractSection(readFileSync(jointPlanPath, 'utf8'));
  const subplanPath = join(engineRoot, '.ai1', 'work', 'tenant-options', 'plan.md');
  const transcriptPath = join(workspaceRoot, 'design-transcript.jsonl');
  const { runCommand, claudeCalls } = fakeRunner((programArguments, commandOptions) => {
    const promptText = programArguments.at(-1);
    assert.match(promptText, /Design only: .*change no code/);
    assert.ok(promptText.includes(`at \`${subplanPath}\``), 'names where the sub-plan goes: the main checkout');
    assert.ok(promptText.includes(`\`parent: ${jointPlanPath}\``) && promptText.includes(`\`contract: ${contractHash}\``));
    assert.match(promptText, /Objections to the contract:/);
    mkdirSync(join(engineRoot, '.ai1', 'work', 'tenant-options'), { recursive: true });
    writeFileSync(subplanPath, `---\ntitle: Engine part\nsize: plan\nstatus: ready\nparent: ${jointPlanPath}\ncontract: ${contractHash}\n---\n# Steps\n- [ ] 1. Accept it.\n`);
    writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: subplanPath } }] } })}\n`);
    runHookEvent('Stop', { session_id: readSessionId(programArguments), hook_event_name: 'Stop', cwd: engineRoot, transcript_path: transcriptPath }, { environment: { ...environment, ...commandOptions.extraEnvironment }, reportInternalError: () => {} });
    return claudeJson({ session_id: readSessionId(programArguments), result: 'Sub-plan written.\nObjections to the contract: none\nAI1-DELEGATE: done' });
  });
  const briefPath = join(workspaceRoot, 'engine-brief.md');
  writeFileSync(briefPath, '# Engine part of tenant options\n');
  const shownOutput = [];
  runDelegateCommand(launchRoot, ['--cwd', engineRoot, '--brief', briefPath, '--design', '--joint', jointPlanPath], { readOption: (optionName) => ({ '--cwd': engineRoot, '--brief': briefPath, '--joint': jointPlanPath })[optionName], environment, runCommand, writeOutput: (outputText) => shownOutput.push(outputText) });
  assert.equal(claudeCalls.length, 1);
  const delegationRecord = JSON.parse(shownOutput.join('\n'));
  assert.equal(delegationRecord.status, 'done');
  assert.equal(delegationRecord.design_for, jointPlanPath);
  assert.deepEqual(delegationRecord.open_plans.map((openPlan) => [openPlan.path, openPlan.status, openPlan.parent, openPlan.contract]), [[subplanPath, 'ready', jointPlanPath, contractHash]]);
  assert.throws(() => runDelegateCommand(launchRoot, ['--cwd', engineRoot, '--design'], { readOption: (optionName) => ({ '--cwd': engineRoot })[optionName], environment, runCommand, writeOutput: () => {} }), /--design and --joint/);
});

test('a question stops the delegated session and the answer resumes the same one [foreign-repo-delegation:S3]', () => {
  const { launchRoot, targetRoot, environment } = createWorkspace();
  let turnNumber = 0;
  const { runCommand, claudeCalls } = fakeRunner((programArguments) => {
    turnNumber += 1;
    return claudeJson({ session_id: readSessionId(programArguments), result: turnNumber === 1 ? 'I need a decision.\nAI1-DELEGATE: needs-input: ¿borro la columna o la marco como obsoleta?' : 'Marked it obsolete.\nAI1-DELEGATE: done' });
  });
  const firstRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Clean the old column', launchRoot, callerSessionId: 'caller-session', environment, runCommand });
  assert.equal(firstRecord.status, 'needs-input');
  assert.equal(firstRecord.question, '¿borro la columna o la marco como obsoleta?');
  const secondRecord = resumeDelegation({ sessionId: firstRecord.session_id, answerText: 'márcala como obsoleta', launchRoot, environment, runCommand });
  assert.equal(secondRecord.status, 'done');
  assert.equal(secondRecord.session_id, firstRecord.session_id);
  const resumeArguments = claudeCalls[1].programArguments;
  assert.equal(resumeArguments[resumeArguments.indexOf('--resume') + 1], firstRecord.session_id, 'resumes the same session');
  assert.match(resumeArguments.at(-1), /The person answered: márcala como obsoleta/);
  assert.match(resumeArguments.at(-1), /complete report in your last message/, 'a resumed run also ends with the whole report');
});

test('a guard that asked shows as blocked; a confirmed command is allowed once in that session [foreign-repo-delegation:S3]', () => {
  const { launchRoot, targetRoot, environment } = createWorkspace();
  const blockedCommand = 'git reset --hard HEAD~1';
  const { runCommand, claudeCalls } = fakeRunner((programArguments) => claudeJson({
    session_id: readSessionId(programArguments),
    result: claudeCalls.length === 1 ? 'The guard refused the reset.' : 'Reset done.\nAI1-DELEGATE: done',
    permission_denials: claudeCalls.length === 1 ? [{ tool_name: 'Bash', tool_use_id: 'toolu_1', tool_input: { command: blockedCommand } }] : [],
  }));
  const firstRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Undo the last commit', launchRoot, callerSessionId: 'caller-session', environment, runCommand });
  assert.equal(firstRecord.status, 'blocked');
  assert.match(firstRecord.question, /git reset --hard HEAD~1/);
  assert.deepEqual(firstRecord.denied, [{ tool: 'Bash', subject: blockedCommand }]);

  resumeDelegation({ sessionId: firstRecord.session_id, answerText: 'sí, hazlo', allowOnceSubject: blockedCommand, launchRoot, environment, runCommand });
  const dangerInput = { hookInput: { session_id: firstRecord.session_id, cwd: targetRoot, tool_name: 'Bash', tool_input: { command: blockedCommand } }, projectRoot: targetRoot, moduleOptions: {}, environment };
  assert.equal(dangerModule.run(dangerInput).kind, 'allow', 'the confirmed command goes through once');
  assert.equal(dangerModule.run(dangerInput).kind, 'ask', 'and asks again the next time');
});

test('a run without a JSON result or a status line is failed, with what is known [foreign-repo-delegation:S2]', () => {
  assert.equal(interpretRun({ status: 1, stdout: '', stderr: 'boom' }).status, 'failed');
  assert.match(interpretRun({ status: 1, stdout: '', stderr: 'boom' }).summary, /boom/);
  assert.equal(interpretRun(claudeJson({ result: 'I did something, no status line' })).status, 'failed');
  assert.equal(interpretRun(claudeJson({ is_error: true, result: 'auth failed' })).status, 'failed');
});

test('ai1 delegate allow records the person\'s words for this session [foreign-repo-delegation:S1]', () => {
  const { launchRoot, targetRoot, environment } = createWorkspace();
  let printedText = '';
  runDelegateCommand(launchRoot, ['allow', targetRoot, '--because', 'hazlo aquí'], { readOption: (optionName) => (optionName === '--because' ? 'hazlo aquí' : undefined), environment, writeOutput: (outputText) => { printedText = outputText; } });
  assert.deepEqual(JSON.parse(printedText), { allowed: targetRoot, because: 'hazlo aquí', session_id: 'caller-session' });
  const stateFiles = execFileSync('ls', [join(environment.CLAUDE_PLUGIN_DATA, 'state')], { encoding: 'utf8' });
  assert.match(stateFiles, /delegate-allow/);
  assert.match(readFileSync(join(environment.CLAUDE_PLUGIN_DATA, 'state', stateFiles.split('\n').find((fileName) => fileName.includes('delegate-allow'))), 'utf8'), /hazlo aquí/);
});

test('Claude is started with the given command, from --claude-command or AI1_CLAUDE_COMMAND, and a resume reuses it [foreign-repo-delegation:S2]', () => {
  const { launchRoot, targetRoot, environment } = createWorkspace();
  const programsRun = [];
  const { runCommand } = fakeRunner(() => claudeJson({ session_id: 'x', result: 'Need one thing.\nAI1-DELEGATE: needs-input: ¿sigo?' }));
  const recordingRunner = (programName, programArguments, commandOptions) => {
    if (programName !== 'git') programsRun.push([programName, ...programArguments.slice(0, 2)]);
    return runCommand(programName, programArguments, commandOptions);
  };
  const firstRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Do it', claudeCommand: '/opt/bin/claude-wrapper --account work', launchRoot, callerSessionId: 'caller-session', environment, runCommand: recordingRunner });
  resumeDelegation({ sessionId: firstRecord.session_id, answerText: 'sí', launchRoot, environment, runCommand: recordingRunner });
  startDelegation({ targetDirectory: targetRoot, taskText: 'Do it', launchRoot, callerSessionId: 'caller-session', environment: { ...environment, AI1_CLAUDE_COMMAND: '/opt/bin/claude-wrapper' }, runCommand: recordingRunner });
  startDelegation({ targetDirectory: targetRoot, taskText: 'Do it', launchRoot, callerSessionId: 'caller-session', environment, runCommand: recordingRunner });
  assert.deepEqual(programsRun, [
    ['/opt/bin/claude-wrapper', '--account', 'work'],
    ['/opt/bin/claude-wrapper', '--account', 'work'],
    ['/opt/bin/claude-wrapper', '-p', '--output-format'],
    ['claude', '-p', '--output-format'],
  ]);
});

test('from a Bash call (no CLAUDE_PROJECT_DIR, another folder) the mode the hook saw is inherited and the run can be resumed [foreign-repo-delegation:S3]', async () => {
  const { launchRoot, targetRoot, environment, workspaceRoot } = createWorkspace();
  const foreignRepoModule = (await import('../src/delegate/foreign-repo.mjs')).default;
  // the hook sees the session launched in launchRoot and records its mode when it refuses an edit
  foreignRepoModule.run({ hookInput: { session_id: 'caller-session', cwd: launchRoot, tool_name: 'Edit', tool_input: { file_path: join(targetRoot, 'README.md') }, permission_mode: 'bypassPermissions' }, projectRoot: launchRoot, config: { features: {} }, environment });
  const bashEnvironment = { ...environment };
  delete bashEnvironment.CLAUDE_PROJECT_DIR;
  let turnNumber = 0;
  const { runCommand, claudeCalls } = fakeRunner((programArguments) => {
    turnNumber += 1;
    return claudeJson({ session_id: readSessionId(programArguments), result: turnNumber === 1 ? 'Q\nAI1-DELEGATE: needs-input: ¿sigo?' : 'Done.\nAI1-DELEGATE: done' });
  });
  const firstRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Do it', callerSessionId: 'caller-session', environment: bashEnvironment, runCommand });
  assert.equal(firstRecord.permission_mode, 'bypassPermissions');
  assert.equal(claudeCalls[0].programArguments[claudeCalls[0].programArguments.indexOf('--permission-mode') + 1], 'bypassPermissions');
  const outputs = [];
  runDelegateCommand(workspaceRoot, ['--resume', firstRecord.session_id, 'sí'], { readOption: (optionName) => (optionName === '--resume' ? firstRecord.session_id : undefined), environment: bashEnvironment, runCommand, writeOutput: (outputText) => outputs.push(outputText) });
  assert.equal(JSON.parse(outputs[0]).status, 'done', 'resumed from another folder');
});

test('resume takes --permission-mode, and a run without any mode says so in the result [foreign-repo-delegation:S3]', () => {
  const { targetRoot, environment } = createWorkspace();
  const { runCommand, claudeCalls } = fakeRunner((programArguments) => claudeJson({ session_id: readSessionId(programArguments), result: 'Blocked.', permission_denials: claudeCalls.length === 1 ? [{ tool_name: 'Write', tool_input: { file_path: '/x' } }] : [] }));
  const firstRecord = startDelegation({ targetDirectory: targetRoot, taskText: 'Do it', callerSessionId: 'unknown-session', environment, runCommand });
  assert.equal(firstRecord.permission_mode, null);
  assert.match(firstRecord.warning, /no permission mode/);
  const secondRecord = resumeDelegation({ sessionId: firstRecord.session_id, answerText: 'sigue', permissionMode: 'bypassPermissions', environment, runCommand });
  const resumeArguments = claudeCalls[1].programArguments;
  assert.equal(resumeArguments[resumeArguments.indexOf('--permission-mode') + 1], 'bypassPermissions');
  assert.equal(secondRecord.permission_mode, 'bypassPermissions');
  assert.equal(secondRecord.warning, undefined);
});
