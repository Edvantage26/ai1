import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { runMaintainCommand } from '../src/cli/maintain-command.mjs';
import { runRoutineNotice } from '../src/routines/routine-notice.mjs';
import { runRoutineCommandLine } from '../src/cli/routine-command.mjs';
import { readPersonState, readPersonProfile } from '../src/core/person-project.mjs';
import { createTemporaryProject } from './helpers.mjs';

// The person's own git config must not decide these tests.
const emptyGitConfigPath = join(mkdtempSync(join(tmpdir(), 'ai1-gitconfig-')), 'gitconfig');
writeFileSync(emptyGitConfigPath, '');
process.env.GIT_CONFIG_GLOBAL = emptyGitConfigPath;
process.env.GIT_CONFIG_NOSYSTEM = '1';

const BUNDLE_INDEX = '---\nokf_version: "0.2"\n---\n\n# Demo bundle\n';
const DRIFTING_CLAUDE_MD = '# Demo\nRead `.ai1/okf/index.md` first.\nOld: `backend/old_module.py`.\n';

// A git repo with a bundle, a CLAUDE.md that drifts from it and the given person's git email.
function createDriftingRepo(personEmail, ai1Config) {
  const projectRoot = createTemporaryProject(ai1Config);
  mkdirSync(join(projectRoot, '.ai1', 'okf'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), BUNDLE_INDEX);
  writeFileSync(join(projectRoot, 'CLAUDE.md'), DRIFTING_CLAUDE_MD);
  execFileSync('git', ['-C', projectRoot, 'init', '-q'], { stdio: 'ignore' });
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', personEmail], { stdio: 'ignore' });
  return projectRoot;
}

function startSession(projectRoot) {
  const hookOptions = {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  return JSON.stringify(runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source: 'startup' }, hookOptions) || {});
}

test('maintenance: the CLAUDE.md drift hint reaches only the maintainers listed, case-insensitive [person-project:S1]', () => {
  const ai1Config = { maintainers: ['ana@x.com'] };
  assert.doesNotMatch(startSession(createDriftingRepo('bob@x.com', ai1Config)), /CLAUDE\.md drifts from the bundle/);
  assert.match(startSession(createDriftingRepo('Ana@x.com', ai1Config)), /CLAUDE\.md drifts from the bundle/);
  assert.match(startSession(createDriftingRepo('bob@x.com', {})), /CLAUDE\.md drifts from the bundle/);
});

test('maintenance: ai1 maintain off silences a task for good for that person, and lists it off [person-project:S2]', () => {
  const projectRoot = createDriftingRepo('ana@x.com', { maintainers: ['ana@x.com'] });
  assert.equal(runMaintainCommand(projectRoot, ['off', 'claude-md-drift']).exitCode, 0);
  assert.doesNotMatch(startSession(projectRoot), /CLAUDE\.md drifts from the bundle/);
  assert.match(runMaintainCommand(projectRoot, []).output, /claude-md-drift \(condition\): off/);
  assert.deepEqual(readPersonProfile(projectRoot).tasks['claude-md-drift'], { mode: 'off' });
});

test('maintenance: snooze hides a task until the date, on brings it back, unknown tasks are refused', () => {
  const projectRoot = createDriftingRepo('ana@x.com', {});
  // A date far ahead: the session start below reads the real clock, so the snooze must not have expired.
  const snoozeResult = runMaintainCommand(projectRoot, ['snooze', 'claude-md-drift', '3'], new Date('2099-11-18T00:00:00Z'));
  assert.match(snoozeResult.output, /snoozed until 2099-11-21/);
  assert.doesNotMatch(startSession(projectRoot), /CLAUDE\.md drifts from the bundle/);
  runMaintainCommand(projectRoot, ['on', 'claude-md-drift']);
  assert.match(startSession(projectRoot), /CLAUDE\.md drifts from the bundle/);
  assert.throws(() => runMaintainCommand(projectRoot, ['off', 'nope']), /unknown maintenance task "nope"/);
  assert.equal(runMaintainCommand(projectRoot, ['snooze']).exitCode, 1);
});

test('maintenance: with the maintenance feature off, the drift hint reaches everyone as before', () => {
  assert.match(startSession(createDriftingRepo('bob@x.com', { maintainers: ['ana@x.com'], features: { maintenance: false } })), /CLAUDE\.md drifts from the bundle/);
});

function createRepoWithStaleLaterEntry(personEmail, ai1Config) {
  const projectRoot = createDriftingRepo(personEmail, ai1Config);
  mkdirSync(join(projectRoot, '.ai1', 'later'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'later', '0001-old-idea.md'),
    '---\nnumber: 1\ntitle: Old idea\nsize: idea\nstatus: draft\ncreated: 2026-01-01\nupdated: 2026-01-01\n---\n\n# Later 0001: Old idea\n');
  return projectRoot;
}

test('maintenance-notice: a periodic task is told once, then waits for days and session starts', () => {
  const projectRoot = createRepoWithStaleLaterEntry('ana@x.com', {});
  const noticeAt = (isoDate) => JSON.stringify(runRoutineNotice({ hookInput: { source: 'startup' }, config: {}, projectRoot, sharedRoot: projectRoot, now: new Date(isoDate) }));
  assert.match(noticeAt('2026-11-18T00:00:00Z'), /later-backlog: 1 later entry open and untouched for over 60 days \(0001\)/);
  assert.doesNotMatch(noticeAt('2026-11-30T00:00:00Z'), /later-backlog/, 'days passed but only 1 session start since the notice');
  assert.doesNotMatch(noticeAt('2026-11-30T00:00:00Z'), /later-backlog/);
  assert.match(noticeAt('2026-11-30T00:00:00Z'), /later-backlog/, '3 session starts and 7 days since the notice');
  assert.equal(readPersonState(projectRoot).routines['later-backlog'].lastRun, '2026-11-30T00:00:00.000Z');
  assert.equal(readPersonState(projectRoot).routineSessionStarts, 4);
});

test('maintenance-notice: silent for developers and on resumed sessions', () => {
  const developerRoot = createRepoWithStaleLaterEntry('bob@x.com', { maintainers: ['ana@x.com'] });
  const config = { maintainers: ['ana@x.com'] };
  assert.equal(runRoutineNotice({ hookInput: { source: 'startup' }, config, projectRoot: developerRoot, sharedRoot: developerRoot }).kind, 'allow');
  const maintainerRoot = createRepoWithStaleLaterEntry('ana@x.com', {});
  assert.equal(runRoutineNotice({ hookInput: { source: 'resume' }, config: {}, projectRoot: maintainerRoot, sharedRoot: maintainerRoot }).kind, 'allow');
});

test('later-backlog is a built-in routine: in the same line as the person\'s due routines, silenced by ai1 routine off or ai1 maintain off [routines:S5]', () => {
  const projectRoot = createRepoWithStaleLaterEntry('ana@x.com', { maintainers: ['ana@x.com'] });
  const config = { maintainers: ['ana@x.com'] };
  runRoutineCommandLine(projectRoot, ['add', 'deps', '--every', '7d', '--prompt', 'Check outdated dependencies'], { now: new Date('2026-11-01T10:00:00Z') });
  const noticeText = runRoutineNotice({ hookInput: { source: 'startup' }, config, projectRoot, sharedRoot: projectRoot, now: new Date('2026-11-18T10:00:00Z') }).text;
  assert.match(noticeText, /due for the person - deps: Check outdated dependencies/);
  assert.match(noticeText, /maintenance for the person as maintainer of ai1 in this repo - later-backlog: 1 later entry open/);
  runRoutineCommandLine(projectRoot, ['off', 'later-backlog']);
  const laterNotice = runRoutineNotice({ hookInput: { source: 'startup' }, config, projectRoot, sharedRoot: projectRoot, now: new Date('2026-12-30T10:00:00Z') });
  assert.doesNotMatch(laterNotice.text || '', /later-backlog/);
  assert.match(laterNotice.text, /deps/);
  runMaintainCommand(projectRoot, ['on', 'later-backlog']);
  runMaintainCommand(projectRoot, ['off', 'later-backlog']);
  assert.doesNotMatch(JSON.stringify(runRoutineNotice({ hookInput: { source: 'startup' }, config, projectRoot, sharedRoot: projectRoot, now: new Date('2027-02-01T10:00:00Z') })), /later-backlog/);
});
