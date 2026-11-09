import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateHarnessConfig, listUnknownConfigEntries, loadHarnessConfig, isModuleEnabled, renameRetiredIds } from '../src/core/config.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { KNOWN_MODULE_IDS } from '../src/core/registry.mjs';
import { DANGER_RULES } from '../src/guards/danger.mjs';
import { FEATURES } from '../src/core/features.mjs';
import { createTemporaryProject } from './helpers.mjs';

const readJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));

test('every shipped template is a valid contract', () => {
  for (const templateName of readdirSync(new URL('../templates/', import.meta.url)).filter((fileName) => fileName.endsWith('.json'))) {
    assert.deepEqual(validateHarnessConfig(readJson(`templates/${templateName}`)), [], templateName);
    assert.deepEqual(listUnknownConfigEntries(readJson(`templates/${templateName}`), KNOWN_MODULE_IDS), [], templateName);
  }
});

test('invalid contracts are reported with a readable reason', () => {
  assert.match(validateHarnessConfig({ features: { okf: 'yes' } }).join(), /features.okf/);
  assert.match(validateHarnessConfig({ verify: 'npm test' }).join(), /verify/);
  assert.match(validateHarnessConfig({ version: 2 }).join(), /version/);
  assert.match(validateHarnessConfig([]).join(), /JSON object/);
});

test('names from a newer ai1 are warnings, not errors', () => {
  const newerConfig = { features: { okf: true, teleport: true }, surprise: 1, modules: { nope: true } };
  assert.deepEqual(validateHarnessConfig(newerConfig), []);
  assert.deepEqual(listUnknownConfigEntries(newerConfig, KNOWN_MODULE_IDS), ['field "surprise"', 'feature "teleport"', 'module "nope"']);
  const projectRoot = createTemporaryProject({ features: { okf: false, teleport: true } });
  const loadedConfig = loadHarnessConfig(projectRoot, KNOWN_MODULE_IDS);
  assert.equal(loadedConfig.status, 'ok');
  assert.deepEqual(loadedConfig.unknownEntries, ['feature "teleport"']);
  const reportedErrors = [];
  const sessionOutput = runHookEvent('SessionStart', { session_id: 's', cwd: projectRoot }, { reportInternalError: (errorMessage) => reportedErrors.push(errorMessage) });
  const contextText = sessionOutput.hookSpecificOutput.additionalContext;
  assert.match(contextText, /ai1 harness is active/, 'the rest of ai1 keeps working');
  assert.match(contextText, /feature "teleport", which this ai1 version does not know.*update the ai1 plugin/);
  assert.match(reportedErrors.join(), /unknown to this ai1 version/);
});

test('load reports missing, invalid JSON and merges defaults', () => {
  assert.equal(loadHarnessConfig(createTemporaryProject()).status, 'missing');
  assert.equal(loadHarnessConfig(createTemporaryProject('{ not json')).status, 'invalid');
  const loadedConfig = loadHarnessConfig(createTemporaryProject({ features: { danger: false } }));
  assert.equal(loadedConfig.status, 'ok');
  assert.equal(loadedConfig.config.trunk, 'main');
  assert.deepEqual(loadedConfig.config.verify, []);
  assert.equal(loadedConfig.config.knowledge, undefined);
  assert.deepEqual(loadedConfig.notices, []);
});

test('the retired knowledge setting: the fixed path is silent, anything else is a notice, never an error', () => {
  for (const samePath of ['.ai1/okf', './.ai1/okf/']) {
    const loadedConfig = loadHarnessConfig(createTemporaryProject({ knowledge: samePath }));
    assert.equal(loadedConfig.status, 'ok');
    assert.deepEqual(loadedConfig.notices, [], samePath);
    assert.deepEqual(loadedConfig.unknownEntries, []);
  }
  for (const otherSetting of ['docs/kb', null, 42]) {
    const loadedConfig = loadHarnessConfig(createTemporaryProject({ knowledge: otherSetting }));
    assert.equal(loadedConfig.status, 'ok', 'the guards keep working');
    assert.equal(loadedConfig.config.knowledge, undefined);
    assert.match(loadedConfig.notices[0], /"knowledge": .*no longer supports: the knowledge bundle is always \.ai1\/okf\/.*\/ai1:core-setup-repo/);
  }
});

test('modules follow their feature; a single module can still be switched off', () => {
  const okfModule = { id: 'okf-upkeep', feature: 'okf' };
  const coreModule = { id: 'brief', feature: 'core' };
  assert.equal(isModuleEnabled(okfModule, { features: {}, modules: {} }), true, 'okf is on by default');
  assert.equal(isModuleEnabled(okfModule, { features: { okf: false }, modules: {} }), false);
  assert.equal(isModuleEnabled(okfModule, { features: {}, modules: { 'okf-upkeep': false } }), false);
  assert.equal(isModuleEnabled(okfModule, { features: {}, modules: { 'okf-upkeep': { enabled: false } } }), false);
  assert.equal(isModuleEnabled(coreModule, { features: { core: false }, modules: {} }), true, 'core is always on');
  assert.equal(isModuleEnabled({ id: 'x', feature: 'unknown' }, { features: {}, modules: {} }), false);
});

test('schema lists every module, every user-facing feature and every danger rule', () => {
  const harnessSchema = readJson('schema/ai1.schema.json');
  const selectableFeatureIds = FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn).map((featureDefinition) => featureDefinition.id);
  // Retired names stay in the schema as `deprecated`, so editors do not flag a config before migration.
  const currentKeys = (schemaProperties) => Object.keys(schemaProperties).filter((propertyName) => !schemaProperties[propertyName].deprecated);
  assert.deepEqual(currentKeys(harnessSchema.properties.features.properties).sort(), selectableFeatureIds.sort());
  assert.deepEqual(currentKeys(harnessSchema.properties.modules.properties).sort(), [...KNOWN_MODULE_IDS].sort());
  const schemaRuleIds = harnessSchema.properties.modules.properties.danger.oneOf[1].properties.ignore_rules.items.enum;
  assert.deepEqual([...schemaRuleIds].sort(), DANGER_RULES.map((dangerRule) => dangerRule.id).sort());
});

test('retired rfc and proposals names: ignored with one notice, never unknown nor an error; renameRetiredIds lets the new name win', () => {
  const oldNamesRepo = createTemporaryProject({ features: { rfc: true }, modules: { 'rfc-recall': false } });
  mkdirSync(join(oldNamesRepo, '.ai1', 'rfc'));
  const loadedConfig = loadHarnessConfig(oldNamesRepo, KNOWN_MODULE_IDS);
  assert.equal(loadedConfig.status, 'ok');
  assert.deepEqual(loadedConfig.unknownEntries, []);
  assert.match(loadedConfig.notices[0], /old name of the later feature \(features\.rfc, modules\.rfc-recall, \.ai1\/rfc\/\).*proposals to later in v0\.25\.0.*\/ai1:core-setup-repo/);
  assert.equal(isModuleEnabled({ id: 'later-brief', feature: 'later' }, loadedConfig.config), false, 'not aliased');
  const proposalsRepo = createTemporaryProject({ features: { proposals: true }, modules: { 'proposals-upkeep': false } });
  mkdirSync(join(proposalsRepo, '.ai1', 'proposals'));
  const proposalsConfig = loadHarnessConfig(proposalsRepo, KNOWN_MODULE_IDS);
  assert.deepEqual(proposalsConfig.unknownEntries, []);
  assert.match(proposalsConfig.notices[0], /\(features\.proposals, modules\.proposals-upkeep, \.ai1\/proposals\/\)/);
  assert.equal(isModuleEnabled({ id: 'later-brief', feature: 'later' }, proposalsConfig.config), false, 'not aliased');
  assert.deepEqual(loadHarnessConfig(createTemporaryProject({ features: { later: true } }), KNOWN_MODULE_IDS).notices, []);
  assert.deepEqual(renameRetiredIds({ features: { rfc: true, okf: false }, modules: { 'rfc-upkeep': false } }), { features: { okf: false, later: true }, modules: { 'later-upkeep': false } });
  assert.deepEqual(renameRetiredIds({ features: { proposals: true }, modules: { 'proposals-recall': false } }), { features: { later: true }, modules: { 'later-recall': false } });
  assert.deepEqual(renameRetiredIds({ features: { proposals: true, later: false } }).features, { later: false }, 'both set: the new name wins');
});
