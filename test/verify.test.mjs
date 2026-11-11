import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { verifyCommandsRunBy, didRunFail } from '../src/verify/verify-gate.mjs';
import { runVerifyCommands, recordStepDone, closePlan, describeScenarioCoverage } from '../src/cli/verify-run.mjs';
import { globToRegExp } from '../src/core/path-glob.mjs';
import { createTemporaryProject } from './helpers.mjs';

const SECOND = 1000;

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createVerifyRepo(ai1Config = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false }, verify: ['npm test'], ...ai1Config });
  mkdirSync(join(projectRoot, 'src'));
  writeFileSync(join(projectRoot, 'src', 'app.js'), 'console.log(1);\n');
  writeFileSync(join(projectRoot, 'README.md'), '# demo\n');
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

// A session: starts now; `changeFile` writes a file at a given offset from the start, and
// `transcript` holds an edit by the session followed by Bash runs ending at given offsets.
function startSession(projectRoot, options) {
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, options);
  return Date.now();
}

function changeFile(projectRoot, relativePath, modifiedMilliseconds) {
  const filePath = join(projectRoot, relativePath);
  writeFileSync(filePath, `// changed at ${modifiedMilliseconds}\n`);
  utimesSync(filePath, modifiedMilliseconds / SECOND, modifiedMilliseconds / SECOND);
}

function writeTranscript(options, bashRuns, { sessionEdits = true } = {}) {
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  const editEvents = sessionEdits
    ? [{ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-edit', name: 'Edit', input: { file_path: 'src/app.js' } }] } }]
    : [];
  const runEvents = bashRuns.flatMap(({ command, endMilliseconds, isError = false, output = 'ok' }, runIndex) => [
    { type: 'assistant', timestamp: new Date(endMilliseconds - SECOND).toISOString(), message: { content: [{ type: 'tool_use', id: `tool-${runIndex}`, name: 'Bash', input: { command } }] } },
    { type: 'user', timestamp: new Date(endMilliseconds).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: `tool-${runIndex}`, is_error: isError, content: output }] } },
  ]);
  const transcriptLines = [...editEvents, ...runEvents].map((transcriptEvent) => JSON.stringify(transcriptEvent));
  writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
  return transcriptPath;
}

function stopSession(projectRoot, options, transcriptPath) {
  return runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot, transcript_path: transcriptPath }, options);
}

test('verify-gate: code changed and never verified blocks, naming the file and the command', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const stopOutput = stopSession(projectRoot, options, writeTranscript(options, []));
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /`src\/app\.js`/);
  assert.match(stopOutput.reason, /Run `npm test` as is/);
});

test('verify-gate: a passing run after the last change lets the agent stop', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const transcriptPath = writeTranscript(options, [{ command: 'cd /repo && npm test 2>&1 | tail -20', endMilliseconds: sessionStart + 20 * SECOND }]);
  assert.equal(stopSession(projectRoot, options, transcriptPath), null);
});

test('verify-gate: a change after the passing run needs a new run', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  changeFile(projectRoot, 'src/new.js', sessionStart + 30 * SECOND);
  const stopOutput = stopSession(projectRoot, options, writeTranscript(options, [{ command: 'npm test', endMilliseconds: sessionStart + 20 * SECOND }]));
  assert.match(stopOutput.reason, /`src\/new\.js`/);
  assert.doesNotMatch(stopOutput.reason, /app\.js/, 'only files newer than the run are listed');
});

test('verify-gate: a failed run blocks twice at most, then lets the agent stop', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const transcriptPath = writeTranscript(options, [{ command: 'npm test', endMilliseconds: sessionStart + 20 * SECOND, isError: true, output: 'Exit code 1\n# fail 2' }]);
  assert.match(stopSession(projectRoot, options, transcriptPath).reason, /last run of `npm test` after your changes failed/);
  assert.equal(stopSession(projectRoot, options, transcriptPath).decision, 'block');
  assert.equal(stopSession(projectRoot, options, transcriptPath), null);
});

test('verify-gate: a failure hidden by a pipe is caught from the summary', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const transcriptPath = writeTranscript(options, [{ command: 'npm test | tail -3', endMilliseconds: sessionStart + 20 * SECOND, output: '# pass 120\n# fail 3' }]);
  assert.match(stopSession(projectRoot, options, transcriptPath).reason, /failed/);
});

test('verify-gate: a filtered run does not count, ai1 verify does', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const filteredTranscript = writeTranscript(options, [{ command: 'npm test -- --grep export', endMilliseconds: sessionStart + 20 * SECOND }]);
  assert.equal(stopSession(projectRoot, options, filteredTranscript).decision, 'block');
  const ai1Transcript = writeTranscript(options, [{ command: 'ai1 verify', endMilliseconds: sessionStart + 20 * SECOND }]);
  assert.equal(stopSession(projectRoot, options, ai1Transcript), null);
});

test('verify-gate: docs, harness config and ignore_paths need no verification', () => {
  const projectRoot = createVerifyRepo({ modules: { 'verify-gate': { ignore_paths: ['src/generated/**'] } } });
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'README.md', sessionStart + 10 * SECOND);
  mkdirSync(join(projectRoot, 'src', 'generated'));
  changeFile(projectRoot, 'src/generated/api.js', sessionStart + 10 * SECOND);
  assert.equal(stopSession(projectRoot, options, writeTranscript(options, [])), null);
});

test('verify-gate: changes from before the session, or no verify command, do not block', () => {
  const projectRoot = createVerifyRepo();
  changeFile(projectRoot, 'src/app.js', Date.now() - 3600 * SECOND);
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options, writeTranscript(options, [])), null);
  const unconfiguredRepo = createVerifyRepo({ verify: [] });
  const otherOptions = hookOptions();
  const sessionStart = startSession(unconfiguredRepo, otherOptions);
  changeFile(unconfiguredRepo, 'src/app.js', sessionStart + 10 * SECOND);
  assert.equal(stopSession(unconfiguredRepo, otherOptions, writeTranscript(otherOptions, [])), null);
});

test('verify-gate: a session that only read and ran the verify command is not asked about changes it did not make', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const readOnlyRuns = [
    { command: 'cd /repo && git status --short && grep -rn foo src | head', endMilliseconds: sessionStart + 5 * SECOND },
    { command: 'npm test 2>&1 | tail -3', endMilliseconds: sessionStart + 6 * SECOND, isError: true, output: '# fail 1' },
  ];
  assert.equal(stopSession(projectRoot, options, writeTranscript(options, readOnlyRuns, { sessionEdits: false })), null);
  const writingRepo = createVerifyRepo();
  const writingOptions = hookOptions();
  const writingSessionStart = startSession(writingRepo, writingOptions);
  changeFile(writingRepo, 'src/app.js', writingSessionStart + 6.5 * SECOND);
  const writingRun = { command: 'npx prettier --write src', endMilliseconds: writingSessionStart + 7 * SECOND };
  const writingTranscript = writeTranscript(writingOptions, [writingRun], { sessionEdits: false });
  assert.equal(stopSession(writingRepo, writingOptions, writingTranscript)?.decision, 'block', 'a command that may write counts');
});

test('verify-gate: a file another session changed outside this session\'s write windows is not asked about', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  // This session runs a script (may write) from 2s to 3s and writes a scratch file in /tmp at 4s;
  // another session bumps the version at 20s.
  changeFile(projectRoot, 'src/app.js', sessionStart + 20 * SECOND);
  const runs = [
    { command: 'python3 -I /tmp/scan.py', endMilliseconds: sessionStart + 3 * SECOND },
    { command: 'mkdir -p /tmp/scan && echo hi > /tmp/scan/notes.txt', endMilliseconds: sessionStart + 4 * SECOND },
  ];
  assert.equal(stopSession(projectRoot, options, writeTranscript(options, runs, { sessionEdits: false })), null);
});

test('verify-gate: switched off with the verify feature', () => {
  const projectRoot = createVerifyRepo({ features: { okf: false, verify: false } });
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  assert.equal(stopSession(projectRoot, options, writeTranscript(options, [])), null);
});

test('verifyCommandsRunBy: the full command, with redirects and pipes, in compound verify commands too', () => {
  assert.deepEqual(verifyCommandsRunBy('cd x && npm test 2>&1 | tail -5', ['npm test']), [0]);
  assert.deepEqual(verifyCommandsRunBy('bash -c "npm test > out.txt"', ['npm test']), [0]);
  assert.deepEqual(verifyCommandsRunBy('npm test -- -t foo', ['npm test']), []);
  assert.deepEqual(verifyCommandsRunBy('npm run lint && npm test', ['npm test', 'npm run lint && npm test', 'pytest']), [0, 1]);
  assert.deepEqual(verifyCommandsRunBy('npm test && npm run lint', ['npm run lint && npm test']), [], 'order matters');
  assert.deepEqual(verifyCommandsRunBy('ai1 step-done billing "step 1"', ['npm test', 'pytest']), [0, 1]);
  assert.deepEqual(verifyCommandsRunBy('ai1 plan-done billing', ['npm test']), [0]);
});

test('didRunFail: exit code first, then common failure summaries', () => {
  assert.equal(didRunFail({ is_error: true, content: 'Exit code 1' }), true);
  assert.equal(didRunFail({ content: '# pass 10\n# fail 0' }), false);
  assert.equal(didRunFail({ content: [{ type: 'text', text: 'Tests: 2 failed, 40 passed' }] }), true);
  assert.equal(didRunFail({ content: '=== 3 passed, 0 failed in 1.2s ===' }), false);
  assert.equal(didRunFail({ content: 'FAILED tests/test_api.py::test_login' }), true);
});

test('ai1 verify / step-done: stop at the first failure, log the step only when green', () => {
  const projectRoot = createVerifyRepo();
  mkdirSync(join(projectRoot, '.ai1', 'work', 'billing'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'billing', 'plan.md'), '---\nstatus: approved\n---\n');
  const commandsRun = [];
  const failingSecond = (verifyCommand) => { commandsRun.push(verifyCommand); return verifyCommand === 'pytest' ? 2 : 0; };
  assert.deepEqual(runVerifyCommands(projectRoot, ['npm test', 'pytest', 'npm run lint'], failingSecond), { passed: false, failedCommand: 'pytest', exitCode: 2 });
  assert.deepEqual(commandsRun, ['npm test', 'pytest']);
  assert.throws(() => runVerifyCommands(projectRoot, []), /no verify commands/);
  const progressPath = recordStepDone(projectRoot, 'billing', 'Step 1: export', ['npm test'], '2026-11-08T00:00:00.000Z');
  assert.equal(readFileSync(progressPath, 'utf8'), '- 2026-11-08T00:00:00.000Z Step 1: export - verify green: npm test\n');
  assert.throws(() => recordStepDone(projectRoot, 'missing', 'x', ['npm test']), /no plan/);
});

test('globToRegExp: ** for directories, * within a name, bare names at any depth', () => {
  assert.equal(globToRegExp('*.md').test('docs/a/b.md'), true);
  assert.equal(globToRegExp('.claude/**').test('.claude/settings.json'), true);
  assert.equal(globToRegExp('src/**/*.gen.js').test('src/api.gen.js'), true);
  assert.equal(globToRegExp('src/*.js').test('src/a/b.js'), false);
});

function writeScenarioPlan(projectRoot, planSlug, planStatus, behaviourText) {
  mkdirSync(join(projectRoot, '.ai1', 'work', planSlug), { recursive: true });
  const planPath = join(projectRoot, '.ai1', 'work', planSlug, 'plan.md');
  writeFileSync(planPath, `---\ntitle: Login lock\nstatus: ${planStatus}\n---\n\n# Goal\nLock.\n${behaviourText}`);
  return planPath;
}

const TWO_SCENARIOS = '\n# Behaviour\n- S1: Given 3 failures, when the 4th fails, then it locks.\n- S2: Given a lock, when 15 min pass, then it unlocks.\n';
const passingRun = () => 0;

test('plan-done: an approved plan with every scenario tagged and verify green is closed, with the locations logged', () => {
  const projectRoot = createTemporaryProject();
  const planPath = writeScenarioPlan(projectRoot, 'login-lock', 'approved', TWO_SCENARIOS);
  const repoFiles = ['test/login.test.js'];
  mkdirSync(join(projectRoot, 'test'));
  writeFileSync(join(projectRoot, 'test', 'login.test.js'), "test('locks [login-lock:S1]');\ntest('unlocks [login-lock:S2]');\n");
  const closeResult = closePlan(projectRoot, projectRoot, 'login-lock', ['npm test'], { runCommand: passingRun, repoFiles, recordedAt: '2026-11-09T00:00:00.000Z' });
  assert.equal(closeResult.closed, true);
  assert.match(readFileSync(planPath, 'utf8'), /^status: done$/m);
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'work', 'login-lock', 'progress.md'), 'utf8'),
    '- 2026-11-09T00:00:00.000Z plan done - scenarios 2/2 covered: S1 test/login.test.js:1, S2 test/login.test.js:2 - verify green: npm test\n');
});

test('plan-done: a missing tag, a red verify, duplicates or a plan not approved leave the plan open', () => {
  const projectRoot = createTemporaryProject();
  const planPath = writeScenarioPlan(projectRoot, 'login-lock', 'approved', TWO_SCENARIOS);
  writeFileSync(join(projectRoot, 'login.test.js'), '// [login-lock:S1]\n');
  const commandsRun = [];
  const recordingRun = (verifyCommand) => { commandsRun.push(verifyCommand); return 0; };
  const missingResult = closePlan(projectRoot, projectRoot, 'login-lock', ['npm test'], { runCommand: recordingRun, repoFiles: ['login.test.js'] });
  assert.equal(missingResult.closed, false);
  assert.match(missingResult.message, /\[login-lock:S2\]/);
  assert.deepEqual(commandsRun, [], 'no suite run while a scenario has no test');
  writeFileSync(join(projectRoot, 'login.test.js'), '// [login-lock:S1] [login-lock:S2]\n');
  const redResult = closePlan(projectRoot, projectRoot, 'login-lock', ['npm test'], { runCommand: () => 1, repoFiles: ['login.test.js'] });
  assert.deepEqual(redResult, { closed: false, message: '`npm test` failed (exit 1)' });
  assert.match(readFileSync(planPath, 'utf8'), /^status: approved$/m);
  assert.equal(existsSync(join(projectRoot, '.ai1', 'work', 'login-lock', 'progress.md')), false);
  writeScenarioPlan(projectRoot, 'login-lock', 'approved', `${TWO_SCENARIOS}- S1: again\n`);
  assert.match(closePlan(projectRoot, projectRoot, 'login-lock', ['npm test'], { runCommand: passingRun, repoFiles: [] }).message, /duplicate scenario ids.*S1/);
  writeScenarioPlan(projectRoot, 'login-lock', 'ready', TWO_SCENARIOS);
  assert.match(closePlan(projectRoot, projectRoot, 'login-lock', ['npm test'], { runCommand: passingRun, repoFiles: [] }).message, /the plan is ready, not approved/);
  assert.throws(() => closePlan(projectRoot, projectRoot, 'missing', ['npm test']), /no plan/);
});

test('plan-done: a plan without scenarios, or with None, closes after a green verify', () => {
  const projectRoot = createTemporaryProject();
  const planPath = writeScenarioPlan(projectRoot, 'refactor', 'approved', '\n# Behaviour\nNone - internal refactor\n');
  const closeResult = closePlan(projectRoot, projectRoot, 'refactor', ['npm test'], { runCommand: passingRun, repoFiles: [] });
  assert.deepEqual(closeResult, { closed: true, message: 'plan refactor done (no scenarios; verify green)' });
  assert.match(readFileSync(planPath, 'utf8'), /^status: done$/m);
});

test('plan-done: a plan-lane plan closes without approval after a green verify, and only once', () => {
  const projectRoot = createTemporaryProject();
  mkdirSync(join(projectRoot, '.ai1', 'work', 'csv-export'), { recursive: true });
  const planPath = join(projectRoot, '.ai1', 'work', 'csv-export', 'plan.md');
  writeFileSync(planPath, '---\ntitle: CSV export\nlane: plan\nstatus: active\n---\n\n- [x] 1. writer\n');
  assert.deepEqual(closePlan(projectRoot, projectRoot, 'csv-export', ['npm test'], { runCommand: () => 1, repoFiles: [] }), { closed: false, message: '`npm test` failed (exit 1)' });
  assert.deepEqual(closePlan(projectRoot, projectRoot, 'csv-export', ['npm test'], { runCommand: passingRun, repoFiles: [] }), { closed: true, message: 'plan csv-export done (no scenarios; verify green)' });
  assert.match(readFileSync(planPath, 'utf8'), /^status: done$/m);
  assert.deepEqual(closePlan(projectRoot, projectRoot, 'csv-export', ['npm test'], { runCommand: passingRun, repoFiles: [] }), { closed: false, message: 'the plan is already done' });
});

test('describeScenarioCoverage: covered so far for step-done, nothing for a plan without scenarios', () => {
  const projectRoot = createTemporaryProject();
  writeScenarioPlan(projectRoot, 'login-lock', 'approved', TWO_SCENARIOS);
  writeFileSync(join(projectRoot, 'login.test.js'), '// [login-lock:S2]\n');
  assert.equal(describeScenarioCoverage(projectRoot, projectRoot, 'login-lock', ['login.test.js']), 'scenarios covered so far: 1/2 (missing S1)');
  writeScenarioPlan(projectRoot, 'plain', 'approved', '');
  assert.equal(describeScenarioCoverage(projectRoot, projectRoot, 'plain', []), null);
});
