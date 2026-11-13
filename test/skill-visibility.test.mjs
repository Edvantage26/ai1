import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySkillVisibility, findSkillVisibilityDrift } from '../src/core/skill-visibility.mjs';
import { buildHarnessBrief } from '../src/context/brief.mjs';
import { setupRepo } from '../src/cli/setup-repo.mjs';
import { runPendingMigrations } from '../src/core/migrations.mjs';
import { KNOWN_FEATURE_IDS } from '../src/core/features.mjs';
import { createTemporaryProject } from './helpers.mjs';

const LATER_OFF_CONFIG = { version: 2, trunk: 'main', verify: [], features: { okf: true, later: false, storyboard: false } };

function readProjectSettings(projectRoot) {
  return JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.json'), 'utf8'));
}

test('skill visibility: skills of disabled features leave the agent list, core and session skills stay', () => {
  const { skillOverrides } = applySkillVisibility({}, LATER_OFF_CONFIG);
  assert.equal(skillOverrides['ai1:later-write'], 'user-invocable-only');
  assert.equal(skillOverrides['ai1:storyboard-record-flow'], 'user-invocable-only');
  assert.equal(skillOverrides['ai1:okf-maintain-knowledge'], undefined, 'okf is on');
  assert.equal(skillOverrides['ai1:core-setup-repo'], undefined, 'core is always on');
  assert.equal(skillOverrides['ai1:session-fork-conversation'], undefined, 'session is not a feature');
});

test('skill visibility: turning a feature back on removes only what ai1 wrote; other overrides are kept', () => {
  const projectSettings = { skillOverrides: { 'ai1:later-write': 'user-invocable-only', 'ai1:storyboard-record-flow': 'off', 'other:skill': 'name-only' } };
  const allOnConfig = { ...LATER_OFF_CONFIG, features: Object.fromEntries(KNOWN_FEATURE_IDS.map((featureId) => [featureId, true])) };
  assert.deepEqual(applySkillVisibility(projectSettings, allOnConfig).skillOverrides, { 'ai1:storyboard-record-flow': 'off', 'other:skill': 'name-only' });
  assert.deepEqual(applySkillVisibility({ skillOverrides: { 'ai1:later-write': 'user-invocable-only' } }, allOnConfig), {}, 'an emptied skillOverrides goes away');
  assert.equal(applySkillVisibility(projectSettings, LATER_OFF_CONFIG).skillOverrides['ai1:storyboard-record-flow'], 'off', 'the person\'s stronger choice stays');
});

test('skill visibility: drift lists skills shown though their feature is off, or hidden though it is on', () => {
  assert.deepEqual(findSkillVisibilityDrift(applySkillVisibility({}, LATER_OFF_CONFIG), LATER_OFF_CONFIG), []);
  const laterOnConfig = { ...LATER_OFF_CONFIG, features: { ...LATER_OFF_CONFIG.features, later: true } };
  assert.deepEqual(findSkillVisibilityDrift(applySkillVisibility({}, LATER_OFF_CONFIG), laterOnConfig), ['ai1:later-write']);
  assert.ok(findSkillVisibilityDrift({}, LATER_OFF_CONFIG).includes('ai1:later-write'));
});

test('skill visibility: the session brief warns only on drift', () => {
  const syncedSettings = applySkillVisibility({}, LATER_OFF_CONFIG);
  assert.doesNotMatch(buildHarnessBrief(LATER_OFF_CONFIG, [], [], syncedSettings), /do not match its features/);
  assert.match(buildHarnessBrief(LATER_OFF_CONFIG, [], [], {}), /do not match its features \(.*ai1:later-write.*\).*`ai1 init`/);
});

test('skill visibility: ai1 init writes skillOverrides for the features left off', () => {
  const projectRoot = createTemporaryProject();
  const userSettingsPath = join(mkdtempSync(join(tmpdir(), 'ai1-home-')), 'settings.json');
  setupRepo(projectRoot, { enabledFeatureIds: ['okf', 'later'], userSettingsPath });
  const projectSettings = readProjectSettings(projectRoot);
  assert.equal(projectSettings.skillOverrides['ai1:storyboard-record-flow'], 'user-invocable-only');
  assert.equal(projectSettings.skillOverrides['ai1:later-write'], undefined);
  assert.equal(projectSettings.enabledPlugins['ai1@ai1'], true);
});

test('skill visibility: migration 3 brings an already set up repo in step, once', () => {
  const projectRoot = createTemporaryProject(LATER_OFF_CONFIG);
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'ai1@ai1': true } }));
  const migrationReports = runPendingMigrations(projectRoot, { includeUser: false });
  assert.deepEqual(migrationReports.find((migrationReport) => migrationReport.migration === 'skill-visibility').changed, ['.claude/settings.json']);
  assert.equal(readProjectSettings(projectRoot).skillOverrides['ai1:later-write'], 'user-invocable-only');
  assert.deepEqual(runPendingMigrations(projectRoot, { includeUser: false }), []);
});
