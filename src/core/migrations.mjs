// Migrations: when a new ai1 version renames or moves something it wrote (a feature id, a folder,
// a skill name), the repo and the person's own config are brought up to date by themselves, like a
// database migration. Each migration has a number, a repo part and a user part, and is idempotent.
// A ledger with the last applied number keeps them from running again: in the repo it is local to
// the checkout (`.ai1/work/migrations.json`, ignored by git), for the person it sits in their ai1
// config folder (`~/.config/ai1/migrations.json`, written only if that folder exists).
// Run at SessionStart by bin/ai1-hook.mjs before the dispatch (so this session already reads the
// new names) and by `ai1 init`. Nothing is committed: the changed files are reported, for the person
// to review and commit. A migration that throws leaves its ledger where it was and is reported.

import { existsSync, lstatSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, LATER_DIRECTORY, WORK_DIRECTORY } from './config.mjs';
import { readJsonFileIfValid, writeJsonFile } from './json-file.mjs';
import { listMarkdownFiles } from './markdown-files.mjs';
import { SKILL_OVERLAYS_DIRECTORY, userConfigDirectory } from './skill-customization.mjs';
import { ensureWorkDirectoryIgnored } from '../sizing/sizing-work.mjs';
import { resolveProjectRoots } from './project-roots.mjs';
import { applySkillVisibility } from './skill-visibility.mjs';

const LEDGER_FILE_NAME = 'migrations.json';
export const REPO_LEDGER_RELATIVE_PATH = `${WORK_DIRECTORY}/${LEDGER_FILE_NAME}`;

// lstat, not exists: a symlink whose target is missing (an unmounted drive) still counts and moves.
function pathExists(filePath) {
  try {
    lstatSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// Renames the keys of one config section; when both names are set, the new one wins.
function renameConfigKeys(configSection, renamedKeys) {
  if (!configSection || typeof configSection !== 'object' || Array.isArray(configSection)) return configSection;
  const renamedSection = {};
  for (const [settingKey, settingValue] of Object.entries(configSection)) {
    const newKey = renamedKeys[settingKey];
    if (!newKey) renamedSection[settingKey] = settingValue;
    else if (!Object.hasOwn(configSection, newKey)) renamedSection[newKey] = settingValue;
  }
  return renamedSection;
}

// A feature rename in `.ai1/config.json`: its `features` key and its modules' keys under `modules`.
function renameFeatureInConfig(repoRoot, migrationReport, { oldFeatureId, newFeatureId, oldModuleIds }) {
  const configPath = join(repoRoot, CONFIG_RELATIVE_PATH);
  const repoConfig = readJsonFileIfValid(configPath);
  if (!repoConfig || typeof repoConfig !== 'object') return;
  const renamedModuleIds = Object.fromEntries(oldModuleIds.map((oldModuleId) => [oldModuleId, oldModuleId.replace(`${oldFeatureId}-`, `${newFeatureId}-`)]));
  const renamedConfig = {
    ...repoConfig,
    ...(repoConfig.features !== undefined ? { features: renameConfigKeys(repoConfig.features, { [oldFeatureId]: newFeatureId }) } : {}),
    ...(repoConfig.modules !== undefined ? { modules: renameConfigKeys(repoConfig.modules, renamedModuleIds) } : {}),
  };
  if (JSON.stringify(renamedConfig) === JSON.stringify(repoConfig)) return;
  writeJsonFile(configPath, renamedConfig);
  migrationReport.changed.push(CONFIG_RELATIVE_PATH);
}

// Moves a folder (or a symlink) to its new name unless the new one already exists (then both stay, reported).
function moveFolderUnlessTaken(fromPath, toPath, migrationReport, displayPath) {
  if (!pathExists(fromPath)) return;
  if (pathExists(toPath)) {
    migrationReport.leftAlone.push(`${displayPath(fromPath)} (${displayPath(toPath)} already exists; merge them by hand)`);
    return;
  }
  mkdirSync(dirname(toPath), { recursive: true });
  renameSync(fromPath, toPath);
  migrationReport.changed.push(`${displayPath(fromPath)} -> ${displayPath(toPath)}`);
}

function rewriteTextFile(filePath, rewriteText, migrationReport, displayPath) {
  const fileText = readFileSync(filePath, 'utf8');
  const rewrittenText = rewriteText(fileText);
  if (rewrittenText === fileText) return;
  writeFileSync(filePath, rewrittenText);
  migrationReport.changed.push(displayPath(filePath));
}

const repoDisplayPath = (repoRoot) => (absolutePath) => relative(repoRoot, absolutePath).split('\\').join('/');
const userDisplayPath = (absolutePath) => absolutePath;

// The texts ai1 owns in a repo: the bundle (its log.md is history: untouched), later entries, skill
// overlays, `.claude/skills/` and the work plans (`rewritePlanText` adds plan-only changes).
function rewriteAi1Texts(repoRoot, rewriteText, migrationReport, rewritePlanText = rewriteText) {
  const displayPath = repoDisplayPath(repoRoot);
  const bundleLogPath = join(repoRoot, KNOWLEDGE_BUNDLE_PATH, 'log.md');
  const ai1Texts = [
    ...listMarkdownFiles(join(repoRoot, KNOWLEDGE_BUNDLE_PATH)).filter((markdownPath) => markdownPath !== bundleLogPath),
    ...listMarkdownFiles(join(repoRoot, LATER_DIRECTORY)),
    ...listMarkdownFiles(join(repoRoot, SKILL_OVERLAYS_DIRECTORY)),
    ...listMarkdownFiles(join(repoRoot, '.claude', 'skills')),
  ];
  for (const textPath of ai1Texts) rewriteTextFile(textPath, rewriteText, migrationReport, displayPath);
  const workPlans = listMarkdownFiles(join(repoRoot, WORK_DIRECTORY)).filter((markdownPath) => markdownPath.endsWith('plan.md'));
  for (const planPath of workPlans) rewriteTextFile(planPath, rewritePlanText, migrationReport, displayPath);
}

// The person's own docs at the repo root (CLAUDE.md, AGENTS.md...) are theirs: listed, not edited.
function listRootDocsNaming(repoRoot, oldNamePattern, reviewNote, migrationReport) {
  for (const directoryEntry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!directoryEntry.isFile() || !directoryEntry.name.endsWith('.md')) continue;
    if (oldNamePattern.test(readFileSync(join(repoRoot, directoryEntry.name), 'utf8'))) migrationReport.toReview.push(`${directoryEntry.name} (${reviewNote})`);
  }
}

// The person's overlays of a renamed skill: their folder moves, and the old names in every overlay change.
function migrateUserOverlays(userDirectory, migrationReport, { oldFeatureId, newFeatureId, rewriteText }) {
  moveFolderUnlessTaken(join(userDirectory, 'skills', oldFeatureId), join(userDirectory, 'skills', newFeatureId), migrationReport, userDisplayPath);
  for (const overlayPath of listMarkdownFiles(join(userDirectory, 'skills'))) rewriteTextFile(overlayPath, rewriteText, migrationReport, userDisplayPath);
}

const renameLanesSkill = (fileText) => fileText.replace(/\/ai1:lanes-design-before-code\b/g, '/ai1:sizing-design-before-code');

// v0.32.0: the lanes feature is called sizing (feature and module ids, the deep skill, the overlay
// folders, the plan-task field `lane: plan` -> `size: plan`).
const lanesToSizing = {
  number: 1,
  id: 'lanes-to-sizing',
  summary: 'ai1 v0.32.0 renamed the lanes feature to sizing',
  migrateRepo(repoRoot, migrationReport) {
    renameFeatureInConfig(repoRoot, migrationReport, { oldFeatureId: 'lanes', newFeatureId: 'sizing', oldModuleIds: ['lanes-brief', 'lanes-approval', 'lanes-gate', 'lanes-escalate'] });
    const overlaysDirectory = join(repoRoot, SKILL_OVERLAYS_DIRECTORY);
    moveFolderUnlessTaken(join(overlaysDirectory, 'lanes'), join(overlaysDirectory, 'sizing'), migrationReport, repoDisplayPath(repoRoot));
    rewriteAi1Texts(repoRoot, renameLanesSkill, migrationReport, (planText) => renameLanesSkill(planText).replace(/^(---\r?\n(?:[^\n]*\n)*?)lane:(?=[ \t]*['"]?plan\b)/, '$1size:'));
    listRootDocsNaming(repoRoot, /\/ai1:lanes-design-before-code\b/, 'names /ai1:lanes-design-before-code, now /ai1:sizing-design-before-code', migrationReport);
  },
  migrateUser(userDirectory, migrationReport) {
    migrateUserOverlays(userDirectory, migrationReport, { oldFeatureId: 'lanes', newFeatureId: 'sizing', rewriteText: renameLanesSkill });
  },
};

const OLD_STORYBOARDS_DIRECTORY = '.ai1/walkthroughs';
const NEW_STORYBOARDS_DIRECTORY = '.ai1/storyboards';
const renameStoryboardTexts = (fileText) => fileText
  .replace(/\/ai1:walkthrough-record-flow\b/g, '/ai1:storyboard-record-flow')
  .replace(/\bai1 walkthrough(?= (?:add|build|serve|stop|list|destination|save)\b)/g, 'ai1 storyboard')
  .replace(/\.ai1\/walkthroughs\b/g, NEW_STORYBOARDS_DIRECTORY);

// `.git/info/exclude` lines naming the old folder (a symlink to a synced drive is excluded there).
// Only in a checkout whose `.git` is a folder: a worktree's `.git` is a file and shares the main one.
function renameExcludedStoryboardsFolder(repoRoot, migrationReport) {
  const gitDirectory = join(repoRoot, '.git');
  if (!pathExists(gitDirectory) || !lstatSync(gitDirectory).isDirectory()) return;
  const excludePath = join(gitDirectory, 'info', 'exclude');
  if (!existsSync(excludePath)) return;
  const renameExcludeLines = (excludeText) => excludeText.replace(/^(\/?)\.ai1\/walkthroughs(\/?)$/gm, `$1${NEW_STORYBOARDS_DIRECTORY}$2`);
  rewriteTextFile(excludePath, renameExcludeLines, migrationReport, () => '.git/info/exclude');
}

// v0.33.0: the walkthrough feature is called storyboard (feature and module ids, the skill, `ai1
// storyboard`, the folder `.ai1/storyboards/`, also when it is a symlink, and the overlay folders).
const walkthroughToStoryboard = {
  number: 2,
  id: 'walkthrough-to-storyboard',
  summary: 'ai1 v0.33.0 renamed the walkthrough feature to storyboard',
  migrateRepo(repoRoot, migrationReport) {
    const displayPath = repoDisplayPath(repoRoot);
    renameFeatureInConfig(repoRoot, migrationReport, { oldFeatureId: 'walkthrough', newFeatureId: 'storyboard', oldModuleIds: ['walkthrough-reminder'] });
    moveFolderUnlessTaken(join(repoRoot, OLD_STORYBOARDS_DIRECTORY), join(repoRoot, NEW_STORYBOARDS_DIRECTORY), migrationReport, displayPath);
    renameExcludedStoryboardsFolder(repoRoot, migrationReport);
    const overlaysDirectory = join(repoRoot, SKILL_OVERLAYS_DIRECTORY);
    moveFolderUnlessTaken(join(overlaysDirectory, 'walkthrough'), join(overlaysDirectory, 'storyboard'), migrationReport, displayPath);
    rewriteAi1Texts(repoRoot, renameStoryboardTexts, migrationReport);
    listRootDocsNaming(repoRoot, /\/ai1:walkthrough-record-flow\b|\.ai1\/walkthroughs\b|\bai1 walkthrough\b/, 'names the walkthrough skill, command or folder, now storyboard', migrationReport);
  },
  migrateUser(userDirectory, migrationReport) {
    migrateUserOverlays(userDirectory, migrationReport, { oldFeatureId: 'walkthrough', newFeatureId: 'storyboard', rewriteText: renameStoryboardTexts });
  },
};

// v0.34.0: the skills of disabled features leave the agent's skill list (`skillOverrides` in the
// committed .claude/settings.json, see src/core/skill-visibility.mjs); `ai1 init` keeps it in step.
const skillVisibility = {
  number: 3,
  id: 'skill-visibility',
  summary: 'ai1 v0.34.0 hides from the agent the skills of the features this repo has off',
  migrateRepo(repoRoot, migrationReport) {
    const repoConfig = readJsonFileIfValid(join(repoRoot, CONFIG_RELATIVE_PATH));
    if (!repoConfig || typeof repoConfig !== 'object') return;
    const settingsRelativePath = '.claude/settings.json';
    const settingsPath = join(repoRoot, settingsRelativePath);
    const projectSettings = readJsonFileIfValid(settingsPath);
    if (!projectSettings || typeof projectSettings !== 'object') return;
    const updatedSettings = applySkillVisibility(projectSettings, repoConfig);
    if (JSON.stringify(updatedSettings) === JSON.stringify(projectSettings)) return;
    writeJsonFile(settingsPath, updatedSettings);
    migrationReport.changed.push(settingsRelativePath);
  },
  migrateUser() {},
};

export const MIGRATIONS = [lanesToSizing, walkthroughToStoryboard, skillVisibility];
export const LATEST_MIGRATION_NUMBER = MIGRATIONS.at(-1).number;

function readLedgerNumber(ledgerPath) {
  const ledger = readJsonFileIfValid(ledgerPath);
  return Number.isInteger(ledger?.applied) ? ledger.applied : 0;
}

// Runs the pending migrations of one scope ('repo' or 'user') against its folder.
function runScope(scopeName, scopeRoot, ledgerPath, migrations, repoLabel) {
  const scopeReports = [];
  let appliedNumber = readLedgerNumber(ledgerPath);
  for (const migration of migrations.filter((pendingMigration) => pendingMigration.number > appliedNumber)) {
    const migrationReport = { migration: migration.id, summary: migration.summary, scope: scopeName, where: scopeName === 'repo' ? repoLabel : 'your ai1 config folder', changed: [], leftAlone: [], toReview: [] };
    try {
      if (scopeName === 'repo') migration.migrateRepo(scopeRoot, migrationReport);
      else migration.migrateUser(scopeRoot, migrationReport);
    } catch (migrationError) {
      scopeReports.push({ ...migrationReport, error: migrationError.message });
      break;
    }
    appliedNumber = migration.number;
    scopeReports.push(migrationReport);
  }
  return { scopeReports, appliedNumber };
}

// Runs every pending migration for a repo with ai1 (`.ai1/config.json`) and for the person.
// Returns the reports of the migrations that ran (empty when everything was up to date).
// repoLabel: how the report names this checkout ("this repo", "the main checkout").
export function runPendingMigrations(repoRoot, { environment = process.env, homeDirectory = homedir(), migrations = MIGRATIONS, includeUser = true, repoLabel = 'this repo' } = {}) {
  const allReports = [];
  if (existsSync(join(repoRoot, CONFIG_RELATIVE_PATH))) {
    const ledgerPath = join(repoRoot, REPO_LEDGER_RELATIVE_PATH);
    const { scopeReports, appliedNumber } = runScope('repo', repoRoot, ledgerPath, migrations, repoLabel);
    if (appliedNumber > readLedgerNumber(ledgerPath)) {
      ensureWorkDirectoryIgnored(repoRoot);
      writeJsonFile(ledgerPath, { applied: appliedNumber });
    }
    allReports.push(...scopeReports);
  }
  const userDirectory = userConfigDirectory(environment, homeDirectory);
  if (includeUser && existsSync(userDirectory)) {
    const ledgerPath = join(userDirectory, LEDGER_FILE_NAME);
    const { scopeReports, appliedNumber } = runScope('user', userDirectory, ledgerPath, migrations);
    if (appliedNumber > readLedgerNumber(ledgerPath)) writeJsonFile(ledgerPath, { applied: appliedNumber });
    allReports.push(...scopeReports);
  }
  return allReports;
}

// One line per migration that did something, for the agent to pass on; null when there is nothing to say.
export function describeMigrationReports(migrationReports) {
  const reportLines = [];
  for (const migrationReport of migrationReports) {
    if (migrationReport.error) {
      reportLines.push(`${migrationReport.summary}, but migrating ${migrationReport.where} failed (${migrationReport.error}); it will be retried at the next session start or by /ai1:core-setup-repo (ai1 init).`);
      continue;
    }
    const parts = [];
    if (migrationReport.changed.length) parts.push(`changed ${migrationReport.changed.join(', ')}`);
    if (migrationReport.leftAlone.length) parts.push(`left alone ${migrationReport.leftAlone.join(', ')}`);
    if (migrationReport.toReview.length) parts.push(`to update by hand: ${migrationReport.toReview.join(', ')}`);
    if (!parts.length) continue;
    const commitHint = migrationReport.scope === 'repo' && migrationReport.changed.length ? ' Nothing was committed: tell the person in one line and suggest reviewing and committing these changes.' : ' Tell the person in one line.';
    reportLines.push(`${migrationReport.summary} and migrated ${migrationReport.where}: ${parts.join('; ')}.${commitHint}`);
  }
  return reportLines.length ? reportLines.join('\n') : null;
}

// At session start: migrates the checkout whose config the dispatcher reads and the main checkout,
// where shared state lives (work plans, storyboards), each only when ai1 is set up there and with
// its own ledger; the person's folder once. Never throws: a failure becomes the notice.
export function runSessionStartMigrations(hookInput, { environment = process.env, homeDirectory = homedir() } = {}) {
  try {
    const { projectRoot, sharedRoot } = resolveProjectRoots(hookInput, environment);
    const checkoutRoots = [...new Set([projectRoot, sharedRoot])].filter((checkoutRoot) => existsSync(join(checkoutRoot, CONFIG_RELATIVE_PATH)));
    const migrationReports = checkoutRoots.flatMap((checkoutRoot, checkoutIndex) => runPendingMigrations(checkoutRoot, {
      environment,
      homeDirectory,
      includeUser: checkoutIndex === 0,
      repoLabel: checkoutRoot === projectRoot ? 'this repo' : 'the main checkout',
    }));
    return describeMigrationReports(migrationReports);
  } catch (migrationError) {
    return `ai1 could not run its migrations (${migrationError.message}); they will be retried at the next session start or by /ai1:core-setup-repo (ai1 init). Tell the person in one line.`;
  }
}
