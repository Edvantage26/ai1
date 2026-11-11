// Migrations: when a new ai1 version renames or moves something it wrote (a feature id, a folder,
// a skill name), the repo and the person's own config are brought up to date by themselves, like a
// database migration. Each migration has a number, a repo part and a user part, and is idempotent.
// A ledger with the last applied number keeps them from running again: in the repo it is local to
// the checkout (`.ai1/work/migrations.json`, ignored by git), for the person it sits in their ai1
// config folder (`~/.config/ai1/migrations.json`, written only if that folder exists).
// Run at SessionStart by bin/ai1-hook.mjs before the dispatch (so this session already reads the
// new names) and by `ai1 init`. Nothing is committed: the changed files are reported, for the person
// to review and commit. A migration that throws leaves its ledger where it was and is reported.

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, LATER_DIRECTORY, WORK_DIRECTORY } from './config.mjs';
import { readJsonFileIfValid, writeJsonFile } from './json-file.mjs';
import { listMarkdownFiles } from './markdown-files.mjs';
import { SKILL_OVERLAYS_DIRECTORY, userConfigDirectory } from './skill-customization.mjs';
import { ensureWorkDirectoryIgnored } from '../sizing/sizing-work.mjs';
import { resolveProjectRoots } from './project-roots.mjs';

const LEDGER_FILE_NAME = 'migrations.json';
export const REPO_LEDGER_RELATIVE_PATH = `${WORK_DIRECTORY}/${LEDGER_FILE_NAME}`;

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

// Moves a folder to its new name unless the new one already exists (then both stay, reported).
function moveFolderUnlessTaken(fromPath, toPath, migrationReport, displayPath) {
  if (!existsSync(fromPath)) return;
  if (existsSync(toPath)) {
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

const LANES_MODULE_IDS = ['lanes-brief', 'lanes-approval', 'lanes-gate', 'lanes-escalate'];
const renameLanesSkill = (fileText) => fileText.replace(/\/ai1:lanes-design-before-code\b/g, '/ai1:sizing-design-before-code');

// v0.32.0: the lanes feature is called sizing (feature and module ids, the deep skill, the overlay
// folders, the plan-task field `lane: plan` -> `size: plan`). The bundle's log.md is history: untouched.
const lanesToSizing = {
  number: 1,
  id: 'lanes-to-sizing',
  summary: 'ai1 v0.32.0 renamed the lanes feature to sizing',
  migrateRepo(repoRoot, migrationReport) {
    const displayPath = (absolutePath) => relative(repoRoot, absolutePath).split('\\').join('/');
    const configPath = join(repoRoot, CONFIG_RELATIVE_PATH);
    const repoConfig = readJsonFileIfValid(configPath);
    if (repoConfig && typeof repoConfig === 'object') {
      const renamedConfig = {
        ...repoConfig,
        ...(repoConfig.features !== undefined ? { features: renameConfigKeys(repoConfig.features, { lanes: 'sizing' }) } : {}),
        ...(repoConfig.modules !== undefined ? { modules: renameConfigKeys(repoConfig.modules, Object.fromEntries(LANES_MODULE_IDS.map((moduleId) => [moduleId, moduleId.replace('lanes-', 'sizing-')]))) } : {}),
      };
      if (JSON.stringify(renamedConfig) !== JSON.stringify(repoConfig)) {
        writeJsonFile(configPath, renamedConfig);
        migrationReport.changed.push(CONFIG_RELATIVE_PATH);
      }
    }
    const overlaysDirectory = join(repoRoot, SKILL_OVERLAYS_DIRECTORY);
    moveFolderUnlessTaken(join(overlaysDirectory, 'lanes'), join(overlaysDirectory, 'sizing'), migrationReport, displayPath);
    const bundleLogPath = join(repoRoot, KNOWLEDGE_BUNDLE_PATH, 'log.md');
    const ai1Texts = [
      ...listMarkdownFiles(join(repoRoot, KNOWLEDGE_BUNDLE_PATH)).filter((markdownPath) => markdownPath !== bundleLogPath),
      ...listMarkdownFiles(join(repoRoot, LATER_DIRECTORY)),
      ...listMarkdownFiles(overlaysDirectory),
      ...listMarkdownFiles(join(repoRoot, '.claude', 'skills')),
    ];
    for (const textPath of ai1Texts) rewriteTextFile(textPath, renameLanesSkill, migrationReport, displayPath);
    const workPlans = listMarkdownFiles(join(repoRoot, WORK_DIRECTORY)).filter((markdownPath) => markdownPath.endsWith('plan.md'));
    for (const planPath of workPlans) {
      rewriteTextFile(planPath, (planText) => renameLanesSkill(planText).replace(/^(---\r?\n(?:[^\n]*\n)*?)lane:(?=[ \t]*['"]?plan\b)/, '$1size:'), migrationReport, displayPath);
    }
    // The person's own docs (CLAUDE.md, AGENTS.md...) are theirs: listed, not edited.
    for (const directoryEntry of readdirSync(repoRoot, { withFileTypes: true })) {
      if (!directoryEntry.isFile() || !directoryEntry.name.endsWith('.md')) continue;
      if (readFileSync(join(repoRoot, directoryEntry.name), 'utf8').includes('/ai1:lanes-design-before-code')) {
        migrationReport.toReview.push(`${directoryEntry.name} (names /ai1:lanes-design-before-code, now /ai1:sizing-design-before-code)`);
      }
    }
  },
  migrateUser(userDirectory, migrationReport) {
    const displayPath = (absolutePath) => absolutePath;
    moveFolderUnlessTaken(join(userDirectory, 'skills', 'lanes'), join(userDirectory, 'skills', 'sizing'), migrationReport, displayPath);
    for (const overlayPath of listMarkdownFiles(join(userDirectory, 'skills'))) rewriteTextFile(overlayPath, renameLanesSkill, migrationReport, displayPath);
  },
};

export const MIGRATIONS = [lanesToSizing];
export const LATEST_MIGRATION_NUMBER = MIGRATIONS.at(-1).number;

function readLedgerNumber(ledgerPath) {
  const ledger = readJsonFileIfValid(ledgerPath);
  return Number.isInteger(ledger?.applied) ? ledger.applied : 0;
}

// Runs the pending migrations of one scope ('repo' or 'user') against its folder.
function runScope(scopeName, scopeRoot, ledgerPath, migrations) {
  const scopeReports = [];
  let appliedNumber = readLedgerNumber(ledgerPath);
  for (const migration of migrations.filter((pendingMigration) => pendingMigration.number > appliedNumber)) {
    const migrationReport = { migration: migration.id, summary: migration.summary, scope: scopeName, changed: [], leftAlone: [], toReview: [] };
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
export function runPendingMigrations(repoRoot, { environment = process.env, homeDirectory = homedir(), migrations = MIGRATIONS, includeUser = true } = {}) {
  const allReports = [];
  if (existsSync(join(repoRoot, CONFIG_RELATIVE_PATH))) {
    const ledgerPath = join(repoRoot, REPO_LEDGER_RELATIVE_PATH);
    const { scopeReports, appliedNumber } = runScope('repo', repoRoot, ledgerPath, migrations);
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
    const where = migrationReport.scope === 'repo' ? 'this repo' : 'your ai1 config folder';
    if (migrationReport.error) {
      reportLines.push(`${migrationReport.summary}, but migrating ${where} failed (${migrationReport.error}); it will be retried at the next session start or by /ai1:core-setup-repo (ai1 init).`);
      continue;
    }
    const parts = [];
    if (migrationReport.changed.length) parts.push(`changed ${migrationReport.changed.join(', ')}`);
    if (migrationReport.leftAlone.length) parts.push(`left alone ${migrationReport.leftAlone.join(', ')}`);
    if (migrationReport.toReview.length) parts.push(`to update by hand: ${migrationReport.toReview.join(', ')}`);
    if (!parts.length) continue;
    const commitHint = migrationReport.scope === 'repo' && migrationReport.changed.length ? ' Nothing was committed: tell the person in one line and suggest reviewing and committing these changes.' : ' Tell the person in one line.';
    reportLines.push(`${migrationReport.summary} and migrated ${where}: ${parts.join('; ')}.${commitHint}`);
  }
  return reportLines.length ? reportLines.join('\n') : null;
}

// At session start: migrates the checkout whose config the dispatcher will read (the worktree's own,
// else the main checkout's), only when ai1 is set up there. Never throws: a failure becomes the notice.
export function runSessionStartMigrations(hookInput, { environment = process.env, homeDirectory = homedir() } = {}) {
  try {
    const { projectRoot, sharedRoot } = resolveProjectRoots(hookInput, environment);
    const migratedRoot = existsSync(join(projectRoot, CONFIG_RELATIVE_PATH)) ? projectRoot : sharedRoot;
    if (!existsSync(join(migratedRoot, CONFIG_RELATIVE_PATH))) return null;
    return describeMigrationReports(runPendingMigrations(migratedRoot, { environment, homeDirectory }));
  } catch (migrationError) {
    return `ai1 could not run its migrations (${migrationError.message}); they will be retried at the next session start or by /ai1:core-setup-repo (ai1 init). Tell the person in one line.`;
  }
}
