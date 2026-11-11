// Writes the per-repo harness: .ai1/config.json (features and contract) and
// .claude/settings.json (enables ai1 for whoever opens the repo). Both files are merged with what
// already exists, so running it again only changes what the person chose.
// Overrides that only make sense on this machine (switching off plugins of the person that overlap
// with ai1, see src/core/plugin-overlaps.mjs) go to .claude/settings.local.json, personal and kept out of git.

import { tryGit, detectTrunkBranch } from '../core/git.mjs';
import { splitRepoRules } from '../core/repo-rules-config.mjs';
import { REPORT_MODES } from '../core/issue-offer.mjs';
import { readJsonFile, readJsonFileIfValid, writeJsonFile } from '../core/json-file.mjs';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { FEATURES, KNOWN_FEATURE_IDS, isFeatureEnabled } from '../core/features.mjs';
import { validateHarnessConfig, listUnknownConfigEntries, SUPPORTED_CONFIG_VERSION, SCHEMA_URL, AI1_DIRECTORY, AI1_PLUGIN_ID, CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, renameRetiredIds } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/module-index.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { loadRecipe } from '../worktrees/worktree-recipe.mjs';
import { runPendingMigrations } from '../core/migrations.mjs';
import { migrateLegacyLayout } from './legacy-migration.mjs';
import { readEnabledPlugins, findOverlappingPlugins, localSettingsPathFor } from '../core/plugin-overlaps.mjs';
import { recommendFeatures } from './feature-recommendations.mjs';
import { planLegacyMigration, readLegacyConfig } from '../core/legacy-layout.mjs';

export const AI1_MARKETPLACE = { source: { source: 'github', repo: 'Edvantage26/ai1' } };

export function findRepoRoot(startDirectory) {
  return tryGit(startDirectory, ['rev-parse', '--show-toplevel']) || startDirectory;
}

const DEFAULT_USER_SETTINGS_PATH = join(homedir(), '.claude', 'settings.json');
const SELECTABLE_FEATURES = FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn);
const SELECTABLE_FEATURE_IDS = SELECTABLE_FEATURES.map((featureDefinition) => featureDefinition.id);

// Makes sure the repo itself ignores .claude/settings.local.json before ai1 writes into it.
// A rule from the person's global git excludes does not count: a teammate's clone would not have it.
export function ensureLocalSettingsIgnored(repoRoot) {
  const ignoreMatch = tryGit(repoRoot, ['check-ignore', '-v', '.claude/settings.local.json']) ?? '';
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

// Permission deny rules for credential files, offered by the setup (`ai1 init --deny-credentials`).
// Claude Code applies them to its file tools and to the shell file commands it recognises (cat, head,
// sed, redirects), not to scripts that open files themselves (the sandbox covers those). `.env` files
// are left out on purpose: local workflows read keys from them. Only the key files in ~/.ssh, so
// ~/.ssh/config stays readable.
export const CREDENTIAL_DENY_RULES = [
  'Read(**/*.pem)', 'Read(**/*.key)', 'Read(~/.ssh/id_*)', 'Read(~/.aws/**)', 'Read(~/.gnupg/**)', 'Read(~/.kube/**)',
  'Read(~/.config/gh/**)', 'Read(~/.docker/config.json)', 'Read(~/.netrc)', 'Read(~/.git-credentials)', 'Read(~/.npmrc)', 'Read(~/.pypirc)',
];

function countCredentialDenyRules(projectSettings) {
  const denyRules = new Set(projectSettings?.permissions?.deny || []);
  return CREDENTIAL_DENY_RULES.filter((denyRule) => denyRules.has(denyRule)).length;
}

function describeRepoRules(ai1Config) {
  if (!Array.isArray(ai1Config?.rules)) return { active: [], ignored: [] };
  const { validRules, notices } = splitRepoRules(ai1Config.rules);
  return { active: validRules.map((repoRule) => repoRule.id), ignored: notices };
}

export function describeRepo(repoRoot, { userSettingsPath = DEFAULT_USER_SETTINGS_PATH } = {}) {
  const ai1Config = readJsonFile(join(repoRoot, CONFIG_RELATIVE_PATH));
  // Before a migration, the features and trunk the repo had under the old name.
  const featureSourceConfig = renameRetiredIds(ai1Config ?? readLegacyConfig(repoRoot));
  const hasKnowledgeBundle = existsSync(join(repoRoot, KNOWLEDGE_BUNDLE_PATH, 'index.md'));
  const { recommendations, verifyCommands: detectedVerifyCommands } = recommendFeatures(repoRoot, { hasKnowledgeBundle });
  return {
    repoRoot,
    hasAi1Config: ai1Config !== null,
    trunk: featureSourceConfig?.trunk || detectTrunkBranch(repoRoot),
    knowledge: KNOWLEDGE_BUNDLE_PATH,
    hasKnowledgeBundle,
    detectedVerifyCommands,
    worktreeRecipe: describeWorktreeRecipe(repoRoot),
    // The repo's own guard rules (`rules`): how many run, and why the others are ignored.
    repoRules: describeRepoRules(ai1Config),
    credentialDenyRules: { present: countCredentialDenyRules(readJsonFile(join(repoRoot, '.claude', 'settings.json'))), total: CREDENTIAL_DENY_RULES.length },
    // Per person, not per repo: how ai1's own errors are reported (null = not chosen yet, means ask).
    reportErrors: readJsonFileIfValid(userSettingsPath)?.env?.AI1_REPORT_ERRORS ?? null,
    legacyMigration: planLegacyMigration(repoRoot),
    // Against every feature, not only the enabled ones: the setup skill keeps those that overlap with
    // the features the person picks.
    overlappingPlugins: findOverlappingPlugins(readEnabledPlugins(repoRoot, userSettingsPath), SELECTABLE_FEATURE_IDS),
    features: SELECTABLE_FEATURES.map((featureDefinition) => ({
      id: featureDefinition.id,
      title: featureDefinition.title,
      description: featureDefinition.description,
      enabledByDefault: featureDefinition.enabledByDefault,
      enabled: featureSourceConfig ? isFeatureEnabled(featureDefinition.id, { features: featureSourceConfig.features || {} }) : featureDefinition.enabledByDefault,
      recommendation: recommendations[featureDefinition.id],
    })),
  };
}

// disabledPluginIds: plugins the person chose to switch off in this repo (from describeRepo's
// overlappingPlugins); ai1 never picks them by itself.
// denyCredentials: add CREDENTIAL_DENY_RULES to the committed settings (existing rules are kept).
// reportErrors: the person's choice for ai1's own errors (ask | auto | off), written as
// `env.AI1_REPORT_ERRORS` in their user settings - personal, never in the repo.
export function setupRepo(repoRoot, { enabledFeatureIds, verifyCommands, disabledPluginIds = [], denyCredentials = false, reportErrors, userSettingsPath = DEFAULT_USER_SETTINGS_PATH }) {
  if (reportErrors !== undefined && !REPORT_MODES.includes(reportErrors)) throw new Error(`--report-errors must be ${REPORT_MODES.join(', ')}`);
  if (disabledPluginIds.includes(AI1_PLUGIN_ID)) throw new Error(`${AI1_PLUGIN_ID} cannot be disabled by ai1 init`);
  const malformedPluginIds = disabledPluginIds.filter((pluginId) => !/^[^@\s]+@[^@\s]+$/.test(pluginId));
  if (malformedPluginIds.length) throw new Error(`not plugin ids (name@marketplace): ${malformedPluginIds.join(', ')}`);
  const retiredFeatureId = ['rfc', 'proposals'].find((featureId) => enabledFeatureIds.includes(featureId));
  if (retiredFeatureId) throw new Error(`the ${retiredFeatureId} feature is called later since v0.25.0: use --features ...,later`);
  if (enabledFeatureIds.includes('lanes')) throw new Error('the lanes feature is called sizing since v0.32.0: use --features ...,sizing');
  const unknownFeatureIds = enabledFeatureIds.filter((featureId) => !KNOWN_FEATURE_IDS.includes(featureId));
  if (unknownFeatureIds.length) throw new Error(`unknown features: ${unknownFeatureIds.join(', ')}`);
  const legacyMigration = migrateLegacyLayout(repoRoot);
  // The same numbered migrations a session start runs (src/core/migrations.mjs); the person's own
  // config folder is left to the session start.
  const migrationReports = runPendingMigrations(repoRoot, { includeUser: false });
  const claudeDirectory = join(repoRoot, '.claude');
  mkdirSync(claudeDirectory, { recursive: true });

  mkdirSync(join(repoRoot, AI1_DIRECTORY), { recursive: true });
  const ai1ConfigPath = join(repoRoot, CONFIG_RELATIVE_PATH);
  // Retired names go away: `knowledge` (its bundle was moved above), rfc and proposals ids renamed to later.
  const { knowledge: retiredKnowledgeSetting, ...existingAi1Config } = renameRetiredIds(readJsonFile(ai1ConfigPath) || {});
  const chosenFeatures = Object.fromEntries(SELECTABLE_FEATURE_IDS.map((featureId) => [featureId, enabledFeatureIds.includes(featureId)]));
  const ai1Config = {
    $schema: SCHEMA_URL,
    version: SUPPORTED_CONFIG_VERSION,
    ...existingAi1Config,
    features: chosenFeatures,
    trunk: existingAi1Config.trunk || detectTrunkBranch(repoRoot),
    verify: verifyCommands ?? existingAi1Config.verify ?? [],
  };
  const validationErrors = [...validateHarnessConfig(ai1Config), ...listUnknownConfigEntries(ai1Config, KNOWN_MODULE_IDS).map((unknownEntry) => `unknown ${unknownEntry}`)];
  if (validationErrors.length) throw new Error(`resulting ${CONFIG_RELATIVE_PATH} is invalid: ${validationErrors.join('; ')}`);
  writeJsonFile(ai1ConfigPath, ai1Config);

  const settingsPath = join(claudeDirectory, 'settings.json');
  const projectSettings = readJsonFile(settingsPath) || {};
  projectSettings.extraKnownMarketplaces = { ...projectSettings.extraKnownMarketplaces, ai1: AI1_MARKETPLACE };
  projectSettings.enabledPlugins = { ...projectSettings.enabledPlugins, [AI1_PLUGIN_ID]: true };
  const existingDenyRules = projectSettings.permissions?.deny || [];
  const addedDenyRules = denyCredentials ? CREDENTIAL_DENY_RULES.filter((denyRule) => !existingDenyRules.includes(denyRule)) : [];
  if (addedDenyRules.length) projectSettings.permissions = { ...projectSettings.permissions, deny: [...existingDenyRules, ...addedDenyRules] };
  writeJsonFile(settingsPath, projectSettings);

  const disabledPlugins = [...new Set(disabledPluginIds)];
  // Where Claude Code reads it: the main checkout's root even when init runs in a worktree.
  const localSettingsPath = localSettingsPathFor(repoRoot);
  let gitignoreUpdated = false;
  if (disabledPlugins.length) {
    gitignoreUpdated = ensureLocalSettingsIgnored(repoRoot);
    mkdirSync(dirname(localSettingsPath), { recursive: true });
    const localSettings = readJsonFile(localSettingsPath) || {};
    localSettings.enabledPlugins = { ...localSettings.enabledPlugins };
    for (const otherPluginId of disabledPlugins) localSettings.enabledPlugins[otherPluginId] = false;
    writeJsonFile(localSettingsPath, localSettings);
  }

  if (reportErrors !== undefined) {
    const userSettings = readJsonFile(userSettingsPath) || {};
    userSettings.env = { ...userSettings.env, AI1_REPORT_ERRORS: reportErrors };
    mkdirSync(dirname(userSettingsPath), { recursive: true });
    writeJsonFile(userSettingsPath, userSettings);
  }

  return {
    ai1ConfigPath,
    settingsPath,
    reportErrors: reportErrors ?? null,
    localSettingsPath: disabledPlugins.length ? localSettingsPath : null,
    gitignoreUpdated,
    features: chosenFeatures,
    trunk: ai1Config.trunk,
    knowledge: KNOWLEDGE_BUNDLE_PATH,
    hasKnowledgeBundle: existsSync(join(repoRoot, KNOWLEDGE_BUNDLE_PATH, 'index.md')),
    disabledPlugins,
    addedDenyRules,
    legacyMigration,
    migrationReports,
  };
}
