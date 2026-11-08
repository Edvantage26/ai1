// Loads and validates the per-repo contract, `.ai1/config.json`.
// The JSON schema in schema/ai1.schema.json describes the same rules for editors; this
// validator is hand-written so ai1 keeps zero dependencies. test/config.test.mjs checks that
// both agree on the shipped templates.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_FEATURE_IDS, isFeatureEnabled } from './features.mjs';

// Everything ai1 writes in a repo lives under `.ai1/`: config, knowledge bundle, RFCs, work plans.
export const AI1_DIRECTORY = '.ai1';
export const CONFIG_RELATIVE_PATH = join(AI1_DIRECTORY, 'config.json');
export const DEFAULT_KNOWLEDGE_PATH = join(AI1_DIRECTORY, 'okf');
export const AI1_PLUGIN_ID = 'ai1@ai1';
export const SCHEMA_URL = 'https://raw.githubusercontent.com/Edvantage26/ai1/main/schema/ai1.schema.json';
export const SUPPORTED_CONFIG_VERSION = 1;

const KNOWN_TOP_LEVEL_FIELDS = new Set(['$schema', 'version', 'features', 'trunk', 'verify', 'knowledge', 'modules']);

const DEFAULT_CONFIG = {
  version: SUPPORTED_CONFIG_VERSION,
  features: {},
  trunk: 'main',
  verify: [],
  knowledge: DEFAULT_KNOWLEDGE_PATH,
  modules: {},
};

// Names this ai1 version does not know (fields, features, modules), e.g. from a repo set up with a
// newer ai1. They are warnings, not errors: the rest of the harness keeps working and the unknown
// entries are ignored, so an older plugin never switches off a repo's guards.
export function listUnknownConfigEntries(rawConfig, knownModuleIds = []) {
  if (rawConfig === null || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return [];
  const unknownEntries = Object.keys(rawConfig).filter((fieldName) => !KNOWN_TOP_LEVEL_FIELDS.has(fieldName)).map((fieldName) => `field "${fieldName}"`);
  if (rawConfig.features && typeof rawConfig.features === 'object' && !Array.isArray(rawConfig.features)) {
    unknownEntries.push(...Object.keys(rawConfig.features).filter((featureId) => !KNOWN_FEATURE_IDS.includes(featureId)).map((featureId) => `feature "${featureId}"`));
  }
  if (knownModuleIds.length && rawConfig.modules && typeof rawConfig.modules === 'object' && !Array.isArray(rawConfig.modules)) {
    unknownEntries.push(...Object.keys(rawConfig.modules).filter((moduleId) => !knownModuleIds.includes(moduleId)).map((moduleId) => `module "${moduleId}"`));
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
  if (rawConfig.knowledge !== undefined && rawConfig.knowledge !== null && typeof rawConfig.knowledge !== 'string') {
    validationErrors.push('"knowledge" must be a path string or null');
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
  return validationErrors;
}

// status: 'missing' (ai1 stays inactive), 'invalid' (errors listed), 'ok' (config merged with defaults).
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
  return {
    status: 'ok',
    configPath,
    unknownEntries: listUnknownConfigEntries(rawConfig, knownModuleIds),
    config: { ...DEFAULT_CONFIG, ...rawConfig, features: { ...rawConfig.features }, modules: { ...rawConfig.modules } },
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
