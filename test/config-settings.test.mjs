import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { configRepoDirectory } from '../src/config/config-repo.mjs';
import { planSettingsSync, runSettingsSync, settingsTargetPath } from '../src/config/config-settings.mjs';

function writeJson(filePath, jsonValue) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(jsonValue, null, 2)}\n`);
}
const readJson = (filePath) => JSON.parse(readFileSync(filePath, 'utf8'));

function createSetup() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const pathOptions = { homeDirectory, environment: {} };
  const repoDirectory = configRepoDirectory(pathOptions);
  writeJson(join(repoDirectory, 'claude', 'settings.json'), { env: { MY_FLAG: '1' }, enabledPlugins: { 'tool@market': true }, permissions: { allow: ['Bash(ls)'] } });
  writeJson(join(repoDirectory, 'machines', 'box-1', 'claude', 'settings.json'), { env: { MY_FLAG: '1', LOCAL_PATH: '/opt' } });
  writeJson(join(homeDirectory, '.config', 'ai1', 'config-state.json'), { machine: 'box-1', files: {} });
  writeJson(settingsTargetPath(pathOptions), { feedbackSurveyState: { seen: 3 }, model: 'old-model' });
  return { homeDirectory, pathOptions, repoDirectory };
}

const kindsByKey = (plan) => Object.fromEntries(plan.actions.map((action) => [action.key, action.kind]));

test('settings.json by keys: the person\'s keys go to the target (the machine\'s key replacing the common one), Claude Code\'s own keys are left alone [ai1-config:S4]', () => {
  const { pathOptions, repoDirectory } = createSetup();
  const plan = planSettingsSync(repoDirectory, { pathOptions });
  assert.equal(kindsByKey(plan).env, 'install');
  assert.equal(kindsByKey(plan).model, 'capture', 'a person key only in the target is taken into the repo');
  runSettingsSync(repoDirectory, plan, { pathOptions });
  const targetSettings = readJson(settingsTargetPath(pathOptions));
  assert.deepEqual(targetSettings.env, { MY_FLAG: '1', LOCAL_PATH: '/opt' });
  assert.deepEqual(targetSettings.enabledPlugins, { 'tool@market': true });
  assert.deepEqual(targetSettings.feedbackSurveyState, { seen: 3 });
  assert.equal(readJson(join(repoDirectory, 'claude', 'settings.json')).model, 'old-model');
  assert.equal(readJson(join(repoDirectory, 'claude', 'settings.json')).feedbackSurveyState, undefined);
  assert.ok(Object.values(kindsByKey(planSettingsSync(repoDirectory, { pathOptions }))).every((kind) => kind === 'in-sync'));
});

test('then: Claude Code installing a plugin is captured into the common file; a change on both sides of one key is a conflict that touches nothing; other keys still move [ai1-config:S4]', () => {
  const { pathOptions, repoDirectory } = createSetup();
  runSettingsSync(repoDirectory, planSettingsSync(repoDirectory, { pathOptions }), { pathOptions });
  const targetPath = settingsTargetPath(pathOptions);
  writeJson(targetPath, { ...readJson(targetPath), enabledPlugins: { 'tool@market': true, 'new@market': true }, permissions: { allow: ['Bash(ls)', 'Bash(git status)'] }, someInternalState: 1 });
  const repoSettingsPath = join(repoDirectory, 'claude', 'settings.json');
  writeJson(repoSettingsPath, { ...readJson(repoSettingsPath), permissions: { allow: ['Bash(pwd)'] } });
  const plan = planSettingsSync(repoDirectory, { pathOptions });
  assert.equal(kindsByKey(plan).enabledPlugins, 'capture');
  assert.equal(kindsByKey(plan).permissions, 'conflict');
  const { conflicts } = runSettingsSync(repoDirectory, plan, { pathOptions });
  assert.deepEqual(conflicts.map((conflict) => conflict.key), ['permissions']);
  assert.deepEqual(readJson(repoSettingsPath).enabledPlugins, { 'tool@market': true, 'new@market': true });
  assert.deepEqual(readJson(repoSettingsPath).permissions, { allow: ['Bash(pwd)'] });
  assert.deepEqual(readJson(targetPath).permissions, { allow: ['Bash(ls)', 'Bash(git status)'] });
  assert.equal(readJson(repoSettingsPath).someInternalState, undefined);
});

test('a target that is not a JSON object is never overwritten', () => {
  const { pathOptions, repoDirectory } = createSetup();
  writeFileSync(settingsTargetPath(pathOptions), '{ broken');
  const plan = planSettingsSync(repoDirectory, { pathOptions });
  assert.equal(plan.targetUnreadable, true);
  assert.deepEqual(plan.actions, []);
});
