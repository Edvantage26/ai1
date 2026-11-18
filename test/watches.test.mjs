import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDuration, validateWatchDefinition, listWatchDefinitions, writeWatchDefinition, findWatchDefinition,
} from '../src/watches/watch-definitions.mjs';
import { createTemporaryProject } from './helpers.mjs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { runWatchCommandLine, describeWatches } from '../src/cli/watch-command.mjs';
import { runWatchCommand, parseWatchCounts } from '../src/watches/watch-run.mjs';
import { readSubscriptions, readWatchRecords } from '../src/watches/watch-state.mjs';
import { runWatchNotice } from '../src/watches/watch-notice.mjs';
import { findReleaseCommand } from '../src/watches/watch-release-detect.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';

const HEALTH_WATCH = { title: 'Checkout in production', check: { kind: 'command', run: ['node', '-e', 'process.exit(0)'] }, every: '1d', suggestedFor: '14d', createdBy: 'ana@x.com' };

test('watch definitions: durations in hours or days', () => {
  assert.equal(parseDuration('12h'), 12 * 3600 * 1000);
  assert.equal(parseDuration('14d'), 14 * 86400 * 1000);
  assert.equal(parseDuration('2w'), null);
  assert.equal(parseDuration(undefined), null);
});

test('watch definitions: a command or agent check is valid; the rest is explained', () => {
  assert.deepEqual(validateWatchDefinition(HEALTH_WATCH), []);
  assert.deepEqual(validateWatchDefinition({ title: 'Usage', check: { kind: 'command', run: 'curl -fsS https://example.test/stats', expect: 'counts' } }), []);
  assert.deepEqual(validateWatchDefinition({ title: 'Logs', check: { kind: 'agent', prompt: 'Look for new errors in the logs' } }), []);
  assert.deepEqual(validateWatchDefinition({ title: '', check: { kind: 'shell' }, every: 'daily', extra: 1 }),
    ['unknown field "extra"', '"title" must be a non-empty string', '"check.kind" must be "command" or "agent"', '"every" must be a duration like 12h or 14d']);
  assert.deepEqual(validateWatchDefinition({ title: 'x', check: { kind: 'command', run: [], expect: { exitCode: 'zero' } } }),
    ['"check.run" must be a list of arguments or a command line', '"check.expect" must be { "exitCode": n } or "counts"']);
});

test('watch definitions: written and listed from .ai1/watches/, a broken file listed with its error', () => {
  const projectRoot = createTemporaryProject({});
  writeWatchDefinition(projectRoot, 'checkout-prod', HEALTH_WATCH);
  writeFileSync(join(projectRoot, '.ai1', 'watches', 'broken.json'), '{ nope');
  const watchEntries = listWatchDefinitions(projectRoot);
  assert.deepEqual(watchEntries.map((watchEntry) => [watchEntry.id, watchEntry.errors.length]), [['broken', 1], ['checkout-prod', 0]]);
  assert.deepEqual(findWatchDefinition(projectRoot, 'checkout-prod').definition, HEALTH_WATCH);
  assert.throws(() => writeWatchDefinition(projectRoot, 'Bad Id', HEALTH_WATCH), /lower-case letters/);
  assert.throws(() => writeWatchDefinition(projectRoot, 'no-check', { title: 'x' }), /"check" must be an object/);
});

test('watch schema: every field the validator knows is in schema/watch.schema.json', () => {
  const watchSchema = JSON.parse(readFileSync(fileURLToPath(new URL('../schema/watch.schema.json', import.meta.url)), 'utf8'));
  assert.deepEqual(Object.keys(watchSchema.properties).sort(), ['$schema', 'check', 'createdBy', 'description', 'every', 'suggestedFor', 'title']);
  assert.deepEqual(Object.keys(watchSchema.properties.check.properties).sort(), ['expect', 'kind', 'prompt', 'run', 'timeoutSeconds']);
});


const emptyGitConfigPath = join(mkdtempSync(join(tmpdir(), 'ai1-gitconfig-')), 'gitconfig');
writeFileSync(emptyGitConfigPath, '');
process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';

function createWatchRepo() {
  const projectRoot = createTemporaryProject({});
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'ana@x.com'], { stdio: 'ignore' });
  return projectRoot;
}

const COUNTS_RUN = JSON.stringify([process.execPath, '-e', 'console.log("checking"); console.log(JSON.stringify({ succeeded: 3, failed: 1 }))']);

test('watch run: exit code decides health; missing binary is error; counts read from the last line', () => {
  const projectRoot = createWatchRepo();
  const healthWatch = (exitCode) => ({ title: 't', check: { kind: 'command', run: [process.execPath, '-e', `process.exit(${exitCode})`] } });
  assert.equal(runWatchCommand(healthWatch(0), { repoRoot: projectRoot, sinceDate: 'x' }).result, 'ok');
  assert.deepEqual(runWatchCommand(healthWatch(2), { repoRoot: projectRoot, sinceDate: 'x' }).note, 'exit 2, expected 0');
  assert.equal(runWatchCommand({ title: 't', check: { kind: 'command', run: ['ai1-no-such-binary'] } }, { repoRoot: projectRoot, sinceDate: 'x' }).result, 'error');
  const sinceEcho = runWatchCommand({ title: 't', check: { kind: 'command', run: [process.execPath, '-e', 'console.log(process.env.AI1_WATCH_SINCE)'] } }, { repoRoot: projectRoot, sinceDate: '2026-11-18T00:00:00.000Z' });
  assert.match(sinceEcho.output, /2026-11-18T00:00:00.000Z/);
  const slowWatch = { title: 't', check: { kind: 'command', run: [process.execPath, '-e', 'setTimeout(() => {}, 5000)'], timeoutSeconds: 0.3 } };
  assert.equal(runWatchCommand(slowWatch, { repoRoot: projectRoot, sinceDate: 'x' }).result, 'fail');
  assert.deepEqual(parseWatchCounts('noise\n{"succeeded": 2, "failed": 0}\n'), { succeeded: 2, failed: 0 });
  assert.equal(parseWatchCounts('{"succeeded": -1, "failed": 0}'), null);
});

test('watch add subscribes the author; two runs of a counts watch add up since the subscription', () => {
  const projectRoot = createWatchRepo();
  const addResult = runWatchCommandLine(projectRoot, ['add', 'checkout-usage', '--title', 'Checkout usage', '--run-json', COUNTS_RUN, '--counts', '--for', '7d'], new Date('2026-11-18T10:00:00Z'));
  assert.match(addResult.output, /you follow it until 2026-11-25/);
  assert.equal(JSON.parse(readFileSync(join(projectRoot, '.ai1', 'watches', 'checkout-usage.json'), 'utf8')).createdBy, 'ana@x.com');
  assert.match(runWatchCommandLine(projectRoot, ['run'], new Date('2026-11-18T11:00:00Z')).output, /checkout-usage: fail \(3 ok, 1 failed this time\); 3 ok, 1 failed since 2026-11-18/);
  assert.equal(runWatchCommandLine(projectRoot, ['run', '--due'], new Date('2026-11-18T12:00:00Z')).output, 'no watch is due');
  runWatchCommandLine(projectRoot, ['run', '--due'], new Date('2026-11-19T12:00:00Z'));
  const [watchDescription] = describeWatches(projectRoot, new Date('2026-11-19T12:00:00Z'));
  assert.equal(watchDescription.results, '6 ok, 2 failed since 2026-11-18');
  assert.equal(readWatchRecords(projectRoot)['checkout-usage'].history.length, 2);
});

test('watch subscribe, pause, record, confirm and unsubscribe are the person\'s own', () => {
  const projectRoot = createWatchRepo();
  runWatchCommandLine(projectRoot, ['add', 'logs-clean', '--title', 'No new errors', '--prompt', 'Look for new errors since the release', '--no-subscribe']);
  assert.deepEqual(readSubscriptions(projectRoot), {});
  assert.match(runWatchCommandLine(projectRoot, ['subscribe', 'logs-clean', '--for', '2d'], new Date('2026-11-18T00:00:00Z')).output, /until 2026-11-20/);
  assert.match(runWatchCommandLine(projectRoot, ['run'], new Date('2026-11-18T01:00:00Z')).output, /an agent check - follow its prompt, then ai1 watch record logs-clean/);
  assert.match(runWatchCommandLine(projectRoot, ['record', 'logs-clean', 'ok', 'no', 'new', 'errors'], new Date('2026-11-18T02:00:00Z')).output, /1 check since 2026-11-18: 1 ok/);
  assert.match(runWatchCommandLine(projectRoot, ['confirm', 'logs-clean', 'tried', 'it'], new Date('2026-11-18T03:00:00Z')).output, /confirmed by you on 2026-11-18/);
  runWatchCommandLine(projectRoot, ['pause', 'logs-clean']);
  assert.match(runWatchCommandLine(projectRoot, ['list']).output, /logs-clean \(agent\): No new errors - paused; .*confirmed by you 2026-11-18/);
  assert.match(runWatchCommandLine(projectRoot, ['unsubscribe', 'logs-clean']).output, /no longer follow it/);
  assert.throws(() => runWatchCommandLine(projectRoot, ['subscribe', 'missing']), /no watch "missing"/);
  assert.equal(runWatchCommandLine(projectRoot, ['record', 'logs-clean', 'maybe']).exitCode, 1);
});

function noticeAt(projectRoot, isoDate, source = 'startup') {
  return JSON.stringify(runWatchNotice({ hookInput: { source }, projectRoot, sharedRoot: projectRoot, now: new Date(isoDate) }));
}

test('watch-notice: a failed check is told once and recorded as the last notice; then silence [person-project:S3]', () => {
  const projectRoot = createWatchRepo();
  const failingRun = JSON.stringify([process.execPath, '-e', 'process.exit(1)']);
  runWatchCommandLine(projectRoot, ['add', 'checkout-prod', '--title', 'Checkout in production', '--run-json', failingRun], new Date('2026-11-18T08:00:00Z'));
  runWatchCommandLine(projectRoot, ['confirm', 'checkout-prod'], new Date('2026-11-18T08:30:00Z'));
  runWatchCommandLine(projectRoot, ['run', 'checkout-prod'], new Date('2026-11-18T09:00:00Z'));
  const watchRecord = readWatchRecords(projectRoot)['checkout-prod'];
  assert.deepEqual([watchRecord.lastRun, watchRecord.lastResult], ['2026-11-18T09:00:00.000Z', 'fail']);
  assert.match(noticeAt(projectRoot, '2026-11-18T10:00:00Z'), /checkout-prod: last check fail; 1 check since 2026-11-18: 1 fail/);
  assert.equal(readWatchRecords(projectRoot)['checkout-prod'].lastNotified, '2026-11-18T10:00:00.000Z');
  assert.equal(JSON.parse(noticeAt(projectRoot, '2026-11-18T11:00:00Z')).kind, 'allow');
  assert.equal(JSON.parse(noticeAt(projectRoot, '2026-11-19T11:00:00Z', 'resume')).kind, 'allow');
});

test('watch-notice: a follow-up past its date ends, the subscription goes and the definition stays [person-project:S4]', () => {
  const projectRoot = createWatchRepo();
  runWatchCommandLine(projectRoot, ['add', 'checkout-prod', '--title', 'Checkout', '--run-json', JSON.stringify([process.execPath, '-e', '0']), '--for', '2d'], new Date('2026-11-18T00:00:00Z'));
  assert.match(noticeAt(projectRoot, '2026-11-21T00:00:00Z'), /checkout-prod follow-up ended \(not checked yet\)/);
  assert.deepEqual(readSubscriptions(projectRoot), {});
  assert.equal(listWatchDefinitions(projectRoot).length, 1);
});

test('watch-notice: counts totals since the release, and the confirmation is asked until given, once a day [person-project:S8]', () => {
  const projectRoot = createWatchRepo();
  runWatchCommandLine(projectRoot, ['add', 'checkout-usage', '--title', 'Checkout usage', '--run-json', COUNTS_RUN, '--counts'], new Date('2026-11-18T08:00:00Z'));
  runWatchCommandLine(projectRoot, ['run'], new Date('2026-11-18T09:00:00Z'));
  runWatchCommandLine(projectRoot, ['run'], new Date('2026-11-19T09:00:00Z'));
  const firstNotice = noticeAt(projectRoot, '2026-11-19T10:00:00Z');
  assert.match(firstNotice, /checkout-usage: last check fail; 6 ok, 2 failed since 2026-11-18/);
  assert.match(firstNotice, /checkout-usage is not confirmed by the person yet: .*ai1 watch confirm checkout-usage/);
  assert.doesNotMatch(noticeAt(projectRoot, '2026-11-19T12:00:00Z'), /not confirmed/);
  assert.match(noticeAt(projectRoot, '2026-11-20T12:00:00Z'), /not confirmed by the person yet/);
  runWatchCommandLine(projectRoot, ['confirm', 'checkout-usage'], new Date('2026-11-20T13:00:00Z'));
  assert.doesNotMatch(noticeAt(projectRoot, '2026-11-22T13:00:00Z'), /not confirmed/);
  assert.match(runWatchCommandLine(projectRoot, ['list'], new Date('2026-11-22T13:00:00Z')).output, /6 ok, 2 failed since 2026-11-18, confirmed by you 2026-11-20/);
});

test('watch-notice: due checks are listed; nothing followed, nothing said', () => {
  const projectRoot = createWatchRepo();
  assert.equal(JSON.parse(noticeAt(projectRoot, '2026-11-18T00:00:00Z')).kind, 'allow');
  runWatchCommandLine(projectRoot, ['add', 'logs-clean', '--title', 'Logs', '--prompt', 'Look for errors'], new Date('2026-11-18T00:00:00Z'));
  assert.match(noticeAt(projectRoot, '2026-11-18T01:00:00Z'), /due: logs-clean \(offer `ai1 watch run --due`/);
});

test('watch-release-detect: a push of the trunk or a tag, a publish or a repo deploy command is a release, once per session [person-project:S7]', () => {
  const detectOptions = { trunkBranch: 'main', deployCommandPatterns: ['^make deploy-prod'] };
  assert.equal(findReleaseCommand('git push origin main', detectOptions), 'git push origin main');
  assert.equal(findReleaseCommand('npm test && git push --tags', detectOptions), 'git push --tags');
  assert.equal(findReleaseCommand('git push origin v1.4.0', detectOptions), 'git push origin v1.4.0');
  assert.equal(findReleaseCommand('git push origin HEAD:main', detectOptions), 'git push origin HEAD:main');
  assert.equal(findReleaseCommand('gh release create v1.4.0 --notes x', detectOptions), 'gh release create v1.4.0 --notes x');
  assert.equal(findReleaseCommand('npm publish', detectOptions), 'npm publish');
  assert.equal(findReleaseCommand('make deploy-prod', detectOptions), 'make deploy-prod');
  assert.equal(findReleaseCommand('git push origin feature/x', detectOptions), null);
  assert.equal(findReleaseCommand('git status', detectOptions), null);

  const projectRoot = createWatchRepo();
  const hookOptions = {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  const afterBash = (commandLine) => JSON.stringify(runHookEvent('PostToolUse', { session_id: 'session-1', cwd: projectRoot, tool_name: 'Bash', tool_input: { command: commandLine } }, hookOptions) || {});
  assert.doesNotMatch(afterBash('git push origin feature/x'), /looks like a release/);
  assert.match(afterBash('git push origin main'), /`git push origin main` looks like a release to production\. .*\/ai1:watches-follow-release/);
  assert.doesNotMatch(afterBash('npm publish'), /looks like a release/, 'once per session');
});
