import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRepo, describeRepo, detectTrunkBranch, findOtherOkfPlugins, JIG_PLUGIN_ID } from '../src/cli/setup-repo.mjs';
import { loadHarnessConfig } from '../src/core/config.mjs';

const JIG_CLI = fileURLToPath(new URL('../bin/jig', import.meta.url));
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

function createGitRepo(branchName = 'main') {
  const repoRoot = mkdtempSync(join(tmpdir(), 'jig-setup-'));
  execFileSync('git', ['-C', repoRoot, 'init', '-q', '-b', branchName]);
  writeFileSync(join(repoRoot, 'README.md'), 'x\n');
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return repoRoot;
}

function writeUserSettings(enabledPlugins) {
  const settingsPath = join(mkdtempSync(join(tmpdir(), 'jig-user-')), 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ enabledPlugins }));
  return settingsPath;
}

test('setup writes a valid jig.json and enables jig for the project', () => {
  const repoRoot = createGitRepo();
  const setupResult = setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'danger'], userSettingsPath: writeUserSettings({}) });
  assert.deepEqual(setupResult.features, { okf: true, danger: true, craft: false, lanes: false });
  const loadedConfig = loadHarnessConfig(repoRoot);
  assert.equal(loadedConfig.status, 'ok');
  assert.equal(loadedConfig.config.trunk, 'main');
  const projectSettings = readJson(join(repoRoot, '.claude', 'settings.json'));
  assert.equal(projectSettings.enabledPlugins[JIG_PLUGIN_ID], true);
  assert.deepEqual(projectSettings.extraKnownMarketplaces.jig, { source: { source: 'github', repo: 'Edvantage26/jig' } });
});

test('setup keeps existing settings and harness fields', () => {
  const repoRoot = createGitRepo();
  mkdirSync(join(repoRoot, '.claude'));
  writeFileSync(join(repoRoot, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'other@x': true } }));
  writeFileSync(join(repoRoot, '.claude', 'jig.json'), JSON.stringify({ trunk: 'develop', verify: ['make test'], modules: { danger: { ignore_rules: ['git-clean'] } } }));
  setupRepo(repoRoot, { enabledFeatureIds: ['danger'], userSettingsPath: writeUserSettings({}) });
  const projectSettings = readJson(join(repoRoot, '.claude', 'settings.json'));
  assert.deepEqual(projectSettings.permissions, { allow: ['Bash(ls)'] });
  assert.equal(projectSettings.enabledPlugins['other@x'], true);
  const jigConfig = readJson(join(repoRoot, '.claude', 'jig.json'));
  assert.equal(jigConfig.trunk, 'develop');
  assert.deepEqual(jigConfig.verify, ['make test']);
  assert.deepEqual(jigConfig.modules, { danger: { ignore_rules: ['git-clean'] } });
  assert.deepEqual(jigConfig.features, { okf: false, danger: true, craft: false, lanes: false });
});

test('with okf on, a standalone okf plugin is switched off in the personal settings only', () => {
  const repoRoot = createGitRepo();
  const userSettingsPath = writeUserSettings({ 'okf@some-marketplace': true, 'okfish@x': true, 'okf@disabled': false });
  const setupResult = setupRepo(repoRoot, { enabledFeatureIds: ['okf'], userSettingsPath });
  assert.deepEqual(setupResult.disabledPlugins, ['okf@some-marketplace']);
  assert.equal(readJson(join(repoRoot, '.claude', 'settings.local.json')).enabledPlugins['okf@some-marketplace'], false);
  assert.equal(readJson(join(repoRoot, '.claude', 'settings.json')).enabledPlugins['okf@some-marketplace'], undefined, 'shared settings stay clean');
  assert.equal(setupResult.gitignoreUpdated, true);
  assert.match(readFileSync(join(repoRoot, '.gitignore'), 'utf8'), /^\.claude\/settings\.local\.json$/m);
  execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', '.claude/settings.local.json']);
  assert.equal(setupRepo(repoRoot, { enabledFeatureIds: ['okf'], userSettingsPath }).gitignoreUpdated, false, 'not appended twice');
  const repoWithoutOkf = createGitRepo();
  assert.deepEqual(setupRepo(repoWithoutOkf, { enabledFeatureIds: ['danger'], userSettingsPath }).disabledPlugins, []);
});

test('unknown features are refused and nothing is written', () => {
  const repoRoot = createGitRepo();
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['teleport'], userSettingsPath: writeUserSettings({}) }), /unknown features: teleport/);
  assert.equal(describeRepo(repoRoot).hasJigConfig, false);
});

test('trunk detection prefers origin/HEAD, then main/master, then the current branch', () => {
  assert.equal(detectTrunkBranch(createGitRepo('master')), 'master');
  assert.equal(detectTrunkBranch(createGitRepo('develop')), 'develop');
});

test('findOtherOkfPlugins only returns enabled okf@ plugins', () => {
  assert.deepEqual(findOtherOkfPlugins({ enabledPlugins: { 'okf@a': true, 'okf@b': false, 'jig@jig': true } }), ['okf@a']);
  assert.deepEqual(findOtherOkfPlugins(null), []);
});

test('status reports defaults before setup and choices after it', () => {
  const repoRoot = createGitRepo();
  const beforeSetup = describeRepo(repoRoot);
  assert.equal(beforeSetup.hasJigConfig, false);
  assert.deepEqual(beforeSetup.features.map((featureStatus) => [featureStatus.id, featureStatus.enabled]), [['okf', true], ['danger', true], ['craft', true], ['lanes', false]]);
  setupRepo(repoRoot, { enabledFeatureIds: ['okf'], userSettingsPath: writeUserSettings({}) });
  const afterSetup = describeRepo(repoRoot);
  assert.deepEqual(afterSetup.features.map((featureStatus) => [featureStatus.id, featureStatus.enabled]), [['okf', true], ['danger', false], ['craft', false], ['lanes', false]]);
});

test('the jig CLI runs init and status from a subdirectory', () => {
  const repoRoot = createGitRepo();
  mkdirSync(join(repoRoot, 'src'));
  const environment = { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'jig-home-')) };
  const initRun = spawnSync(process.execPath, [JIG_CLI, 'init', '--features', 'okf,danger', '--verify', 'npm test', '--json'], { cwd: join(repoRoot, 'src'), encoding: 'utf8', env: environment });
  assert.equal(initRun.status, 0, initRun.stderr);
  assert.equal(JSON.parse(initRun.stdout).jigConfigPath, join(repoRoot, '.claude', 'jig.json'));
  assert.deepEqual(readJson(join(repoRoot, '.claude', 'jig.json')).verify, ['npm test']);
  const statusRun = spawnSync(process.execPath, [JIG_CLI, 'status'], { cwd: repoRoot, encoding: 'utf8', env: environment });
  assert.match(statusRun.stdout, /\[x\] okf/);
  const badRun = spawnSync(process.execPath, [JIG_CLI, 'init', '--features', 'nope'], { cwd: repoRoot, encoding: 'utf8', env: environment });
  assert.equal(badRun.status, 1);
  assert.match(badRun.stderr, /unknown features: nope/);
});
