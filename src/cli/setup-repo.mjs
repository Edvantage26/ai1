// Writes the per-repo harness: .ai1/config.json (features and contract) and
// .claude/settings.json (enables ai1 for whoever opens the repo). Both files are merged with what
// already exists, so running it again only changes what the person chose.
// Overrides that only make sense on this machine (switching off the person's own standalone OKF
// plugin) go to .claude/settings.local.json, which is personal and kept out of git.

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { FEATURES, KNOWN_FEATURE_IDS, isFeatureEnabled } from '../core/features.mjs';
import { validateHarnessConfig, listUnknownConfigEntries, SUPPORTED_CONFIG_VERSION, SCHEMA_URL, AI1_DIRECTORY, AI1_PLUGIN_ID, CONFIG_RELATIVE_PATH, DEFAULT_KNOWLEDGE_PATH } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/registry.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { loadRecipe } from '../worktrees/worktree-recipe.mjs';
import { planLegacyMigration, migrateLegacyLayout, readLegacyConfig } from './legacy-migration.mjs';

export const AI1_MARKETPLACE = { source: { source: 'github', repo: 'Edvantage26/ai1' } };

function readJsonFile(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null;
}

function writeJsonFile(filePath, jsonValue) {
  writeFileSync(filePath, `${JSON.stringify(jsonValue, null, 2)}\n`);
}

function runGit(repoRoot, gitArguments) {
  try {
    return execFileSync('git', ['-C', repoRoot, ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function findRepoRoot(startDirectory) {
  return runGit(startDirectory, ['rev-parse', '--show-toplevel']) || startDirectory;
}

// origin/HEAD when the clone knows it, else main or master if present, else the current branch.
export function detectTrunkBranch(repoRoot) {
  const originHead = runGit(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) return originHead.replace(/^origin\//, '');
  for (const candidateBranch of ['main', 'master']) {
    if (runGit(repoRoot, ['rev-parse', '--verify', '--quiet', `refs/heads/${candidateBranch}`])) return candidateBranch;
  }
  return runGit(repoRoot, ['branch', '--show-current']) || 'main';
}

// Another enabled plugin that also ships OKF skills (e.g. a standalone `okf@...`) would duplicate
// /okf:* and /ai1:* in this repo, so ai1 switches it off here when the okf feature is on.
export function findOtherOkfPlugins(userSettings) {
  return Object.entries(userSettings?.enabledPlugins || {})
    .filter(([pluginId, isEnabled]) => isEnabled && /^okf@/.test(pluginId))
    .map(([pluginId]) => pluginId);
}

// Makes sure the repo itself ignores .claude/settings.local.json before ai1 writes into it.
// A rule from the person's global git excludes does not count: a teammate's clone would not have it.
export function ensureLocalSettingsIgnored(repoRoot) {
  const ignoreMatch = runGit(repoRoot, ['check-ignore', '-v', '.claude/settings.local.json']);
  const ignoreSourcePath = ignoreMatch.split(':')[0];
  const isIgnoredByRepoRule = Boolean(ignoreSourcePath) && !ignoreSourcePath.startsWith('/') && !ignoreSourcePath.startsWith('.git/');
  if (isIgnoredByRepoRule) return false;
  const gitignorePath = join(repoRoot, '.gitignore');
  const gitignoreText = existsSync(gitignorePath) ? readFileSync(gitignorePath, 'utf8') : '';
  const separator = gitignoreText && !gitignoreText.endsWith('\n') ? '\n' : '';
  appendFileSync(gitignorePath, `${separator}.claude/settings.local.json\n`);
  return true;
}

// { status: missing | invalid | ok, path, errors?, warnings? } of the project worktree recipe.
function describeWorktreeRecipe(repoRoot) {
  const loadedRecipe = loadRecipe(findMainCheckout(repoRoot));
  return { status: loadedRecipe.status, path: loadedRecipe.recipePath, errors: loadedRecipe.errors ?? [], warnings: loadedRecipe.warnings ?? [] };
}

export function describeRepo(repoRoot) {
  const ai1Config = readJsonFile(join(repoRoot, CONFIG_RELATIVE_PATH));
  // Before a migration, the features and trunk the repo had under the old name.
  const featureSourceConfig = ai1Config ?? readLegacyConfig(repoRoot);
  const knowledgePath = ai1Config?.knowledge || DEFAULT_KNOWLEDGE_PATH;
  return {
    repoRoot,
    hasAi1Config: ai1Config !== null,
    trunk: featureSourceConfig?.trunk || detectTrunkBranch(repoRoot),
    knowledge: knowledgePath,
    hasKnowledgeBundle: existsSync(join(repoRoot, knowledgePath, 'index.md')),
    worktreeRecipe: describeWorktreeRecipe(repoRoot),
    legacyMigration: planLegacyMigration(repoRoot),
    features: FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn).map((featureDefinition) => ({
      id: featureDefinition.id,
      title: featureDefinition.title,
      description: featureDefinition.description,
      enabledByDefault: featureDefinition.enabledByDefault,
      enabled: featureSourceConfig ? isFeatureEnabled(featureDefinition.id, { features: featureSourceConfig.features || {} }) : featureDefinition.enabledByDefault,
    })),
  };
}

export function setupRepo(repoRoot, { enabledFeatureIds, verifyCommands, knowledgePath, userSettingsPath = join(homedir(), '.claude', 'settings.json') }) {
  const unknownFeatureIds = enabledFeatureIds.filter((featureId) => !KNOWN_FEATURE_IDS.includes(featureId));
  if (unknownFeatureIds.length) throw new Error(`unknown features: ${unknownFeatureIds.join(', ')}`);
  const legacyMigration = migrateLegacyLayout(repoRoot);
  const claudeDirectory = join(repoRoot, '.claude');
  mkdirSync(claudeDirectory, { recursive: true });

  mkdirSync(join(repoRoot, AI1_DIRECTORY), { recursive: true });
  const ai1ConfigPath = join(repoRoot, CONFIG_RELATIVE_PATH);
  const existingAi1Config = readJsonFile(ai1ConfigPath) || {};
  const selectableFeatureIds = FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn).map((featureDefinition) => featureDefinition.id);
  const chosenFeatures = Object.fromEntries(selectableFeatureIds.map((featureId) => [featureId, enabledFeatureIds.includes(featureId)]));
  const ai1Config = {
    $schema: SCHEMA_URL,
    version: SUPPORTED_CONFIG_VERSION,
    ...existingAi1Config,
    features: chosenFeatures,
    trunk: existingAi1Config.trunk || detectTrunkBranch(repoRoot),
    verify: verifyCommands ?? existingAi1Config.verify ?? [],
    knowledge: knowledgePath || existingAi1Config.knowledge || DEFAULT_KNOWLEDGE_PATH,
  };
  const validationErrors = [...validateHarnessConfig(ai1Config), ...listUnknownConfigEntries(ai1Config, KNOWN_MODULE_IDS).map((unknownEntry) => `unknown ${unknownEntry}`)];
  if (validationErrors.length) throw new Error(`resulting ${CONFIG_RELATIVE_PATH} is invalid: ${validationErrors.join('; ')}`);
  writeJsonFile(ai1ConfigPath, ai1Config);

  const settingsPath = join(claudeDirectory, 'settings.json');
  const projectSettings = readJsonFile(settingsPath) || {};
  projectSettings.extraKnownMarketplaces = { ...projectSettings.extraKnownMarketplaces, ai1: AI1_MARKETPLACE };
  projectSettings.enabledPlugins = { ...projectSettings.enabledPlugins, [AI1_PLUGIN_ID]: true };
  writeJsonFile(settingsPath, projectSettings);

  const disabledPlugins = chosenFeatures.okf ? findOtherOkfPlugins(readJsonFile(userSettingsPath)) : [];
  const localSettingsPath = join(claudeDirectory, 'settings.local.json');
  let gitignoreUpdated = false;
  if (disabledPlugins.length) {
    gitignoreUpdated = ensureLocalSettingsIgnored(repoRoot);
    const localSettings = readJsonFile(localSettingsPath) || {};
    localSettings.enabledPlugins = { ...localSettings.enabledPlugins };
    for (const otherPluginId of disabledPlugins) localSettings.enabledPlugins[otherPluginId] = false;
    writeJsonFile(localSettingsPath, localSettings);
  }

  return {
    ai1ConfigPath,
    settingsPath,
    localSettingsPath: disabledPlugins.length ? localSettingsPath : null,
    gitignoreUpdated,
    features: chosenFeatures,
    trunk: ai1Config.trunk,
    knowledge: ai1Config.knowledge,
    hasKnowledgeBundle: existsSync(join(repoRoot, ai1Config.knowledge, 'index.md')),
    disabledPlugins,
    legacyMigration,
  };
}
