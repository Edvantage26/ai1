import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPendingMigrations, describeMigrationReports, REPO_LEDGER_RELATIVE_PATH } from '../src/core/migrations.mjs';
import { setupRepo } from '../src/cli/setup-repo.mjs';
import { createTemporaryProject } from './helpers.mjs';

const HOOK_ENTRYPOINT = fileURLToPath(new URL('../bin/ai1-hook.mjs', import.meta.url));
const OLD_CONFIG = { version: 1, features: { okf: false, lanes: true }, modules: { 'lanes-escalate': false }, verify: ['npm test'] };

function createUserHome() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  mkdirSync(join(homeDirectory, '.config', 'ai1'), { recursive: true });
  return homeDirectory;
}

function writeFile(filePath, fileText) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, fileText);
}

function readConfig(projectRoot) {
  return JSON.parse(readFileSync(join(projectRoot, '.ai1', 'config.json'), 'utf8'));
}

function startSessionThroughEntrypoint(projectRoot, homeDirectory) {
  const hookRun = spawnSync(process.execPath, [HOOK_ENTRYPOINT, 'SessionStart'], {
    input: JSON.stringify({ session_id: 'migration-session', cwd: projectRoot, source: 'startup' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: homeDirectory, AI1_DECISION_LOG: '0', CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
  });
  assert.equal(hookRun.status, 0, hookRun.stderr);
  return JSON.parse(hookRun.stdout).hookSpecificOutput.additionalContext;
}

test('a session start migrates features.lanes to sizing, turns it on in that session and says what changed [rename-lanes-to-sizing:S2]', () => {
  const projectRoot = createTemporaryProject({ ...OLD_CONFIG, modules: { 'lanes-escalate': false, 'sizing-gate': { enabled: true }, 'lanes-gate': false } });
  const contextText = startSessionThroughEntrypoint(projectRoot, createUserHome());
  assert.deepEqual(readConfig(projectRoot).features, { okf: false, sizing: true });
  assert.deepEqual(readConfig(projectRoot).modules, { 'sizing-escalate': false, 'sizing-gate': { enabled: true } }, 'the new name wins when both are set');
  assert.match(contextText, /Sizing: size every new task before acting/, 'on in this same session');
  assert.match(contextText, /ai1 v0\.32\.0 renamed the lanes feature to sizing and migrated this repo: changed \.ai1\/config\.json\..*Nothing was committed/);
  assert.doesNotMatch(contextText, /old name of the sizing feature/);
});

test('the next session start runs nothing, and ai1 init gives the same result [rename-lanes-to-sizing:S3]', () => {
  const homeDirectory = createUserHome();
  const projectRoot = createTemporaryProject(OLD_CONFIG);
  startSessionThroughEntrypoint(projectRoot, homeDirectory);
  assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, REPO_LEDGER_RELATIVE_PATH), 'utf8')), { applied: 1 });
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'work', '.gitignore'), 'utf8'), '*\n', 'the ledger never reaches git');
  assert.doesNotMatch(startSessionThroughEntrypoint(projectRoot, homeDirectory), /migrated/);

  const initRoot = createTemporaryProject(OLD_CONFIG);
  const setupResult = setupRepo(initRoot, { enabledFeatureIds: ['sizing'], verifyCommands: ['npm test'], userSettingsPath: join(homeDirectory, 'settings.json') });
  assert.equal(readConfig(initRoot).features.sizing, true);
  assert.deepEqual(readConfig(initRoot).modules, { 'sizing-escalate': false });
  assert.match(describeMigrationReports(setupResult.migrationReports), /changed \.ai1\/config\.json/);
  assert.throws(() => setupRepo(createTemporaryProject(OLD_CONFIG), { enabledFeatureIds: ['lanes'] }), /called sizing since v0\.32\.0/);
});

test('project and personal overlays move to sizing and ai1 texts name the new skill [rename-lanes-to-sizing:S5]', () => {
  const homeDirectory = createUserHome();
  const projectRoot = createTemporaryProject(OLD_CONFIG);
  writeFile(join(projectRoot, '.ai1', 'skills', 'lanes', 'overlay.md'), 'Briefs in Spanish.\n');
  writeFile(join(homeDirectory, '.config', 'ai1', 'skills', 'lanes', 'overlay.md'), 'Ask before /ai1:lanes-design-before-code.\n');
  writeFile(join(projectRoot, '.ai1', 'okf', 'features', 'flow.md'), 'Deep work uses /ai1:lanes-design-before-code.\n');
  writeFile(join(projectRoot, '.ai1', 'okf', 'log.md'), '2026-11-01 used /ai1:lanes-design-before-code\n');
  writeFile(join(projectRoot, '.ai1', 'work', 'csv', 'plan.md'), '---\ntitle: CSV\nlane: plan\nstatus: active\n---\n');
  writeFile(join(projectRoot, 'CLAUDE.md'), 'Run /ai1:lanes-design-before-code for deep tasks.\n');

  const contextText = startSessionThroughEntrypoint(projectRoot, homeDirectory);
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'skills', 'sizing', 'overlay.md'), 'utf8'), 'Briefs in Spanish.\n');
  assert.ok(!existsSync(join(projectRoot, '.ai1', 'skills', 'lanes')));
  assert.equal(readFileSync(join(homeDirectory, '.config', 'ai1', 'skills', 'sizing', 'overlay.md'), 'utf8'), 'Ask before /ai1:sizing-design-before-code.\n');
  assert.deepEqual(JSON.parse(readFileSync(join(homeDirectory, '.config', 'ai1', 'migrations.json'), 'utf8')), { applied: 1 });
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'okf', 'features', 'flow.md'), 'utf8'), 'Deep work uses /ai1:sizing-design-before-code.\n');
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'okf', 'log.md'), 'utf8'), '2026-11-01 used /ai1:lanes-design-before-code\n', 'the log is history');
  assert.match(readFileSync(join(projectRoot, '.ai1', 'work', 'csv', 'plan.md'), 'utf8'), /^size: plan$/m);
  assert.equal(readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf8'), 'Run /ai1:lanes-design-before-code for deep tasks.\n', 'the person\'s docs are not edited');
  assert.match(contextText, /to update by hand: CLAUDE\.md/);
  assert.match(contextText, /migrated your ai1 config folder/);
});

test('an overlay already at sizing keeps the lanes one in place and lists it', () => {
  const projectRoot = createTemporaryProject(OLD_CONFIG);
  writeFile(join(projectRoot, '.ai1', 'skills', 'lanes', 'overlay.md'), 'old\n');
  writeFile(join(projectRoot, '.ai1', 'skills', 'sizing', 'overlay.md'), 'new\n');
  const migrationText = describeMigrationReports(runPendingMigrations(projectRoot, { includeUser: false }));
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'skills', 'sizing', 'overlay.md'), 'utf8'), 'new\n');
  assert.match(migrationText, /left alone \.ai1\/skills\/lanes \(\.ai1\/skills\/sizing already exists/);
});

test('a migration that throws keeps its ledger and is reported; without a user config folder nothing is written there', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const projectRoot = createTemporaryProject(OLD_CONFIG);
  const failingMigration = { number: 1, id: 'broken', summary: 'ai1 vX changed something', migrateRepo() { throw new Error('disk full'); }, migrateUser() {} };
  const migrationReports = runPendingMigrations(projectRoot, { homeDirectory, environment: {}, migrations: [failingMigration] });
  assert.ok(!existsSync(join(projectRoot, REPO_LEDGER_RELATIVE_PATH)));
  assert.match(describeMigrationReports(migrationReports), /ai1 vX changed something, but migrating this repo failed \(disk full\); it will be retried/);
  assert.ok(!existsSync(join(homeDirectory, '.config', 'ai1')));
});
