import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPendingMigrations, describeMigrationReports, REPO_LEDGER_RELATIVE_PATH, LATEST_MIGRATION_NUMBER } from '../src/core/migrations.mjs';
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
  assert.deepEqual(readConfig(projectRoot).features, { sizing: true }, 'okf false dropped by migration 4');
  assert.deepEqual(readConfig(projectRoot).modules, { 'sizing-escalate': false, 'sizing-gate': { enabled: true } }, 'the new name wins when both are set');
  assert.match(contextText, /Sizing: size every new task before acting/, 'on in this same session');
  assert.match(contextText, /ai1 v0\.32\.0 renamed the lanes feature to sizing and migrated this repo: changed \.ai1\/config\.json\..*Nothing was committed/);
  assert.doesNotMatch(contextText, /old name of the sizing feature/);
});

test('the next session start runs nothing, and ai1 init gives the same result [rename-lanes-to-sizing:S3]', () => {
  const homeDirectory = createUserHome();
  const projectRoot = createTemporaryProject(OLD_CONFIG);
  startSessionThroughEntrypoint(projectRoot, homeDirectory);
  assert.deepEqual(JSON.parse(readFileSync(join(projectRoot, REPO_LEDGER_RELATIVE_PATH), 'utf8')), { applied: LATEST_MIGRATION_NUMBER });
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'work', '.gitignore'), 'utf8'), '*\n', 'the ledger never reaches git');
  assert.doesNotMatch(startSessionThroughEntrypoint(projectRoot, homeDirectory), /migrated/);

  const initRoot = createTemporaryProject(OLD_CONFIG);
  const setupResult = setupRepo(initRoot, { enabledFeatureIds: ['sizing'], verifyCommands: ['npm test'], userSettingsPath: join(homeDirectory, 'settings.json') });
  assert.notEqual(readConfig(initRoot).features.sizing, false);
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
  assert.deepEqual(JSON.parse(readFileSync(join(homeDirectory, '.config', 'ai1', 'migrations.json'), 'utf8')), { applied: LATEST_MIGRATION_NUMBER });
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

const WALKTHROUGH_CONFIG = { version: 1, features: { okf: false, walkthrough: true }, modules: { 'walkthrough-reminder': { ignore: ['emails/**'] } } };

function runGitIn(repoRoot, gitArguments) {
  execFileSync('git', ['-C', repoRoot, ...gitArguments], { stdio: 'ignore' });
}

function createGitRepo(ai1Config) {
  const repoRoot = createTemporaryProject(ai1Config);
  runGitIn(repoRoot, ['init', '-q', '-b', 'main']);
  runGitIn(repoRoot, ['add', '.']);
  runGitIn(repoRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return repoRoot;
}

test('a session start moves walkthrough to storyboard: config, folder and contents, with one line [rename-walkthrough-to-storyboard:S2]', () => {
  const projectRoot = createTemporaryProject(WALKTHROUGH_CONFIG);
  writeFile(join(projectRoot, '.ai1', 'walkthroughs', 'booking', 'steps.json'), '{"steps":[]}\n');
  writeFile(join(projectRoot, '.ai1', 'okf', 'features', 'ui.md'), 'Record with /ai1:walkthrough-record-flow and `ai1 walkthrough build`; files in .ai1/walkthroughs/.\n');
  const contextText = startSessionThroughEntrypoint(projectRoot, createUserHome());
  assert.deepEqual(readConfig(projectRoot).features, { storyboard: true }, 'okf false dropped by migration 4');
  assert.deepEqual(readConfig(projectRoot).modules, { 'storyboard-reminder': { ignore: ['emails/**'] } });
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'storyboards', 'booking', 'steps.json'), 'utf8'), '{"steps":[]}\n');
  assert.ok(!existsSync(join(projectRoot, '.ai1', 'walkthroughs')));
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'okf', 'features', 'ui.md'), 'utf8'), 'Record with /ai1:storyboard-record-flow and `ai1 storyboard build`; files in .ai1/storyboards/.\n');
  assert.match(contextText, /ai1 v0\.33\.0 renamed the walkthrough feature to storyboard and migrated this repo: changed \.ai1\/config\.json, \.ai1\/walkthroughs -> \.ai1\/storyboards/);
  assert.doesNotMatch(contextText, /old name of the storyboard feature/);
});

test('a symlinked walkthroughs folder moves as the same symlink, even with its target missing, and the exclude line follows [rename-walkthrough-to-storyboard:S3]', () => {
  const projectRoot = createGitRepo({ version: 1, features: { walkthrough: true } });
  const driveFolder = mkdtempSync(join(tmpdir(), 'ai1-drive-'));
  symlinkSync(driveFolder, join(projectRoot, '.ai1', 'walkthroughs'));
  writeFileSync(join(projectRoot, '.git', 'info', 'exclude'), '# local\n/.ai1/walkthroughs\n');
  const unmountedRoot = createGitRepo({ version: 1, features: { walkthrough: true } });
  symlinkSync(join(tmpdir(), 'ai1-unmounted-drive-that-does-not-exist'), join(unmountedRoot, '.ai1', 'walkthroughs'));

  runPendingMigrations(projectRoot, { includeUser: false });
  runPendingMigrations(unmountedRoot, { includeUser: false });
  assert.ok(lstatSync(join(projectRoot, '.ai1', 'storyboards')).isSymbolicLink());
  assert.equal(readlinkSync(join(projectRoot, '.ai1', 'storyboards')), driveFolder);
  assert.equal(readFileSync(join(projectRoot, '.git', 'info', 'exclude'), 'utf8'), '# local\n/.ai1/storyboards\n');
  assert.ok(lstatSync(join(unmountedRoot, '.ai1', 'storyboards')).isSymbolicLink(), 'a dangling symlink still moves');
});

test('an existing storyboards folder keeps the walkthroughs one in place; personal overlays move [rename-walkthrough-to-storyboard:S4]', () => {
  const homeDirectory = createUserHome();
  const projectRoot = createTemporaryProject(WALKTHROUGH_CONFIG);
  writeFile(join(projectRoot, '.ai1', 'walkthroughs', 'old', 'steps.json'), 'old\n');
  writeFile(join(projectRoot, '.ai1', 'storyboards', 'new', 'steps.json'), 'new\n');
  writeFile(join(homeDirectory, '.config', 'ai1', 'skills', 'walkthrough', 'overlay.md'), 'Save to .ai1/walkthroughs too.\n');
  const contextText = startSessionThroughEntrypoint(projectRoot, homeDirectory);
  assert.ok(existsSync(join(projectRoot, '.ai1', 'walkthroughs', 'old', 'steps.json')));
  assert.ok(existsSync(join(projectRoot, '.ai1', 'storyboards', 'new', 'steps.json')));
  assert.match(contextText, /left alone \.ai1\/walkthroughs \(\.ai1\/storyboards already exists/);
  assert.equal(readFileSync(join(homeDirectory, '.config', 'ai1', 'skills', 'storyboard', 'overlay.md'), 'utf8'), 'Save to .ai1/storyboards too.\n');
});

test('a session in a worktree migrates the main checkout too, where storyboards live [rename-walkthrough-to-storyboard:S5]', () => {
  const mainRoot = createGitRepo({ version: 1, features: { walkthrough: true } });
  const worktreeRoot = join(mkdtempSync(join(tmpdir(), 'ai1-wt-')), 'feature');
  runGitIn(mainRoot, ['worktree', 'add', '-q', '-b', 'feature', worktreeRoot]);
  writeFile(join(mainRoot, '.ai1', 'walkthroughs', 'booking', 'steps.json'), '{}\n');
  const contextText = startSessionThroughEntrypoint(worktreeRoot, createUserHome());
  assert.equal(readConfig(worktreeRoot).features.storyboard, true);
  assert.equal(readConfig(mainRoot).features.storyboard, true);
  assert.ok(existsSync(join(mainRoot, '.ai1', 'storyboards', 'booking', 'steps.json')));
  assert.match(contextText, /migrated the main checkout: .*\.ai1\/walkthroughs -> \.ai1\/storyboards/);
  assert.match(contextText, /migrated this repo: changed \.ai1\/config\.json/);
});

test('a session start drops the false values an old init wrote, shows their skills and says how to switch one off; a version 2 opt-out survives a fresh clone [all-on-by-default:S2] [all-on-by-default:S3]', () => {
  const projectRoot = createTemporaryProject({ version: 1, features: { okf: true, worktrees: false, later: false, design: false }, verify: ['npm test'] });
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ai1@ai1': true }, skillOverrides: { 'ai1:later-write': 'user-invocable-only', 'ai1:worktrees-plan-recipe': 'off' } }));
  const contextText = startSessionThroughEntrypoint(projectRoot, createUserHome());
  assert.deepEqual(readConfig(projectRoot).features, { okf: true });
  assert.equal(readConfig(projectRoot).version, 2);
  const skillOverrides = JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf8')).skillOverrides;
  assert.deepEqual(skillOverrides, { 'ai1:worktrees-plan-recipe': 'off' }, 'ai1 shows the skills it hid; the person\'s own off stays');
  assert.match(contextText, /ai1 v0\.36\.0 turns every feature on unless the repo switches it off and migrated this repo: changed \.ai1\/config\.json, \.claude\/settings\.json; switched on: worktrees, later, design; to switch one off again, `ai1 init --disable <feature,\.\.\.>`/);
  assert.match(contextText, /- later: Undecided changes noted down for later/, 'on in this same session');

  const clonedRoot = createTemporaryProject({ version: 2, features: { design: false } });
  startSessionThroughEntrypoint(clonedRoot, createUserHome());
  assert.deepEqual(readConfig(clonedRoot).features, { design: false }, 'no ledger in a clone, and the opt-out stays');
});
