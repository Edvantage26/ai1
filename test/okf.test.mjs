import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, existsSync, readdirSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { shellCommandWritesBundle } from '../src/okf/okf-session-scan.mjs';
import { runBundleValidator } from '../src/okf/okf-validator.mjs';
import { createTemporaryProject } from './helpers.mjs';

const V01_INDEX = "---\nokf_version: '0.1'\n---\n\n# Demo bundle\n\n* [Overview](overview.md)\n";
const V02_INDEX = '---\nokf_version: "0.2"\n---\n\n# Demo bundle\n\n* [Overview](overview.md)\n';

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function setModifiedSeconds(filePath, epochSeconds) {
  utimesSync(filePath, epochSeconds, epochSeconds);
}

// A committed repo with a bundle whose files are dated `bundleEpochSeconds`.
function createRepoWithBundle({ indexText = V02_INDEX, ai1Config = {}, bundleEpochSeconds = 1_000_000 } = {}) {
  const projectRoot = createTemporaryProject(ai1Config);
  mkdirSync(join(projectRoot, '.ai1', 'okf'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), indexText);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'overview.md'), '---\ntype: Overview\n---\nHello.\n');
  mkdirSync(join(projectRoot, 'src'));
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(1)\n');
  runGit(projectRoot, ['init', '-q']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  for (const bundleFile of readdirSync(join(projectRoot, '.ai1', 'okf'))) setModifiedSeconds(join(projectRoot, '.ai1', 'okf', bundleFile), bundleEpochSeconds);
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf'), bundleEpochSeconds);
  return projectRoot;
}

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function startSession(projectRoot, options, sessionId = 'session-1') {
  return runHookEvent('SessionStart', { session_id: sessionId, cwd: projectRoot }, options);
}

function stopSession(projectRoot, options, extraInput = {}, sessionId = 'session-1') {
  return runHookEvent('Stop', { session_id: sessionId, cwd: projectRoot, ...extraInput }, options);
}

test('okf-index loads the bundle index with v0.2 maintenance rules', () => {
  const projectRoot = createRepoWithBundle();
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /OKF bundle at `\.ai1\/okf\/` \(spec 0\.2\)/);
  assert.match(contextText, /# Demo bundle/);
  assert.match(contextText, /generated: \{ by: claude-code\/<model>, at: <now> \}/);
  assert.match(contextText, /date -u/);
  assert.match(contextText, /\/ai1:okf-validate-bundle \.ai1\/okf/);
  assert.match(contextText, /only for lifecycle events/);
  assert.doesNotMatch(contextText, /Do NOT migrate/);
});

test('a v0.1 bundle is told not to migrate on its own', () => {
  const projectRoot = createRepoWithBundle({ indexText: V01_INDEX });
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /spec 0\.1/);
  assert.match(contextText, /Do NOT migrate the bundle on your own/);
  assert.match(contextText, /REPLACE its `timestamp:` line with `generated`/);
});

test('okf enabled without a bundle suggests creating one', () => {
  const projectRoot = createTemporaryProject({});
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /no bundle at `\.ai1\/okf\/index\.md`/);
  assert.match(contextText, /\/ai1:okf-maintain-knowledge/);
});

test('features.okf false turns both OKF modules off', () => {
  const projectRoot = createRepoWithBundle({ ai1Config: { features: { okf: false } } });
  const options = hookOptions();
  const contextText = startSession(projectRoot, options).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(contextText, /OKF bundle/);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.equal(stopSession(projectRoot, options), null);
});

test('a retired custom knowledge path is ignored with a notice; the bundle stays .ai1/okf', () => {
  const projectRoot = createRepoWithBundle({ ai1Config: { knowledge: 'docs/kb' } });
  const options = { ...hookOptions(), reportInternalError: () => {} };
  const contextText = startSession(projectRoot, options).hookSpecificOutput.additionalContext;
  assert.match(contextText, /sets "knowledge": "docs\/kb", which ai1 no longer supports/);
  assert.match(contextText, /--- \.ai1\/okf\/index\.md ---/);
});

test('okf-upkeep: nothing changed, nothing asked', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null);
});

test('okf-upkeep: a code change after the last bundle update blocks once', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  const firstStop = stopSession(projectRoot, options);
  assert.equal(firstStop.decision, 'block');
  assert.match(firstStop.reason, /^ai1\/okf-upkeep: OKF: this session left knowledge newer/);
  assert.match(firstStop.reason, /- src\/app\.py/);
  assert.match(firstStop.reason, /you will not be asked again/);
  assert.equal(stopSession(projectRoot, options), null, 'same pending set is not asked twice');
  writeFileSync(join(projectRoot, 'src', 'new_module.py'), 'x = 1\n');
  assert.equal(stopSession(projectRoot, options).decision, 'block', 'a new change asks again');
});

test('okf-upkeep: the reminder names the concepts that describe the changed files', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), '---\ntype: Component\ntitle: App\nresource: src/app.py\n---\nThe app.\n');
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf', 'app.md'), 1_000_000);
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.match(stopSession(projectRoot, options).reason, /Concepts that describe those files \(probably affected\): `\.ai1\/okf\/app\.md`\./);
  rmSync(join(projectRoot, 'src', 'app.py'));
  assert.match(stopSession(projectRoot, options).reason, /- src\/app\.py \(deleted\)[\s\S]*probably affected\): `\.ai1\/okf\/app\.md`/, 'a deleted file still maps');
});

test('okf-upkeep: updating the bundle after the change clears it', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  setModifiedSeconds(join(projectRoot, 'src', 'app.py'), 2_000_000);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'overview.md'), '---\ntype: Overview\n---\nHello, updated.\n');
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf', 'overview.md'), 3_000_000);
  assert.equal(stopSession(projectRoot, options), null);
});

test('okf-upkeep: harness configuration files never ask', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), '{}\n');
  writeFileSync(join(projectRoot, '.ai1', 'config.json'), '{"features":{"okf":true}}\n');
  assert.equal(stopSession(projectRoot, options), null);
});

test('okf-upkeep: a plan in .ai1/work/ never asks, even without its own .gitignore', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  mkdirSync(join(projectRoot, '.ai1', 'work', 'feature'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'work', 'feature', 'plan.md'), '---\nstatus: draft\n---\n');
  assert.equal(stopSession(projectRoot, options), null);
});

test('okf-upkeep: stop_hook_active never blocks again', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.equal(stopSession(projectRoot, options, { stop_hook_active: true }), null);
});

test('okf-upkeep: a project memory saved in the session asks to move it to the bundle', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const memoryDirectory = join(options.homeDirectory, '.claude', 'projects', projectRoot.replace(/[/.]/g, '-'), 'memory');
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(join(memoryDirectory, 'project_finding.md'), '---\nname: finding\nmetadata:\n  originSessionId: session-1\n---\nA fact.\n');
  writeFileSync(join(memoryDirectory, 'MEMORY.md'), '- index\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /- project_finding\.md/);
  assert.doesNotMatch(stopOutput.reason, /- MEMORY\.md/);
});

test('okf-upkeep: a v0.1 bundle reminder keeps the no-migration rule', () => {
  const projectRoot = createRepoWithBundle({ indexText: V01_INDEX });
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.match(stopSession(projectRoot, options).reason, /Do NOT migrate the bundle on your own/);
});

test('okf-upkeep: a session that never ran SessionStart starts counting at its first stop', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  assert.equal(stopSession(projectRoot, options), null);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.equal(stopSession(projectRoot, options).decision, 'block');
});

test('okf-upkeep: uncommitted changes from before the session are not asked about', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  setModifiedSeconds(join(projectRoot, 'src', 'app.py'), Date.now() / 1000 - 3600);
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null);
});

function writeSessionTranscript(options, toolUses) {
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  const transcriptLines = toolUses.map((toolUse, toolIndex) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `tool-${toolIndex}`, ...toolUse }] } }));
  writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
  return transcriptPath;
}

test('okf-upkeep: changes made by another session are not asked about when this one only read', () => {
  const projectRoot = createRepoWithBundle();
  const readingOptions = hookOptions();
  const editingOptions = hookOptions();
  startSession(projectRoot, readingOptions, 'reading-session');
  startSession(projectRoot, editingOptions, 'editing-session');
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  const readOnlyTranscript = writeSessionTranscript(readingOptions, [
    { name: 'Read', input: { file_path: join(projectRoot, 'src', 'app.py') } },
    { name: 'Bash', input: { command: 'git diff --stat && cat src/app.py' } },
  ]);
  assert.equal(stopSession(projectRoot, readingOptions, { transcript_path: readOnlyTranscript }, 'reading-session'), null);
  const editingTranscript = writeSessionTranscript(editingOptions, [{ name: 'Edit', input: { file_path: join(projectRoot, 'src', 'app.py') } }]);
  assert.equal(stopSession(projectRoot, editingOptions, { transcript_path: editingTranscript }, 'editing-session').decision, 'block');
});

test('okf-upkeep: a file another session changed while this one was not writing is not asked about', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const scriptStart = Date.now();
  // This session ran a script that may write (scriptStart to +1s); another session changed app.py at +60s.
  const appPath = join(projectRoot, 'src', 'app.py');
  writeFileSync(appPath, 'print(2)\n');
  utimesSync(appPath, (scriptStart + 60000) / 1000, (scriptStart + 60000) / 1000);
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  writeFileSync(transcriptPath, [
    { timestamp: new Date(scriptStart).toISOString(), message: { content: [{ type: 'tool_use', id: 'script', name: 'Bash', input: { command: 'python3 -I /tmp/scan.py' } }] } },
    { timestamp: new Date(scriptStart + 1000).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'script', content: 'ok' }] } },
  ].map((transcriptEvent) => JSON.stringify(transcriptEvent)).join('\n') + '\n');
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null);
});

test('okf-upkeep: outside a git repo it fails open', () => {
  const projectRoot = createTemporaryProject({});
  mkdirSync(join(projectRoot, '.ai1', 'okf'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), V02_INDEX);
  const reportedErrors = [];
  const stopOutput = runHookEvent('Stop', { session_id: 's', cwd: projectRoot }, {
    ...hookOptions(),
    reportInternalError: (errorMessage) => reportedErrors.push(errorMessage),
  });
  assert.equal(stopOutput, null);
  assert.ok(existsSync(join(projectRoot, '.ai1', 'okf', 'index.md')));
});

const BROKEN_CONCEPT = '---\ntitle: No type here\n---\nA concept without `type` is an OKF error.\n';

test('validation: a bundle edited in the session with an ERROR blocks with the errors', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  const stopOutput = stopSession(projectRoot, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /validator reports 1 ERROR/);
  assert.match(stopOutput.reason, /broken\.md/);
  assert.equal(stopSession(projectRoot, options), null, 'the same errors are not reported twice');
});

test('validation: runs even when the agent was already stopped once (stop_hook_active)', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  assert.equal(stopSession(projectRoot, options, { stop_hook_active: true }).decision, 'block');
});

test('validation: v0.1 legacy warnings never block', () => {
  const projectRoot = createRepoWithBundle({ indexText: V01_INDEX });
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'overview.md'), "---\ntype: Overview\ntimestamp: '2026-01-01T00:00:00Z'\n---\nUpdated.\n");
  assert.equal(stopSession(projectRoot, options), null);
});

test('validation: an untouched bundle is not validated', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf', 'broken.md'), 1_000_000);
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null);
});

test('validation: the upkeep reminder comes first, validation on the next stop', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  assert.match(stopSession(projectRoot, options).reason, /left knowledge newer/);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  assert.match(stopSession(projectRoot, options, { stop_hook_active: true }).reason, /validator reports 1 ERROR/);
});

test('validation: at most three validation blocks per session', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
    writeFileSync(join(projectRoot, '.ai1', 'okf', `broken-${attemptNumber}.md`), BROKEN_CONCEPT);
    assert.equal(stopSession(projectRoot, options, { stop_hook_active: true }).decision, 'block', `attempt ${attemptNumber}`);
  }
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken-4.md'), BROKEN_CONCEPT);
  assert.equal(stopSession(projectRoot, options, { stop_hook_active: true }), null);
});

test('validation: without Python it fails open and tells the person once per session', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  options.environment.AI1_PYTHON = 'python3-that-does-not-exist';
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  const firstStop = stopSession(projectRoot, options);
  assert.equal(firstStop.decision, undefined, 'never blocks');
  assert.match(firstStop.systemMessage, /^ai1\/okf-upkeep: the OKF bundle was not validated: .*python3-that-does-not-exist not found.*Install Python 3\.9\+/);
  assert.equal(stopSession(projectRoot, options)?.systemMessage, undefined, 'said once');
});

const VALID_CONCEPT = '---\ntype: Component\ntitle: App\n---\nThe app.\n';

function commitAll(projectRoot, commitMessage) {
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', commitMessage]);
}

test('okf-index: names concepts changed after the overview and concepts no index links to', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  commitAll(projectRoot, 'add a concept without touching the overview');
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /changed in commits after the last one that touched `\.ai1\/okf\/overview\.md`[^\n]*\n {2}- \.ai1\/okf\/app\.md/);
  assert.match(contextText, /not linked from any index\.md[^\n]*\n {2}- \.ai1\/okf\/app\.md/);
});

test('okf-index: a bundle in step with its overview and indexes gets no health notes', () => {
  const projectRoot = createRepoWithBundle();
  mkdirSync(join(projectRoot, '.ai1', 'okf', 'features'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'features', 'index.md'), '# Features\n\n* [App](app.md)\n* [Back to the overview](/overview.md)\n');
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'features', 'app.md'), VALID_CONCEPT);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'overview.md'), '---\ntype: Overview\n---\nHello, with features.\n');
  commitAll(projectRoot, 'add a linked concept and the overview');
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(contextText, /changed in commits after/);
  assert.doesNotMatch(contextText, /not linked from any index\.md/);
});

test('structure: a concept changed without a look at the overview asks once', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  const firstStop = stopSession(projectRoot, options);
  assert.equal(firstStop.decision, 'block');
  assert.match(firstStop.reason, /without touching `\.ai1\/okf\/overview\.md` nor `\.ai1\/okf\/index\.md`:\n {2}- \.ai1\/okf\/app\.md/);
  assert.match(firstStop.reason, /Concepts no index\.md links to[^\n]*\n {2}- \.ai1\/okf\/app\.md/);
  assert.equal(stopSession(projectRoot, options), null, 'the same findings are not asked twice');
});

test('structure: linking the concept from the index answers both checks', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), `${V02_INDEX}* [App](./app.md#why)\n`);
  assert.equal(stopSession(projectRoot, options), null);
});

test('structure: only the overview review is asked when the concept is already linked', () => {
  const projectRoot = createRepoWithBundle({ indexText: `${V02_INDEX}* [App](app.md)\n` });
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf', 'app.md'), 1_000_000);
  commitAll(projectRoot, 'add the concept');
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT.replace('The app.', 'The app, changed.'));
  const stopReason = stopSession(projectRoot, options).reason;
  assert.match(stopReason, /without touching/);
  assert.doesNotMatch(stopReason, /Concepts no index\.md links to/);
});

test('structure: without overview.md the root index.md is the overview', () => {
  const projectRoot = createRepoWithBundle();
  rmSync(join(projectRoot, '.ai1', 'okf', 'overview.md'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), V02_INDEX.replace('* [Overview](overview.md)\n', '* [App](app.md)\n'));
  commitAll(projectRoot, 'no overview');
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  assert.match(stopSession(projectRoot, options).reason, /without touching `\.ai1\/okf\/index\.md`:/);
});

test('structure: never right after another hook stop', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), VALID_CONCEPT);
  assert.equal(stopSession(projectRoot, options, { stop_hook_active: true }), null);
  assert.equal(stopSession(projectRoot, options).decision, 'block', 'asked on the next ordinary stop');
});

test('validation: the next interpreter is tried when one is missing', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'broken.md'), BROKEN_CONCEPT);
  const validation = runBundleValidator(join(projectRoot, '.ai1', 'okf'), {}, [['python-that-does-not-exist'], ['python3', '-S']]);
  assert.equal(validation.ran, true);
  assert.equal(validation.errors.length, 1);
  assert.match(runBundleValidator(join(projectRoot, '.ai1', 'okf'), {}, [['missing-one'], ['missing-two']]).reason, /missing-one not found; missing-two not found/);
});

test('okf-upkeep: a deleted file is asked about once, not on every stop', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  execFileSync('rm', [join(projectRoot, 'src', 'app.py')]);
  const firstStop = stopSession(projectRoot, options);
  assert.equal(firstStop.decision, 'block');
  assert.match(firstStop.reason, /- src\/app\.py \(deleted\)/);
  assert.equal(stopSession(projectRoot, options), null);
  assert.equal(stopSession(projectRoot, options), null);
});

test('okf-upkeep: a deleted file does not ride along later reminders', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  execFileSync('rm', [join(projectRoot, 'src', 'app.py')]);
  assert.match(stopSession(projectRoot, options).reason, /src\/app\.py \(deleted\)/);
  const memoryDirectory = join(options.homeDirectory, '.claude', 'projects', projectRoot.replace(/[/.]/g, '-'), 'memory');
  mkdirSync(memoryDirectory, { recursive: true });
  writeFileSync(join(memoryDirectory, 'project_finding.md'), '---\nname: finding\nmetadata:\n  originSessionId: session-1\n---\nA fact.\n');
  const laterReminder = stopSession(projectRoot, options).reason;
  assert.match(laterReminder, /project_finding\.md/);
  assert.doesNotMatch(laterReminder, /app\.py/);
});

function memoryDirectoryFor(projectRoot, options) {
  const memoryDirectory = join(options.homeDirectory, '.claude', 'projects', projectRoot.replace(/[/.]/g, '-'), 'memory');
  mkdirSync(memoryDirectory, { recursive: true });
  return memoryDirectory;
}

function writeTranscript(options, writtenPaths) {
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  const transcriptLines = writtenPaths.map((writtenPath) => JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Write', input: { file_path: writtenPath, content: 'x' } }] },
  }));
  writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
  return transcriptPath;
}

test('memories: a memory written by another session is not this session\'s to move', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const memoryDirectory = memoryDirectoryFor(projectRoot, options);
  writeFileSync(join(memoryDirectory, 'project_other.md'), '---\nname: other\nmetadata:\n  originSessionId: another-session\n---\nTheirs.\n');
  assert.equal(stopSession(projectRoot, options), null);
});

test('memories: the transcript decides which memories this session wrote', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const memoryDirectory = memoryDirectoryFor(projectRoot, options);
  const ownMemoryPath = join(memoryDirectory, 'project_own.md');
  writeFileSync(ownMemoryPath, '---\nname: own\n---\nMine, created by another session originally.\n'.replace('---\nname', '---\nmetadata:\n  originSessionId: another-session\nname'));
  writeFileSync(join(memoryDirectory, 'project_theirs.md'), '---\nname: theirs\nmetadata:\n  originSessionId: session-1\n---\nNot written in this transcript.\n');
  const transcriptPath = writeTranscript(options, [ownMemoryPath]);
  const stopOutput = stopSession(projectRoot, options, { transcript_path: transcriptPath });
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /project_own\.md/);
  assert.doesNotMatch(stopOutput.reason, /project_theirs\.md/);
});

test('memories: without transcript or origin, a memory does not count', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(memoryDirectoryFor(projectRoot, options), 'project_unknown.md'), '---\nname: unknown\n---\nWho wrote it?\n');
  assert.equal(stopSession(projectRoot, options), null);
});

test('memories: the transcript scan is incremental and picks up appended writes', async () => {
  const { listMemoryFilesWrittenBySession } = await import('../src/okf/okf-session-scan.mjs');
  const options = hookOptions();
  const memoryDirectory = join(options.homeDirectory, 'memory');
  const firstPath = join(memoryDirectory, 'first.md');
  const secondPath = join(memoryDirectory, 'second.md');
  const transcriptPath = writeTranscript(options, [firstPath]);
  const scanState = { offset: 0, paths: [] };
  assert.deepEqual([...listMemoryFilesWrittenBySession(transcriptPath, [memoryDirectory], scanState)], [firstPath]);
  const offsetAfterFirstScan = scanState.offset;
  assert.ok(offsetAfterFirstScan > 0);
  const appendedLine = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: secondPath } }] } });
  writeFileSync(transcriptPath, `${readFileSync(transcriptPath, 'utf8')}${appendedLine}\n{"partial": `);
  assert.deepEqual([...listMemoryFilesWrittenBySession(transcriptPath, [memoryDirectory], scanState)].sort(), [firstPath, secondPath].sort());
  assert.ok(scanState.offset < statSync(transcriptPath).size, 'an incomplete last line is left for the next scan');
});

function writeConcept(projectRoot, relativePath, frontmatterLines, bodyText) {
  const conceptPath = join(projectRoot, '.ai1', 'okf', relativePath);
  mkdirSync(join(conceptPath, '..'), { recursive: true });
  writeFileSync(conceptPath, `---\n${frontmatterLines.join('\n')}\n---\n${bodyText}\n`);
}

function sendPrompt(projectRoot, options, promptText) {
  return runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: projectRoot, prompt: promptText }, options);
}

function createRecallRepo() {
  const projectRoot = createRepoWithBundle();
  writeConcept(projectRoot, 'extraction/masks.md', ['type: Component', 'title: Máscara', 'description: Configuración de extracción por remitente.', 'tags: [extraction, mask]'], 'Cada plantilla de pedido guarda columnas. Gastrohub lee la cantidad en la columna Quantitat.');
  writeConcept(projectRoot, 'integrations/seidor.md', ['type: Integration', 'title: Seidor y SAP', 'description: Envío de pedidos a SAP.', 'tags:', '  - integration', '  - sap'], 'Los pedidos llegan a SAP por Seidor.');
  writeConcept(projectRoot, 'operations/deploy.md', ['type: Runbook', 'title: Despliegue', 'description: Cómo se despliega.'], 'Dokploy.');
  return projectRoot;
}

test('okf-recall: a message gets the related concepts, best first', () => {
  const projectRoot = createRecallRepo();
  const recallText = sendPrompt(projectRoot, hookOptions(), '¿Por qué la plantilla de Gastrohub no lee la cantidad?').hookSpecificOutput.additionalContext;
  assert.match(recallText, /^ai1\/okf-recall: OKF concepts related to this request|OKF concepts related to this request/);
  assert.match(recallText, /\.ai1\/okf\/extraction\/masks\.md — Máscara: Configuración de extracción por remitente\./);
  assert.doesNotMatch(recallText, /seidor\.md/);
});

test('okf-recall: accents, plurals and block-list tags still match', () => {
  const projectRoot = createRecallRepo();
  const recallText = sendPrompt(projectRoot, hookOptions(), 'mira como llegan los pedidos a SAP por Seidor').hookSpecificOutput.additionalContext;
  assert.match(recallText, /integrations\/seidor\.md/);
});

test('okf-recall: short or unrelated messages and slash commands add nothing', () => {
  const projectRoot = createRecallRepo();
  const options = hookOptions();
  assert.equal(sendPrompt(projectRoot, options, 'sí, adelante'), null);
  assert.equal(sendPrompt(projectRoot, options, 'cuéntame un chiste sobre gatos'), null);
  assert.equal(sendPrompt(projectRoot, options, '/ai1:okf-validate-bundle .ai1/okf'), null);
});

test('okf-recall: switched off with the okf feature', () => {
  const projectRoot = createRecallRepo();
  writeFileSync(join(projectRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: false } }));
  assert.equal(sendPrompt(projectRoot, hookOptions(), '¿Por qué la plantilla de Gastrohub no lee la cantidad?'), null);
});

function writeToolTranscript(options, toolUses) {
  const transcriptPath = join(options.homeDirectory, 'tools-transcript.jsonl');
  const transcriptLines = toolUses.map(([toolName, toolInput]) => JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: toolName, input: toolInput || {} }] },
  }));
  writeFileSync(transcriptPath, `${transcriptLines.join('\n')}\n`);
  return transcriptPath;
}

const TEN_INVESTIGATION_STEPS = [
  ...Array.from({ length: 6 }, () => ['mcp__postgres-prod__query', { sql: 'select 1' }]),
  ...Array.from({ length: 4 }, () => ['Bash', { command: 'python3 analyze.py' }]),
];

test('investigation: ten queries/commands without touching the bundle ask to record findings', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const transcriptPath = writeToolTranscript(options, TEN_INVESTIGATION_STEPS);
  const stopOutput = stopSession(projectRoot, options, { transcript_path: transcriptPath });
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /run 10 investigation steps/);
  assert.match(stopOutput.reason, /ways to validate/);
  assert.match(stopOutput.reason, /ways of working/);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null, 'the count starts over after a reminder');
});

test('investigation: fewer steps, or a bundle edit after them, do not ask', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options, { transcript_path: writeToolTranscript(options, TEN_INVESTIGATION_STEPS.slice(0, 9)) }), null);
  const editedTranscript = writeToolTranscript(options, [...TEN_INVESTIGATION_STEPS, ['Edit', { file_path: join(projectRoot, '.ai1', 'okf', 'overview.md') }]]);
  const otherOptions = { ...options, environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) } };
  startSession(projectRoot, otherOptions);
  assert.equal(stopSession(projectRoot, otherOptions, { transcript_path: editedTranscript }), null);
});

test('investigation: a bundle edit made from the shell resets the count', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const shellEdit = ['Bash', { command: "cat >> .ai1/okf/decisions/prior-art.md <<'EOF'\n# Findings\nEOF" }];
  const transcriptPath = writeToolTranscript(options, [...TEN_INVESTIGATION_STEPS, shellEdit]);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null);
});

test('shellCommandWritesBundle: shell writes to the bundle count, reads do not', () => {
  const bundleWrites = [
    'cat >> .ai1/okf/log.md <<EOF\nx\nEOF',
    'echo x > ./.ai1/okf/overview.md',
    'echo x >/home/me/repo/.ai1/okf/overview.md',
    "sed -i 's/a/b/' .ai1/okf/roadmap.md",
    'printf x | tee -a .ai1/okf/log.md',
    'mv /tmp/draft.md .ai1/okf/decisions/new.md',
    'rm .ai1/okf/old.md',
    "python3 - <<'EOF'\nopen('.ai1/okf/log.md','w').write('x')\nEOF",
    "node -e \"require('fs').writeFileSync('.ai1/okf/x.md','x')\"",
    'cd /repo && bash -c "echo x >> .ai1/okf/log.md"',
  ];
  for (const commandLine of bundleWrites) assert.equal(shellCommandWritesBundle(commandLine, '.ai1/okf'), true, commandLine);
  const bundleReads = [
    'python3 skills/okf-validate-bundle/scripts/okf_validate.py .ai1/okf --strict',
    'cat .ai1/okf/index.md',
    'grep -rn verify .ai1/okf/',
    'git diff --stat .ai1/okf',
    'cp .ai1/okf/overview.md /tmp/overview.md',
    'echo x > notes.md',
    'npm test',
  ];
  for (const commandLine of bundleReads) assert.equal(shellCommandWritesBundle(commandLine, '.ai1/okf'), false, commandLine);
  assert.equal(shellCommandWritesBundle('echo x >> docs/kb/log.md', 'docs/kb'), true);
});

test('investigation: never right after another hook stop', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const transcriptPath = writeToolTranscript(options, TEN_INVESTIGATION_STEPS);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath, stop_hook_active: true }), null);
});

test('investigation: a file reminder wins and resets the count', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  const transcriptPath = writeToolTranscript(options, TEN_INVESTIGATION_STEPS);
  const stopOutput = stopSession(projectRoot, options, { transcript_path: transcriptPath });
  assert.match(stopOutput.reason, /left knowledge newer/);
  assert.doesNotMatch(stopOutput.reason, /investigation steps/);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null);
});

test('discarded attempt: a file edited and then restored asks once to record why it was dropped', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'app.md'), '---\ntype: Component\ntitle: App\nresource: src/app.py\n---\nThe app.\n');
  setModifiedSeconds(join(projectRoot, '.ai1', 'okf', 'app.md'), 1_000_000);
  const options = hookOptions();
  startSession(projectRoot, options);
  const transcriptPath = writeSessionTranscript(options, [
    { name: 'Edit', input: { file_path: join(projectRoot, 'src', 'app.py'), old_string: 'print(1)', new_string: 'print(2)' } },
    { name: 'Bash', input: { command: 'git checkout -- src/app.py' } },
  ]);
  const stopOutput = stopSession(projectRoot, options, { transcript_path: transcriptPath });
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /edited these files and then undid the change[^\n]*\n {2}- src\/app\.py/);
  assert.match(stopOutput.reason, /Concepts that describe those files: `\.ai1\/okf\/app\.md`/);
  assert.match(stopOutput.reason, /why it was dropped/);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null, 'the same files are not asked twice');
});

test('discarded attempt: edits stamped before the session base (ai1 set up midway through the session) are not asked about', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  const editBeforeSetup = { type: 'assistant', timestamp: '2026-11-07T21:11:22.383Z', message: { content: [{ type: 'tool_use', id: 'tool-0', name: 'Edit', input: { file_path: join(projectRoot, 'src', 'app.py'), old_string: 'print(1)', new_string: 'print(2)' } }] } };
  writeFileSync(transcriptPath, `${JSON.stringify(editBeforeSetup)}\n`);
  assert.equal(stopSession(projectRoot, options, { transcript_path: transcriptPath }), null);
});

test('discarded attempt: a change still in the diff gets the usual reminder instead', () => {
  const projectRoot = createRepoWithBundle();
  const options = hookOptions();
  startSession(projectRoot, options);
  writeFileSync(join(projectRoot, 'src', 'app.py'), 'print(2)\n');
  const transcriptPath = writeSessionTranscript(options, [{ name: 'Write', input: { file_path: join(projectRoot, 'src', 'app.py'), content: 'print(2)\n' } }]);
  const stopReason = stopSession(projectRoot, options, { transcript_path: transcriptPath }).reason;
  assert.match(stopReason, /left knowledge newer/);
  assert.doesNotMatch(stopReason, /undid the change/);
});

test('discarded attempt: a bundle edit after it, ignored files and files outside the repo do not ask', () => {
  const projectRoot = createRepoWithBundle();
  writeFileSync(join(projectRoot, '.gitignore'), 'build/\n');
  commitAll(projectRoot, 'ignore build');
  const options = hookOptions();
  startSession(projectRoot, options);
  const recordedTranscript = writeSessionTranscript(options, [
    { name: 'Edit', input: { file_path: join(projectRoot, 'src', 'app.py'), old_string: 'print(1)', new_string: 'print(2)' } },
    { name: 'Edit', input: { file_path: join(projectRoot, '.ai1', 'okf', 'overview.md'), old_string: 'Hello.', new_string: 'Hello.' } },
    { name: 'Write', input: { file_path: join(projectRoot, 'build', 'out.js'), content: 'x' } },
    { name: 'Write', input: { file_path: join(tmpdir(), 'scratch.txt'), content: 'x' } },
  ]);
  assert.equal(stopSession(projectRoot, options, { transcript_path: recordedTranscript }), null);
});
