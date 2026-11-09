// Loads and validates the per-repo contract, `.ai1/config.json`.
// The JSON schema in schema/ai1.schema.json describes the same rules for editors; this
// validator is hand-written so ai1 keeps zero dependencies. test/config.test.mjs checks that
// both agree on the shipped templates.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_FEATURE_IDS, isFeatureEnabled } from './features.mjs';
import { splitRepoRules } from './repo-rules-config.mjs';

// Everything ai1 writes in a repo lives under `.ai1/`: config, knowledge bundle, later entries, work plans.
export const AI1_DIRECTORY = '.ai1';
export const CONFIG_RELATIVE_PATH = join(AI1_DIRECTORY, 'config.json');
// The OKF knowledge bundle always lives here (a fixed path since v0.16.0; `knowledge` is retired).
export const KNOWLEDGE_BUNDLE_PATH = `${AI1_DIRECTORY}/okf`;
// Work plans and handoffs; ignores itself, never reaches git.
export const WORK_DIRECTORY = `${AI1_DIRECTORY}/work`;
// Later (feature `later`): undecided changes noted down for later, one file each, versioned.
export const LATER_DIRECTORY = `${AI1_DIRECTORY}/later`;
export const AI1_PLUGIN_ID = 'ai1@ai1';
export const SCHEMA_URL = 'https://raw.githubusercontent.com/Edvantage26/ai1/main/schema/ai1.schema.json';
export const SUPPORTED_CONFIG_VERSION = 1;

// `knowledge` is retired, not unknown: it gets its own notice (see readRetiredKnowledgeNotice).
const KNOWN_TOP_LEVEL_FIELDS = new Set(['$schema', 'version', 'features', 'trunk', 'verify', 'knowledge', 'modules', 'rules']);

const DEFAULT_CONFIG = {
  version: SUPPORTED_CONFIG_VERSION,
  features: {},
  trunk: 'main',
  verify: [],
  modules: {},
  rules: [],
};

// Names retired by a rename (v0.18.0: rfc -> proposals; v0.25.0: proposals -> later). Not aliased:
// they are ignored with a notice until `ai1 init` rewrites them (renameRetiredIds).
const RENAMED_FEATURE_IDS = { rfc: 'later', proposals: 'later' };
const RENAMED_MODULE_IDS = {
  'rfc-brief': 'later-brief', 'rfc-recall': 'later-recall', 'rfc-upkeep': 'later-upkeep',
  'proposals-brief': 'later-brief', 'proposals-recall': 'later-recall', 'proposals-upkeep': 'later-upkeep',
};
export const RETIRED_RFC_DIRECTORY = `${AI1_DIRECTORY}/rfc`;
export const RETIRED_PROPOSALS_DIRECTORY = `${AI1_DIRECTORY}/proposals`;

// The config with retired feature and module ids renamed (when both names are set, the new one wins).
export function renameRetiredIds(rawConfig) {
  if (!rawConfig || typeof rawConfig !== 'object') return rawConfig;
  const renameKeys = (settings, renamedIds) => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return settings;
    const renamedSettings = {};
    for (const [settingId, settingValue] of Object.entries(settings)) {
      const newId = renamedIds[settingId];
      if (!newId) renamedSettings[settingId] = settingValue;
      else if (!Object.hasOwn(settings, newId)) renamedSettings[newId] = settingValue;
    }
    return renamedSettings;
  };
  return { ...rawConfig, features: renameKeys(rawConfig.features, RENAMED_FEATURE_IDS), modules: renameKeys(rawConfig.modules, RENAMED_MODULE_IDS) };
}

// What still uses a retired name: config keys, or an old folder on disk.
function readRenamedNamesNotice(rawConfig, projectRoot) {
  const retiredNames = [
    ...Object.keys(rawConfig.features || {}).filter((featureId) => RENAMED_FEATURE_IDS[featureId]).map((featureId) => `features.${featureId}`),
    ...Object.keys(rawConfig.modules || {}).filter((moduleId) => RENAMED_MODULE_IDS[moduleId]).map((moduleId) => `modules.${moduleId}`),
    ...[RETIRED_RFC_DIRECTORY, RETIRED_PROPOSALS_DIRECTORY].filter((retiredDirectory) => existsSync(join(projectRoot, retiredDirectory))).map((retiredDirectory) => `${retiredDirectory}/`),
  ];
  if (!retiredNames.length) return null;
  return `This repo still uses an old name of the later feature (${retiredNames.join(', ')}): ai1 renamed rfc to proposals in v0.18.0 and proposals to later in v0.25.0, and ignores the old names. Tell the person; /ai1:core-setup-repo (ai1 init) migrates it to .ai1/later/ and features.later.`;
}

// Names this ai1 version does not know (fields, features, modules), e.g. from a repo set up with a
// newer ai1. They are warnings, not errors: the rest of the harness keeps working and the unknown
// entries are ignored, so an older plugin never switches off a repo's guards.
export function listUnknownConfigEntries(rawConfig, knownModuleIds = []) {
  if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return [];
  const unknownEntries = Object.keys(rawConfig).filter((fieldName) => !KNOWN_TOP_LEVEL_FIELDS.has(fieldName)).map((fieldName) => `field "${fieldName}"`);
  if (rawConfig.features && typeof rawConfig.features === 'object' && !Array.isArray(rawConfig.features)) {
    unknownEntries.push(...Object.keys(rawConfig.features).filter((featureId) => !KNOWN_FEATURE_IDS.includes(featureId) && !RENAMED_FEATURE_IDS[featureId]).map((featureId) => `feature "${featureId}"`));
  }
  if (knownModuleIds.length && rawConfig.modules && typeof rawConfig.modules === 'object' && !Array.isArray(rawConfig.modules)) {
    unknownEntries.push(...Object.keys(rawConfig.modules).filter((moduleId) => !knownModuleIds.includes(moduleId) && !RENAMED_MODULE_IDS[moduleId]).map((moduleId) => `module "${moduleId}"`));
  }
  return unknownEntries;
}

// Errors in what this ai1 version knows (wrong types, unsupported version). Unknown names are
// reported by listUnknownConfigEntries instead.
export function validateHarnessConfig(rawConfig) {
  const validationErrors = [];
  if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return ['the file must contain a JSON object'];
  }
  if (rawConfig.version !== undefined && rawConfig.version !== SUPPORTED_CONFIG_VERSION) {
    validationErrors.push(`"version" must be ${SUPPORTED_CONFIG_VERSION}`);
  }
  if (rawConfig.features !== undefined) {
    if (rawConfig.features === null || typeof rawConfig.features !== 'object' || Array.isArray(rawConfig.features)) {
      validationErrors.push('"features" must be an object of feature id -> true/false');
    } else {
      for (const [featureId, featureSetting] of Object.entries(rawConfig.features)) {
        if (typeof featureSetting !== 'boolean') {
          validationErrors.push(`"features.${featureId}" must be true or false`);
        }
      }
    }
  }
  if (rawConfig.trunk !== undefined && (typeof rawConfig.trunk !== 'string' || !rawConfig.trunk.trim())) {
    validationErrors.push('"trunk" must be a non-empty string');
  }
  if (rawConfig.verify !== undefined) {
    const isListOfCommands = Array.isArray(rawConfig.verify)
      && rawConfig.verify.every((verifyCommand) => typeof verifyCommand === 'string' && verifyCommand.trim());
    if (!isListOfCommands) validationErrors.push('"verify" must be a list of non-empty command strings');
  }
  if (rawConfig.modules !== undefined) {
    if (rawConfig.modules === null || typeof rawConfig.modules !== 'object' || Array.isArray(rawConfig.modules)) {
      validationErrors.push('"modules" must be an object keyed by module id');
    } else {
      for (const [moduleId, moduleSetting] of Object.entries(rawConfig.modules)) {
        const isBoolean = typeof moduleSetting === 'boolean';
        const isOptionsObject = moduleSetting !== null && typeof moduleSetting === 'object' && !Array.isArray(moduleSetting);
        if (!isBoolean && !isOptionsObject) {
          validationErrors.push(`"modules.${moduleId}" must be true, false or an options object`);
        } else if (isOptionsObject && moduleSetting.enabled !== undefined && typeof moduleSetting.enabled !== 'boolean') {
          validationErrors.push(`"modules.${moduleId}.enabled" must be true or false`);
        }
      }
    }
  }
  // A bad rule is dropped with a notice (splitRepoRules); only a `rules` that is not a list is an error.
  if (rawConfig.rules !== undefined && !Array.isArray(rawConfig.rules)) validationErrors.push('"rules" must be a list of rule objects');
  return validationErrors;
}

// The bundle path was configurable until v0.15 (`knowledge`). The same path is ignored silently; any
// other value (another path, or null) is ignored with a notice, never an error: an invalid config
// would switch off the guards too.
export function readRetiredKnowledgeNotice(rawConfig) {
  if (!rawConfig || !Object.hasOwn(rawConfig, 'knowledge')) return null;
  const configuredPath = typeof rawConfig.knowledge === 'string'
    ? rawConfig.knowledge.split('\\').join('/').replace(/^\.\//, '').replace(/\/+$/, '')
    : rawConfig.knowledge;
  if (configuredPath === KNOWLEDGE_BUNDLE_PATH) return null;
  return `${CONFIG_RELATIVE_PATH} sets "knowledge": ${JSON.stringify(rawConfig.knowledge)}, which ai1 no longer supports: the knowledge bundle is always ${KNOWLEDGE_BUNDLE_PATH}/ and the setting is ignored. Tell the person; /ai1:core-setup-repo (ai1 init) moves the bundle there and removes the setting.`;
}

// status: 'missing' (ai1 stays inactive), 'invalid' (errors listed), 'ok' (config merged with defaults).
// `notices` are things to tell the person at session start (e.g. a retired setting).
export function loadHarnessConfig(projectRoot, knownModuleIds = []) {
  const configPath = join(projectRoot, CONFIG_RELATIVE_PATH);
  if (!existsSync(configPath)) return { status: 'missing', configPath };
  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (parseError) {
    return { status: 'invalid', configPath, errors: [`not valid JSON: ${parseError.message}`] };
  }
  const validationErrors = validateHarnessConfig(rawConfig);
  if (validationErrors.length) return { status: 'invalid', configPath, errors: validationErrors };
  const { knowledge: retiredKnowledgeSetting, ...supportedConfig } = rawConfig;
  const { validRules, notices: ruleNotices } = splitRepoRules(rawConfig.rules);
  const configNotices = [readRetiredKnowledgeNotice(rawConfig), readRenamedNamesNotice(rawConfig, projectRoot), ...ruleNotices].filter(Boolean);
  return {
    status: 'ok',
    configPath,
    unknownEntries: listUnknownConfigEntries(rawConfig, knownModuleIds),
    notices: configNotices,
    // Whether the repo sets `trunk` (otherwise the default 'main' is a guess: see detectTrunkBranch).
    trunkConfigured: typeof rawConfig.trunk === 'string',
    config: { ...DEFAULT_CONFIG, ...supportedConfig, features: { ...rawConfig.features }, modules: { ...rawConfig.modules }, rules: validRules },
  };
}

// A module runs when its feature is enabled for the repo, unless the repo switches that single
// module off with `modules.<id>: false` (or `{ "enabled": false }`).
export function isModuleEnabled(moduleDefinition, config) {
  const moduleSetting = config.modules?.[moduleDefinition.id];
  if (moduleSetting === false) return false;
  if (moduleSetting && moduleSetting.enabled === false) return false;
  return isFeatureEnabled(moduleDefinition.feature, config);
}

export function getModuleOptions(moduleId, config) {
  const moduleSetting = config.modules?.[moduleId];
  if (!moduleSetting || typeof moduleSetting !== 'object') return {};
  const { enabled: ignoredEnabledFlag, ...moduleOptions } = moduleSetting;
  return moduleOptions;
}
