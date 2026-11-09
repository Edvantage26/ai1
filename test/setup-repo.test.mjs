import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupRepo, describeRepo, CREDENTIAL_DENY_RULES } from '../src/cli/setup-repo.mjs';
import { findOverlappingPlugins, describeOverlap, readEnabledPlugins, localSettingsPathFor } from '../src/core/plugin-overlaps.mjs';
import { detectTrunkBranch } from '../src/core/git.mjs';
import { AI1_PLUGIN_ID, loadHarnessConfig } from '../src/core/config.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

function createGitRepo(branchName = 'main') {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-setup-'));
  execFileSync('git', ['-C', repoRoot, 'init', '-q', '-b', branchName]);
  writeFileSync(join(repoRoot, 'README.md'), 'x\n');
  execFileSync('git', ['-C', repoRoot, 'add', '.']);
  execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return repoRoot;
}

function writeUserSettings(enabledPlugins) {
  const settingsPath = join(mkdtempSync(join(tmpdir(), 'ai1-user-')), 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ enabledPlugins }));
  return settingsPath;
}

test('setup writes a valid .ai1/config.json and enables ai1 for the project', () => {
  const repoRoot = createGitRepo();
  const setupResult = setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'danger'] });
  assert.deepEqual(setupResult.features, { okf: true, danger: true, craft: false, lanes: false, worktrees: false, later: false, design: false, verify: false });
  const loadedConfig = loadHarnessConfig(repoRoot);
  assert.equal(loadedConfig.status, 'ok');
  assert.equal(loadedConfig.config.trunk, 'main');
  const projectSettings = readJson(join(repoRoot, '.claude', 'settings.json'));
  assert.equal(projectSettings.enabledPlugins[AI1_PLUGIN_ID], true);
  assert.deepEqual(projectSettings.extraKnownMarketplaces.ai1, { source: { source: 'github', repo: 'Edvantage26/ai1' } });
});

test('setup keeps existing settings and harness fields', () => {
  const repoRoot = createGitRepo();
  mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
  mkdirSync(join(repoRoot, '.claude'), { recursive: true });
  writeFileSync(join(repoRoot, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, enabledPlugins: { 'other@x': true } }));
  writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify({ trunk: 'develop', verify: ['make test'], modules: { danger: { ignore_rules: ['git-clean'] } } }));
  setupRepo(repoRoot, { enabledFeatureIds: ['danger'] });
  const projectSettings = readJson(join(repoRoot, '.claude', 'settings.json'));
  assert.deepEqual(projectSettings.permissions, { allow: ['Bash(ls)'] });
  assert.equal(projectSettings.enabledPlugins['other@x'], true);
  const ai1Config = readJson(join(repoRoot, '.ai1', 'config.json'));
  assert.equal(ai1Config.trunk, 'develop');
  assert.deepEqual(ai1Config.verify, ['make test']);
  assert.deepEqual(ai1Config.modules, { danger: { ignore_rules: ['git-clean'] } });
  assert.deepEqual(ai1Config.features, { okf: false, danger: true, craft: false, lanes: false, worktrees: false, later: false, design: false, verify: false });
});

test('status lists enabled plugins that overlap with ai1, applying local over project over user', () => {
  const repoRoot = createGitRepo();
  const userSettingsPath = writeUserSettings({ 'okf@some-marketplace': true, 'superpowers@official': true, 'feature-dev@official': true, 'jig@jig': true, 'okfish@x': true, 'playwright@official': true });
  mkdirSync(join(repoRoot, '.claude'));
  writeFileSync(join(repoRoot, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'jig@jig': false } }));
  writeFileSync(join(repoRoot, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'feature-dev@official': false } }));
  const overlappingPlugins = describeRepo(repoRoot, { userSettingsPath }).overlappingPlugins;
  assert.deepEqual(overlappingPlugins.map((overlappingPlugin) => [overlappingPlugin.pluginId, overlappingPlugin.action, overlappingPlugin.features]), [
    ['okf@some-marketplace', 'disable', ['okf']],
    ['superpowers@official', 'disable', ['lanes', 'worktrees', 'verify', 'craft']],
  ]);
});

test('findOverlappingPlugins keeps only the overlaps with the given features', () => {
  assert.deepEqual(findOverlappingPlugins(['superpowers@x', 'okf@y'], ['danger']), []);
  assert.deepEqual(findOverlappingPlugins(['superpowers@x'], ['verify']).map((overlappingPlugin) => overlappingPlugin.features), [['verify']]);
  assert.deepEqual(findOverlappingPlugins(['jig@jig'], []).map((overlappingPlugin) => overlappingPlugin.features), [null], 'the old ai1 overlaps whatever is enabled');
  assert.match(describeOverlap(findOverlappingPlugins(['jig@jig'], [])[0]), /^jig@jig overlaps with ai1: it is ai1 under its old name/);
});

test('init switches off only the plugins the person chose, in the personal settings', () => {
  const repoRoot = createGitRepo();
  const setupResult = setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'lanes'], disabledPluginIds: ['superpowers@official'] });
  assert.deepEqual(setupResult.disabledPlugins, ['superpowers@official']);
  assert.equal(readJson(join(repoRoot, '.claude', 'settings.local.json')).enabledPlugins['superpowers@official'], false);
  assert.equal(readJson(join(repoRoot, '.claude', 'settings.json')).enabledPlugins['superpowers@official'], undefined, 'shared settings stay clean');
  assert.equal(setupResult.gitignoreUpdated, true);
  assert.match(readFileSync(join(repoRoot, '.gitignore'), 'utf8'), /^\.claude\/settings\.local\.json$/m);
  execFileSync('git', ['-C', repoRoot, 'check-ignore', '-q', '.claude/settings.local.json']);
  assert.equal(setupRepo(repoRoot, { enabledFeatureIds: ['okf'], disabledPluginIds: ['okf@x'] }).gitignoreUpdated, false, 'not appended twice');
  const repoWithoutChoice = createGitRepo();
  const resultWithoutChoice = setupRepo(repoWithoutChoice, { enabledFeatureIds: ['okf'] });
  assert.deepEqual(resultWithoutChoice.disabledPlugins, [], 'nothing is switched off unless chosen');
  assert.equal(resultWithoutChoice.localSettingsPath, null);
});

test('in a worktree, plugins are disabled and read where Claude Code reads them: the main checkout', () => {
  const repoRoot = createGitRepo();
  const worktreePath = join(mkdtempSync(join(tmpdir(), 'ai1-wt-')), 'feature');
  execFileSync('git', ['-C', repoRoot, 'worktree', 'add', '-q', '-b', 'feature', worktreePath]);
  const setupResult = setupRepo(worktreePath, { enabledFeatureIds: ['lanes'], disabledPluginIds: ['superpowers@official'] });
  assert.equal(setupResult.localSettingsPath, localSettingsPathFor(worktreePath));
  assert.equal(readJson(join(repoRoot, '.claude', 'settings.local.json')).enabledPlugins['superpowers@official'], false);
  const userSettingsPath = writeUserSettings({ 'superpowers@official': true });
  assert.deepEqual(readEnabledPlugins(worktreePath, userSettingsPath), [AI1_PLUGIN_ID], 'the main checkout\'s local file applies in the worktree');
  mkdirSync(join(worktreePath, '.claude'), { recursive: true });
  writeFileSync(join(worktreePath, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': true } }));
  assert.deepEqual(readEnabledPlugins(worktreePath, userSettingsPath), [AI1_PLUGIN_ID], 'a copy left in the worktree is below the main checkout\'s');
  assert.equal(localSettingsPathFor(worktreePath, 'win32'), join(worktreePath, '.claude', 'settings.local.json'), 'Windows keeps it next to settings.json');
});

test('init refuses to disable ai1 itself or a malformed plugin id', () => {
  const repoRoot = createGitRepo();
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf'], disabledPluginIds: [AI1_PLUGIN_ID] }), /cannot be disabled/);
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf'], disabledPluginIds: ['superpowers'] }), /not plugin ids/);
  assert.equal(describeRepo(repoRoot).hasAi1Config, false);
});

test('unknown features are refused and nothing is written', () => {
  const repoRoot = createGitRepo();
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['teleport'] }), /unknown features: teleport/);
  assert.equal(describeRepo(repoRoot).hasAi1Config, false);
});

test('trunk detection prefers origin/HEAD, then main/master, then the current branch', () => {
  assert.equal(detectTrunkBranch(createGitRepo('master')), 'master');
  assert.equal(detectTrunkBranch(createGitRepo('develop')), 'develop');
});

test('status reports defaults before setup and choices after it', () => {
  const repoRoot = createGitRepo();
  const beforeSetup = describeRepo(repoRoot);
  assert.equal(beforeSetup.hasAi1Config, false);
  assert.deepEqual(beforeSetup.features.map((featureStatus) => [featureStatus.id, featureStatus.enabled]), [['okf', true], ['danger', true], ['craft', true], ['lanes', false], ['worktrees', false], ['later', false], ['design', false], ['verify', true]]);
  setupRepo(repoRoot, { enabledFeatureIds: ['okf'] });
  const afterSetup = describeRepo(repoRoot);
  assert.deepEqual(afterSetup.features.map((featureStatus) => [featureStatus.id, featureStatus.enabled]), [['okf', true], ['danger', false], ['craft', false], ['lanes', false], ['worktrees', false], ['later', false], ['design', false], ['verify', false]]);
});

test('the ai1 CLI runs init and status from a subdirectory', () => {
  const repoRoot = createGitRepo();
  mkdirSync(join(repoRoot, 'src'));
  const environment = { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'ai1-home-')) };
  const initRun = spawnSync(process.execPath, [AI1_CLI, 'init', '--features', 'okf,danger', '--verify', 'npm test', '--json'], { cwd: join(repoRoot, 'src'), encoding: 'utf8', env: environment });
  assert.equal(initRun.status, 0, initRun.stderr);
  assert.equal(JSON.parse(initRun.stdout).ai1ConfigPath, join(repoRoot, '.ai1', 'config.json'));
  assert.deepEqual(readJson(join(repoRoot, '.ai1', 'config.json')).verify, ['npm test']);
  const statusRun = spawnSync(process.execPath, [AI1_CLI, 'status'], { cwd: repoRoot, encoding: 'utf8', env: environment });
  assert.match(statusRun.stdout, /\[x\] okf/);
  const badRun = spawnSync(process.execPath, [AI1_CLI, 'init', '--features', 'nope'], { cwd: repoRoot, encoding: 'utf8', env: environment });
  assert.equal(badRun.status, 1);
  assert.match(badRun.stderr, /unknown features: nope/);
});

test('init refuses the retired rfc feature id with the new name', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-setup-'));
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'rfc'] }), /the rfc feature is called later since v0\.24\.0/);
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: ['okf', 'proposals'] }), /the proposals feature is called later since v0\.24\.0/);
});

test('describeRepo lists the active repo rules and why the others are ignored', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-status-rules-'));
  mkdirSync(join(repoRoot, '.ai1'));
  writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify({ rules: [{ id: 'use-pnpm', on: 'bash', pattern: '^npm i', action: 'deny', message: 'pnpm' }, { id: 'x' }] }));
  const { repoRules } = describeRepo(repoRoot, { userSettingsPath: join(repoRoot, 'none.json') });
  assert.deepEqual(repoRules.active, ['use-pnpm']);
  assert.match(repoRules.ignored[0], /rules\[1\] \(x\) is ignored/);
});

test('setupRepo adds the credential deny rules once, keeping existing ones; describeRepo counts them', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-deny-'));
  mkdirSync(join(repoRoot, '.claude'));
  writeFileSync(join(repoRoot, '.claude', 'settings.json'), JSON.stringify({ permissions: { deny: ['Bash(rm -rf *)', 'Read(~/.netrc)'] } }));
  const userSettingsPath = join(repoRoot, 'none.json');
  assert.equal(describeRepo(repoRoot, { userSettingsPath }).credentialDenyRules.present, 1);
  const firstSetup = setupRepo(repoRoot, { enabledFeatureIds: ['danger'], denyCredentials: true });
  assert.equal(firstSetup.addedDenyRules.length, CREDENTIAL_DENY_RULES.length - 1);
  const denyRules = JSON.parse(readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8')).permissions.deny;
  assert.deepEqual(denyRules.slice(0, 2), ['Bash(rm -rf *)', 'Read(~/.netrc)']);
  assert.equal(denyRules.length, CREDENTIAL_DENY_RULES.length + 1);
  assert.ok(!denyRules.some((denyRule) => denyRule.includes('.env')), '.env files stay readable');
  assert.deepEqual(setupRepo(repoRoot, { enabledFeatureIds: ['danger'], denyCredentials: true }).addedDenyRules, []);
  assert.deepEqual(describeRepo(repoRoot, { userSettingsPath }).credentialDenyRules, { present: CREDENTIAL_DENY_RULES.length, total: CREDENTIAL_DENY_RULES.length });
  const withoutFlag = mkdtempSync(join(tmpdir(), 'ai1-nodeny-'));
  setupRepo(withoutFlag, { enabledFeatureIds: ['danger'] });
  assert.equal(JSON.parse(readFileSync(join(withoutFlag, '.claude', 'settings.json'), 'utf8')).permissions, undefined);
});

test('setupRepo writes the report preference in the user settings only; describeRepo reads it', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ai1-report-'));
  const userSettingsPath = join(mkdtempSync(join(tmpdir(), 'ai1-user-')), '.claude', 'settings.json');
  assert.equal(describeRepo(repoRoot, { userSettingsPath }).reportErrors, null);
  mkdirSync(join(userSettingsPath, '..'), { recursive: true });
  writeFileSync(userSettingsPath, JSON.stringify({ env: { OTHER: '1' }, model: 'x' }));
  setupRepo(repoRoot, { enabledFeatureIds: ['danger'], reportErrors: 'auto', userSettingsPath });
  assert.deepEqual(JSON.parse(readFileSync(userSettingsPath, 'utf8')), { env: { OTHER: '1', AI1_REPORT_ERRORS: 'auto' }, model: 'x' });
  assert.equal(describeRepo(repoRoot, { userSettingsPath }).reportErrors, 'auto');
  assert.ok(!readFileSync(join(repoRoot, '.claude', 'settings.json'), 'utf8').includes('AI1_REPORT_ERRORS'), 'never in the repo');
  assert.throws(() => setupRepo(repoRoot, { enabledFeatureIds: [], reportErrors: 'always', userSettingsPath }), /must be ask, auto, off/);
});
