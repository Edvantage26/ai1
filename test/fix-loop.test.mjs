import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fixLoop, { listTestRuns, scanFixAttempts } from '../src/verify/fix-loop.mjs';

let toolUseCounter = 0;

// A transcript built step by step: edits, test runs with their result.
function createTranscript() {
  const transcriptPath = join(mkdtempSync(join(tmpdir(), 'ai1-fix-loop-')), 'session.jsonl');
  writeFileSync(transcriptPath, '');
  const appendEvent = (contentBlock) => appendFileSync(transcriptPath, `${JSON.stringify({ timestamp: new Date().toISOString(), message: { content: [contentBlock] } })}\n`);
  return {
    transcriptPath,
    edit(filePath = 'src/app.js') {
      toolUseCounter += 1;
      appendEvent({ type: 'tool_use', id: `toolu_${toolUseCounter}`, name: 'Edit', input: { file_path: filePath } });
    },
    run(commandLine, outputText) {
      toolUseCounter += 1;
      const toolUseId = `toolu_${toolUseCounter}`;
      appendEvent({ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command: commandLine } });
      appendEvent({ type: 'tool_result', tool_use_id: toolUseId, content: outputText });
    },
  };
}

const PROJECT_ROOT = '/repo';
const FAILING = '# pass 3\n# fail 1';
const PASSING = '# pass 4\n# fail 0';

function runModule(transcript, sessionEnvironment, moduleOptions = {}) {
  return fixLoop.run({
    hookInput: { session_id: 'session-1', transcript_path: transcript.transcriptPath, tool_name: 'Edit' },
    config: { verify: ['npm test'] },
    projectRoot: PROJECT_ROOT,
    environment: sessionEnvironment,
    moduleOptions,
  });
}

const freshEnvironment = () => ({ CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) });

test('fix-loop: the first failure is not an attempt; 3 failed edits in a row fire once, again at 6, then silence', () => {
  const transcript = createTranscript();
  const sessionEnvironment = freshEnvironment();
  transcript.run('node --test test/app.test.mjs', FAILING);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    transcript.edit();
    transcript.run('node --test test/app.test.mjs', FAILING);
    assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', `attempt ${attempt}`);
  }
  transcript.edit();
  transcript.run('node --test test/app.test.mjs 2>&1', FAILING);
  const reminder = runModule(transcript, sessionEnvironment);
  assert.equal(reminder.kind, 'context');
  assert.match(reminder.text, /3 fix attempts in a row have failed \(`node --test test\/app\.test\.mjs` still fails/);
  assert.match(reminder.text, /\/ai1:verify-debug-systematically.*tell the person/);
  assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', 'told once');
  for (let attempt = 4; attempt <= 6; attempt += 1) {
    transcript.edit();
    transcript.run('node --test test/app.test.mjs', FAILING);
  }
  assert.match(runModule(transcript, sessionEnvironment).text, /6 fix attempts/);
  for (let attempt = 7; attempt <= 12; attempt += 1) {
    transcript.edit();
    transcript.run('node --test test/app.test.mjs', FAILING);
  }
  assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', 'silent after the second reminder');
});

test('fix-loop: re-running without editing, a docs edit or another test passing do not count; the same test passing resets', () => {
  const transcript = createTranscript();
  const sessionEnvironment = freshEnvironment();
  transcript.run('pytest -k checkout', FAILING);
  transcript.edit();
  transcript.run('pytest -k checkout', FAILING);
  transcript.run('pytest -k checkout', FAILING);
  transcript.run('pytest -k checkout', FAILING);
  transcript.edit('README.md');
  transcript.run('pytest -k checkout', FAILING);
  transcript.edit();
  transcript.run('pytest -k other', PASSING);
  transcript.run('pytest -k checkout', FAILING);
  assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', 'only 2 real attempts so far');
  transcript.edit();
  transcript.run('pytest -k checkout', PASSING);
  transcript.edit();
  transcript.run('pytest -k checkout', FAILING);
  transcript.edit();
  transcript.run('pytest -k checkout', FAILING);
  assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', 'the pass reset the streak');
});

test('fix-loop: a full verify run passing resets every streak; max_failed_attempts and test_commands are options', () => {
  const transcript = createTranscript();
  const sessionEnvironment = freshEnvironment();
  transcript.run('make check-unit', FAILING);
  transcript.edit();
  transcript.run('make check-unit', FAILING);
  assert.equal(runModule(transcript, sessionEnvironment).kind, 'allow', 'make is not a known runner');
  assert.equal(runModule(transcript, freshEnvironment(), { max_failed_attempts: 1, test_commands: ['^make check'] }).kind, 'context');
  const verifiedTranscript = createTranscript();
  const verifiedEnvironment = freshEnvironment();
  verifiedTranscript.run('node --test test/a.mjs', FAILING);
  verifiedTranscript.edit();
  verifiedTranscript.run('node --test test/a.mjs', FAILING);
  verifiedTranscript.run('npm test', PASSING);
  verifiedTranscript.edit();
  verifiedTranscript.run('node --test test/a.mjs', FAILING);
  assert.equal(runModule(verifiedTranscript, verifiedEnvironment, { max_failed_attempts: 2 }).kind, 'allow');
});

test('listTestRuns: known runners, verify commands and ai1 verify; not other commands', () => {
  const runKeys = (commandLine) => listTestRuns(commandLine, ['npm test']).map((testRun) => testRun.commandKey);
  assert.deepEqual(runKeys('cd app && npm test 2>&1 | tail'), ['npm test', '(verify)']);
  assert.deepEqual(runKeys('npx vitest run src/a.test.ts'), ['npx vitest run src/a.test.ts']);
  assert.deepEqual(runKeys('go test ./pkg/...'), ['go test ./pkg/...']);
  assert.deepEqual(runKeys('ai1 verify'), ['(verify)']);
  assert.deepEqual(runKeys('git status && ls test'), []);
});

test('fix-loop: silent without a transcript', () => {
  const scanState = {};
  assert.equal(scanFixAttempts(undefined, scanState, { projectRoot: PROJECT_ROOT, verifyCommands: [], testRunners: [], ignoredPaths: [] }), false);
  assert.equal(fixLoop.run({ hookInput: { session_id: 's' }, config: {}, projectRoot: PROJECT_ROOT, environment: freshEnvironment(), moduleOptions: {} }).kind, 'allow');
});
