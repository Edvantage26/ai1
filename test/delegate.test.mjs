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
  const environment = { AI1_DECISION_LOG: '0', CLAUDE_PLUGIN_DATA: join(workspaceRoot, '.plugin-data'), PASEO_HOME: join(workspaceRoot, 'no-paseo'), CLAUDE_PROJECT_DIR: launchRoot, CLAUDE_CODE_SESSION_ID: 'caller-session' };
  return { workspaceRoot, launchRoot, targetRoot, environment };
}

// runCommand that runs git for real and answers `claude` with `respond(claudeArguments, options)`.
function fakeRunner(respond) {
  const claudeCalls = [];
  const runCommand = (programName, programArguments, commandOptions = {}) => {
    if (programName === 'claude') {
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
  rememberPermissionMode('caller-session', launchRoot, 'bypassPermissions', environment);
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
  assert.ok(existsSync(join(launchRoot, '.ai1', 'work', 'delegations', `${delegationRecord.session_id}.json`)), 'the result is saved for later reading');
  const [{ programArguments, commandOptions }] = claudeCalls;
  assert.equal(commandOptions.cwd, targetRoot, 'runs in the other repository');
  assert.equal(commandOptions.extraEnvironment.CLAUDE_PROJECT_DIR, targetRoot, 'its hooks resolve the other repository');
  assert.deepEqual(programArguments.slice(0, 3), ['-p', '--output-format', 'json']);
  assert.ok(programArguments.includes('--session-id'));
  assert.equal(programArguments[programArguments.indexOf('--permission-mode') + 1], 'bypassPermissions', 'inherits the caller session\'s mode');
  assert.match(programArguments.at(-1), /Create CHANGELOG\.md[\s\S]*AI1-DELEGATE: done/, 'the brief plus the protocol');
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
