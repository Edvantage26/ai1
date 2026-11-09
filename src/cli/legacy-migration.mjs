// Moves a repo from the old layout (ai1 was called jig, and OKF bundles live in `.okf/` by
// convention) to `.ai1/`. Run by `ai1 init` before it writes the configuration; the session brief
// points to it when it sees the old layout. Tracked paths move with `git mv` so history follows
// them; nothing is committed. If any target already exists nothing moves.
//   .claude/jig.json -> .ai1/config.json     .okf/ -> .ai1/okf/ (when it is the repo's bundle)
//   docs/rfc/ -> .ai1/rfc/ (when the rfc feature was on)     .jig/work/ -> .ai1/work/
//   the bundle path of the retired `knowledge` setting (e.g. docs/kb/) -> .ai1/okf/
// Links and repo paths inside the moved bundle and RFCs are rewritten; other files that still
// mention old paths are listed for the person, not edited: the docs an agent reads (markdown at the
// root or one level down, and `.claude/`), not vendored or nested projects.

import { runGit } from '../core/git.mjs';
import { readJsonFileIfValid, writeJsonFile } from '../core/json-file.mjs';
import { listMarkdownFiles } from '../core/markdown-files.mjs';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { CONFIG_RELATIVE_PATH, KNOWLEDGE_BUNDLE_PATH, AI1_DIRECTORY, AI1_PLUGIN_ID, SCHEMA_URL } from '../core/config.mjs';
import { ensureWorkDirectoryIgnored } from '../lanes/lanes-work.mjs';
import {
  LEGACY_CONFIG_PATH, LEGACY_RFC_PATH, LEGACY_DIRECTORY, LEGACY_WORK_PATH, LEGACY_PLUGIN_ID, LEGACY_MARKETPLACE_KEY,
  normalizeRelativePath, planLegacyMigration,
} from '../core/legacy-layout.mjs';

const OLD_PATH_MENTION = /(^|[^\w./-])(\.okf\/|docs\/rfc\/|\.claude\/jig\.json|\/jig:)/;

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
    if (plannedMove.to === KNOWLEDGE_BUNDLE_PATH || plannedMove.from === LEGACY_RFC_PATH) {
      for (const markdownPath of listMarkdownFiles(join(repoRoot, plannedMove.from))) {
        const oldFilePath = relative(repoRoot, markdownPath).split('\\').join('/');
        movedMarkdownFiles.push({ oldFilePath, newFilePath: mapThroughMoves(oldFilePath, moves) });
      }
    }
    movePath(repoRoot, plannedMove.from, plannedMove.to);
  }
  for (const { oldFilePath, newFilePath } of movedMarkdownFiles) {
    const newAbsolutePath = join(repoRoot, newFilePath);
    if (!existsSync(newAbsolutePath)) continue;
    const fileText = readFileSync(newAbsolutePath, 'utf8');
    const rewrittenText = rewriteMovedMarkdown(fileText, oldFilePath, newFilePath, moves);
    if (rewrittenText !== fileText) writeFileSync(newAbsolutePath, rewrittenText);
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
