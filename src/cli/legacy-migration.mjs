// Moves a repo from the old layout (ai1 was called jig, and OKF bundles live in `.okf/` by
// convention) to `.ai1/`. Run by `ai1 init` before it writes the configuration; the session brief
// points to it when it sees the old layout. Tracked paths move with `git mv` so history follows
// them; nothing is committed. If any target already exists nothing moves.
//   .claude/jig.json -> .ai1/config.json     .okf/ -> .ai1/okf/ (when it is the repo's bundle)
//   docs/rfc/ -> .ai1/later/ (when the rfc feature was on)     .jig/work/ -> .ai1/work/
//   the bundle path of the retired `knowledge` setting (e.g. docs/kb/) -> .ai1/okf/
//   .ai1/rfc/ (the rfc feature before v0.18.0) or .ai1/proposals/ (before v0.24.0) -> .ai1/later/, with
//   the old names in the moved files, the bundle and the work plans renamed (field, index markers,
//   `RFC NNNN` / `Proposal NNNN` of moved numbers)
// Links and repo paths inside the moved bundle and later entries are rewritten; other files that still
// mention old paths are listed for the person, not edited: the docs an agent reads (markdown at the
// root or one level down, and `.claude/`), not vendored or nested projects.

import { runGit } from '../core/git.mjs';
import { readJsonFileIfValid, writeJsonFile } from '../core/json-file.mjs';
import { listMarkdownFiles } from '../core/markdown-files.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, LATER_DIRECTORY, WORK_DIRECTORY, AI1_DIRECTORY, AI1_PLUGIN_ID, SCHEMA_URL } from '../core/config.mjs';
import { ensureWorkDirectoryIgnored } from '../lanes/lanes-work.mjs';
import {
  LEGACY_CONFIG_PATH, LEGACY_DIRECTORY, LEGACY_WORK_PATH, LEGACY_PLUGIN_ID, LEGACY_MARKETPLACE_KEY,
  normalizeRelativePath, planLegacyMigration,
} from '../core/legacy-layout.mjs';

const OLD_PATH_MENTION = /(^|[^\w./-])(\.okf\/|docs\/rfc\/|\.ai1\/rfc\/|\.ai1\/proposals\/|\.claude\/jig\.json|\/jig:|\/ai1:rfc-|\/ai1:proposals-)/;

function isTrackedByGit(repoRoot, relativePath) {
  try {
    return runGit(repoRoot, ['ls-files', '--', relativePath]).trim() !== '';
  } catch {
    return false;
  }
}

function movePath(repoRoot, fromPath, toPath) {
  mkdirSync(dirname(join(repoRoot, toPath)), { recursive: true });
  if (isTrackedByGit(repoRoot, fromPath)) runGit(repoRoot, ['mv', '-k', fromPath, toPath]);
  // git mv -k leaves untracked files behind; move whatever is left.
  if (existsSync(join(repoRoot, fromPath))) moveLeftovers(join(repoRoot, fromPath), join(repoRoot, toPath));
}

function moveLeftovers(fromAbsolutePath, toAbsolutePath) {
  if (!existsSync(toAbsolutePath)) {
    renameSync(fromAbsolutePath, toAbsolutePath);
    return;
  }
  if (!statSync(fromAbsolutePath).isDirectory()) return;
  for (const entryName of readdirSync(fromAbsolutePath)) moveLeftovers(join(fromAbsolutePath, entryName), join(toAbsolutePath, entryName));
  if (readdirSync(fromAbsolutePath).length === 0) rmSync(fromAbsolutePath, { recursive: true });
}

function mapThroughMoves(repoRelativePath, moves) {
  for (const plannedMove of moves) {
    const fromPath = normalizeRelativePath(plannedMove.from);
    if (repoRelativePath === fromPath || repoRelativePath.startsWith(`${fromPath}/`)) return normalizeRelativePath(plannedMove.to) + repoRelativePath.slice(fromPath.length);
  }
  return repoRelativePath;
}

// Rewrites one moved markdown file: relative links are resolved from its old place and pointed to
// the new place of their target; repo paths written as text (`docs/rfc/0001-x.md`, `.okf/`) follow the moves.
function rewriteMovedMarkdown(fileText, oldFilePath, newFilePath, moves) {
  const linkedText = fileText.replace(/\]\(([^)\s#]+)(#[^)\s]*)?\)/g, (linkMatch, linkTarget, linkAnchor = '') => {
    if (/^[a-z]+:|^\//i.test(linkTarget)) return linkMatch;
    const oldTargetPath = posix.normalize(posix.join(posix.dirname(oldFilePath), linkTarget));
    const newTargetPath = mapThroughMoves(oldTargetPath, moves);
    const newLinkTarget = posix.relative(posix.dirname(newFilePath), newTargetPath) || posix.basename(newTargetPath);
    return `](${newLinkTarget}${linkAnchor})`;
  });
  return moves.reduce((rewrittenText, plannedMove) => {
    if (plannedMove.from === LEGACY_CONFIG_PATH || plannedMove.from === LEGACY_WORK_PATH) return rewrittenText;
    const escapedFromPath = normalizeRelativePath(plannedMove.from).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return rewrittenText.replace(new RegExp(`(^|[^\\w./-])${escapedFromPath}(?=/|\\b)`, 'g'), `$1${normalizeRelativePath(plannedMove.to)}`);
  }, linkedText);
}

// The frontmatter field `rfc:` (before v0.18.0) or `proposal:` (before v0.24.0) renamed to `fieldName`.
function renameNumberField(fileText, fieldName) {
  return fileText.replace(/^(---\r?\n(?:[^\n]*\n)*?)(?:rfc|proposal):(?=[ \t])/, `$1${fieldName}:`);
}

// The names of ai1 before v0.24.0 (rfc before v0.18.0, then proposals), renamed to later. In every
// file: `RFC NNNN` and `Proposal NNNN` become `Later NNNN` only for numbers of moved entries (so
// "RFC 3339" or a proposal of something else is never touched), and the skill and CLI names. In the
// entry files themselves also the frontmatter field (`number:`), the index markers and heading, and
// the index text the old CLI generated.
export function renameLaterTerms(fileText, movedEntryNumbers, { isLaterFile = false } = {}) {
  let renamedText = fileText
    .replace(/\b(RFC|Proposal|proposal) (\d{4})\b/g, (numberMatch, oldName, entryNumber) => {
      if (!movedEntryNumbers.has(entryNumber)) return numberMatch;
      return `${oldName === 'proposal' ? 'later' : 'Later'} ${entryNumber}`;
    })
    .replace(/\/ai1:(?:rfc-write-proposal|proposals-write)\b/g, '/ai1:later-write')
    .replace(/`ai1 (?:rfc|proposals)\b/g, '`ai1 later');
  if (isLaterFile) {
    renamedText = renameNumberField(renamedText, 'number')
      .replace(/(?:rfc|proposals)-index:(start|end)/g, 'later-index:$1')
      .replace(/^# (?:RFCs|Proposals)$/m, '# Later')
      .replace(/^Proposals for large changes and future features\. (?:An RFC|A proposal) is not the system:/m, 'Large changes and future features, not decided yet, noted down for later. A later entry is not the system:')
      .replace(/^Create and change (?:RFCs|proposals) with/m, 'Create and change entries with');
  }
  return renamedText;
}

// After a move to .ai1/later/: the bundle and the work plans still name the old folder and field.
// The bundle's log.md is history: its entries keep the names of their time.
function renameLaterTermsOutsideMoves(repoRoot, moves, movedEntryNumbers, alreadyRewrittenPaths) {
  for (const markdownPath of listMarkdownFiles(join(repoRoot, KNOWLEDGE_BUNDLE_PATH))) {
    const repoRelativePath = relative(repoRoot, markdownPath).split('\\').join('/');
    if (alreadyRewrittenPaths.has(repoRelativePath) || repoRelativePath === `${KNOWLEDGE_BUNDLE_PATH}/log.md`) continue;
    const fileText = readFileSync(markdownPath, 'utf8');
    const rewrittenText = renameLaterTerms(rewriteMovedMarkdown(fileText, repoRelativePath, repoRelativePath, moves), movedEntryNumbers);
    if (rewrittenText !== fileText) writeFileSync(markdownPath, rewrittenText);
  }
  for (const planPath of listMarkdownFiles(join(repoRoot, WORK_DIRECTORY)).filter((markdownPath) => markdownPath.endsWith('plan.md'))) {
    const planText = readFileSync(planPath, 'utf8');
    const renamedPlanText = renameNumberField(planText, 'later');
    if (renamedPlanText !== planText) writeFileSync(planPath, renamedPlanText);
  }
}

// The plugin entry keeps its value under the new id; the old marketplace entry goes (`ai1 init`
// writes the new one).
function rewriteSettingsFile(settingsPath) {
  const settingsJson = readJsonFileIfValid(settingsPath);
  if (!settingsJson) return;
  if (settingsJson.enabledPlugins && LEGACY_PLUGIN_ID in settingsJson.enabledPlugins) {
    const { [LEGACY_PLUGIN_ID]: legacyEnabled, ...otherPlugins } = settingsJson.enabledPlugins;
    settingsJson.enabledPlugins = { ...otherPlugins, [AI1_PLUGIN_ID]: legacyEnabled };
  }
  if (settingsJson.extraKnownMarketplaces) delete settingsJson.extraKnownMarketplaces[LEGACY_MARKETPLACE_KEY];
  writeJsonFile(settingsPath, settingsJson);
}

function listFilesMentioningOldPaths(repoRoot) {
  let trackedFiles;
  try {
    trackedFiles = runGit(repoRoot, ['ls-files']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
  return trackedFiles.filter((trackedFile) => {
    const isAgentDoc = trackedFile.startsWith('.claude/') || (trackedFile.endsWith('.md') && trackedFile.split('/').length <= 2);
    if (!isAgentDoc || trackedFile.startsWith(`${AI1_DIRECTORY}/`) || !existsSync(join(repoRoot, trackedFile))) return false;
    try {
      return OLD_PATH_MENTION.test(readFileSync(join(repoRoot, trackedFile), 'utf8'));
    } catch {
      return false;
    }
  });
}

// Applies planLegacyMigration. Returns { moves, settingsFiles, filesMentioningOldPaths }; throws
// before touching anything when a target already exists.
export function migrateLegacyLayout(repoRoot) {
  const { moves, conflicts, settingsFiles } = planLegacyMigration(repoRoot);
  if (conflicts.length) throw new Error(`cannot migrate to ${AI1_DIRECTORY}/: ${conflicts.join(', ')} already exist(s); merge them by hand first`);
  const movedMarkdownFiles = [];
  for (const plannedMove of moves) {
    if (plannedMove.to === KNOWLEDGE_BUNDLE_PATH || plannedMove.to === LATER_DIRECTORY) {
      for (const markdownPath of listMarkdownFiles(join(repoRoot, plannedMove.from))) {
        const oldFilePath = relative(repoRoot, markdownPath).split('\\').join('/');
        movedMarkdownFiles.push({ oldFilePath, newFilePath: mapThroughMoves(oldFilePath, moves) });
      }
    }
    movePath(repoRoot, plannedMove.from, plannedMove.to);
  }
  const movedEntryNumbers = new Set(movedMarkdownFiles
    .filter(({ newFilePath }) => newFilePath.startsWith(`${LATER_DIRECTORY}/`))
    .map(({ newFilePath }) => /\/(\d{4})-[^/]+\.md$/.exec(newFilePath)?.[1])
    .filter(Boolean));
  for (const { oldFilePath, newFilePath } of movedMarkdownFiles) {
    const newAbsolutePath = join(repoRoot, newFilePath);
    if (!existsSync(newAbsolutePath)) continue;
    const fileText = readFileSync(newAbsolutePath, 'utf8');
    const rewrittenText = renameLaterTerms(rewriteMovedMarkdown(fileText, oldFilePath, newFilePath, moves), movedEntryNumbers, {
      isLaterFile: newFilePath.startsWith(`${LATER_DIRECTORY}/`),
    });
    if (rewrittenText !== fileText) writeFileSync(newAbsolutePath, rewrittenText);
  }
  if (moves.some((plannedMove) => plannedMove.to === LATER_DIRECTORY)) {
    renameLaterTermsOutsideMoves(repoRoot, moves, movedEntryNumbers, new Set(movedMarkdownFiles.map(({ newFilePath }) => newFilePath)));
  }
  const migratedConfig = moves.some((plannedMove) => plannedMove.from === LEGACY_CONFIG_PATH) && readJsonFileIfValid(join(repoRoot, CONFIG_RELATIVE_PATH));
  if (migratedConfig) {
    if (migratedConfig.$schema) migratedConfig.$schema = SCHEMA_URL;
    delete migratedConfig.knowledge;
    writeJsonFile(join(repoRoot, CONFIG_RELATIVE_PATH), migratedConfig);
  }
  for (const settingsPath of settingsFiles) rewriteSettingsFile(join(repoRoot, settingsPath));
  if (moves.some((plannedMove) => plannedMove.from === LEGACY_WORK_PATH)) ensureWorkDirectoryIgnored(repoRoot);
  const legacyDirectory = join(repoRoot, LEGACY_DIRECTORY);
  if (existsSync(legacyDirectory) && readdirSync(legacyDirectory).every((entryName) => entryName === '.gitignore')) rmSync(legacyDirectory, { recursive: true });
  return { moves, settingsFiles, filesMentioningOldPaths: moves.length || settingsFiles.length ? listFilesMentioningOldPaths(repoRoot) : [] };
}
