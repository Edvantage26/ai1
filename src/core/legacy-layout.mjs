// The layout of the former name `jig` (and `.okf/` bundles) that `ai1 init` moves to `.ai1/`:
// detection only, reading the disk, so the dispatcher can mention it without loading the migration
// (src/cli/legacy-migration.mjs does the moves).

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, WORK_DIRECTORY, LATER_DIRECTORY, RETIRED_RFC_DIRECTORY, RETIRED_PROPOSALS_DIRECTORY } from './config.mjs';
import { readJsonFileIfValid } from './json-file.mjs';

export const LEGACY_CONFIG_PATH = join('.claude', 'jig.json');
export const LEGACY_BUNDLE_PATH = '.okf';
export const LEGACY_RFC_PATH = 'docs/rfc';
export const LEGACY_DIRECTORY = '.jig';
export const LEGACY_WORK_PATH = join(LEGACY_DIRECTORY, 'work');
export const LEGACY_PLUGIN_ID = 'jig@jig';
export const LEGACY_MARKETPLACE_KEY = 'jig';
const SETTINGS_PATHS = [join('.claude', 'settings.json'), join('.claude', 'settings.local.json')];

export function normalizeRelativePath(pathText) {
  return String(pathText).replace(/^\.\//, '').replace(/\/+$/, '');
}

function settingsMentionLegacyPlugin(settingsJson) {
  return Boolean(settingsJson && (settingsJson.enabledPlugins?.[LEGACY_PLUGIN_ID] !== undefined || settingsJson.extraKnownMarketplaces?.[LEGACY_MARKETPLACE_KEY]));
}

// { moves: [{ from, to }], conflicts: [path], settingsFiles: [path] }: what migrateLegacyLayout would do.
export function planLegacyMigration(repoRoot) {
  const legacyConfig = readJsonFileIfValid(join(repoRoot, LEGACY_CONFIG_PATH));
  const currentConfig = readJsonFileIfValid(join(repoRoot, CONFIG_RELATIVE_PATH));
  // The repo's bundle: the path the retired `knowledge` setting named (null = none), else `.okf/`.
  const knowledgeSetting = (legacyConfig || currentConfig)?.knowledge;
  const configuredBundlePath = typeof knowledgeSetting === 'string' ? normalizeRelativePath(knowledgeSetting)
    : knowledgeSetting === null ? null : LEGACY_BUNDLE_PATH;
  const moves = [];
  if (existsSync(join(repoRoot, LEGACY_CONFIG_PATH))) moves.push({ from: LEGACY_CONFIG_PATH, to: CONFIG_RELATIVE_PATH });
  if (configuredBundlePath && configuredBundlePath !== KNOWLEDGE_BUNDLE_PATH && existsSync(join(repoRoot, configuredBundlePath))) {
    moves.push({ from: configuredBundlePath, to: KNOWLEDGE_BUNDLE_PATH });
  }
  if (legacyConfig?.features?.rfc === true && existsSync(join(repoRoot, LEGACY_RFC_PATH))) moves.push({ from: LEGACY_RFC_PATH, to: LATER_DIRECTORY });
  // ai1 before v0.18.0 kept them in .ai1/rfc/ (feature rfc), before v0.25.0 in .ai1/proposals/ (feature proposals).
  for (const retiredDirectory of [RETIRED_RFC_DIRECTORY, RETIRED_PROPOSALS_DIRECTORY]) {
    if (!moves.some((plannedMove) => plannedMove.to === LATER_DIRECTORY) && existsSync(join(repoRoot, retiredDirectory))) {
      moves.push({ from: retiredDirectory, to: LATER_DIRECTORY });
    }
  }
  if (existsSync(join(repoRoot, LEGACY_WORK_PATH))) moves.push({ from: LEGACY_WORK_PATH, to: WORK_DIRECTORY });
  const conflicts = moves.filter((plannedMove) => existsSync(join(repoRoot, plannedMove.to))).map((plannedMove) => plannedMove.to);
  const settingsFiles = SETTINGS_PATHS.filter((settingsPath) => settingsMentionLegacyPlugin(readJsonFileIfValid(join(repoRoot, settingsPath))));
  return { moves, conflicts, settingsFiles };
}

// The old `.claude/jig.json`, so `ai1 status` can show the features the repo had before migrating.
export function readLegacyConfig(repoRoot) {
  return readJsonFileIfValid(join(repoRoot, LEGACY_CONFIG_PATH));
}

export function hasLegacyLayout(repoRoot) {
  const legacyPlan = planLegacyMigration(repoRoot);
  return legacyPlan.moves.length > 0 || legacyPlan.settingsFiles.length > 0;
}
