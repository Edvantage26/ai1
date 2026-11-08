import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { verifyCommandsRunBy, didRunFail } from '../src/verify/verify-gate.mjs';
import { runVerifyCommands, recordStepDone } from '../src/cli/verify-run.mjs';
import { globToRegExp } from '../src/core/path-glob.mjs';
import { createTemporaryProject } from './helpers.mjs';

const SECOND = 1000;

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createVerifyRepo(jigConfig = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false }, verify: ['npm test'], ...jigConfig });
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
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'jig-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'jig-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

// A session: starts now; `changeFile` writes a file at a given offset from the start, and
// `transcript` holds Bash runs ending at given offsets.
function startSession(projectRoot, options) {
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, options);
  return Date.now();
}

function changeFile(projectRoot, relativePath, modifiedMilliseconds) {
  const filePath = join(projectRoot, relativePath);
  writeFileSync(filePath, `// changed at ${modifiedMilliseconds}\n`);
  utimesSync(filePath, modifiedMilliseconds / SECOND, modifiedMilliseconds / SECOND);
}

function writeTranscript(options, bashRuns) {
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  const transcriptLines = bashRuns.flatMap(({ command, endMilliseconds, isError = false, output = 'ok' }, runIndex) => [
    { type: 'assistant', timestamp: new Date(endMilliseconds - SECOND).toISOString(), message: { content: [{ type: 'tool_use', id: `tool-${runIndex}`, name: 'Bash', input: { command } }] } },
    { type: 'user', timestamp: new Date(endMilliseconds).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: `tool-${runIndex}`, is_error: isError, content: output }] } },
  ].map((transcriptEvent) => JSON.stringify(transcriptEvent)));
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

test('verify-gate: a filtered run does not count, jig verify does', () => {
  const projectRoot = createVerifyRepo();
  const options = hookOptions();
  const sessionStart = startSession(projectRoot, options);
  changeFile(projectRoot, 'src/app.js', sessionStart + 10 * SECOND);
  const filteredTranscript = writeTranscript(options, [{ command: 'npm test -- --grep export', endMilliseconds: sessionStart + 20 * SECOND }]);
  assert.equal(stopSession(projectRoot, options, filteredTranscript).decision, 'block');
  const jigTranscript = writeTranscript(options, [{ command: 'jig verify', endMilliseconds: sessionStart + 20 * SECOND }]);
  assert.equal(stopSession(projectRoot, options, jigTranscript), null);
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
  assert.deepEqual(verifyCommandsRunBy('jig step-done billing "step 1"', ['npm test', 'pytest']), [0, 1]);
});

test('didRunFail: exit code first, then common failure summaries', () => {
  assert.equal(didRunFail({ is_error: true, content: 'Exit code 1' }), true);
  assert.equal(didRunFail({ content: '# pass 10\n# fail 0' }), false);
  assert.equal(didRunFail({ content: [{ type: 'text', text: 'Tests: 2 failed, 40 passed' }] }), true);
  assert.equal(didRunFail({ content: '=== 3 passed, 0 failed in 1.2s ===' }), false);
  assert.equal(didRunFail({ content: 'FAILED tests/test_api.py::test_login' }), true);
});

test('jig verify / step-done: stop at the first failure, log the step only when green', () => {
  const projectRoot = createVerifyRepo();
  mkdirSync(join(projectRoot, '.jig', 'work', 'billing'), { recursive: true });
  writeFileSync(join(projectRoot, '.jig', 'work', 'billing', 'plan.md'), '---\nstatus: approved\n---\n');
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
