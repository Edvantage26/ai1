// Shared helpers for the `okf` feature: where the bundle is, its spec version, and the rules the
// agent must follow when maintaining it. Text addressed to the agent lives here so both OKF
// modules say the same thing.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { listMarkdownFiles } from '../core/markdown-files.mjs';
import { tryGit } from '../core/git.mjs';
import { splitFrontmatter, readFrontmatterField } from '../core/frontmatter.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

export function resolveBundleDirectory(projectRoot) {
  return join(projectRoot, KNOWLEDGE_BUNDLE_PATH);
}

export function readBundleIndex(bundleDirectory) {
  const indexPath = join(bundleDirectory, 'index.md');
  return existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
}

// Reads `okf_version` from the index frontmatter; null when absent.
export function readBundleSpecVersion(indexText) {
  const { frontmatterText } = splitFrontmatter(indexText || '');
  const versionMatch = frontmatterText && /^okf_version:\s*['"]?([0-9.]+)['"]?\s*$/m.exec(frontmatterText);
  return versionMatch ? versionMatch[1] : null;
}

export function newestModificationMilliseconds(directoryPath) {
  let newestMilliseconds = 0;
  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entryName);
    const entryStats = statSync(entryPath);
    const entryMilliseconds = entryStats.isDirectory() ? newestModificationMilliseconds(entryPath) : entryStats.mtimeMs;
    newestMilliseconds = Math.max(newestMilliseconds, entryMilliseconds);
  }
  return newestMilliseconds;
}

// Concept files: every markdown file but the index.md and log.md of each folder.
function listConceptFiles(directoryPath) {
  return listMarkdownFiles(directoryPath).filter((markdownPath) => !['index.md', 'log.md'].includes(basename(markdownPath)));
}

// Every concept of the bundle with its main frontmatter fields and its body.
export function listBundleConcepts(bundleDirectory) {
  return listConceptFiles(bundleDirectory).map((conceptPath) => {
    const { frontmatterText, bodyText } = splitFrontmatter(readFileSync(conceptPath, 'utf8'));
    return {
      relativePath: relative(bundleDirectory, conceptPath),
      type: readFrontmatterField(frontmatterText, 'type'),
      title: readFrontmatterField(frontmatterText, 'title'),
      description: readFrontmatterField(frontmatterText, 'description'),
      tags: readFrontmatterField(frontmatterText, 'tags'),
      frontmatterText,
      bodyText,
    };
  });
}

// The page that describes the whole project: overview.md at the bundle root, or the root index.md
// when the bundle has no overview.
export function overviewFileName(bundleDirectory) {
  return existsSync(join(bundleDirectory, 'overview.md')) ? 'overview.md' : 'index.md';
}

// A concept is a page of the bundle other than an index.md, a log.md or the root overview.md.
// Path relative to the bundle.
export function isConceptPath(bundleFilePath) {
  return bundleFilePath.endsWith('.md') && !['index.md', 'log.md'].includes(basename(bundleFilePath))
    && bundleFilePath !== 'overview.md';
}

const MARKDOWN_LINK_PATTERN = /\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const URI_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

// Concepts (the root overview.md included) that no index.md of the bundle links to: nobody finds
// them by browsing from the index. A link starting with `/` is relative to the bundle root.
export function listConceptsMissingFromIndex(bundleDirectory) {
  const linkedPaths = new Set();
  for (const indexPath of listMarkdownFiles(bundleDirectory).filter((markdownPath) => basename(markdownPath) === 'index.md')) {
    for (const [, linkTarget] of readFileSync(indexPath, 'utf8').matchAll(MARKDOWN_LINK_PATTERN)) {
      const targetPath = linkTarget.split('#')[0];
      if (!targetPath || URI_SCHEME_PATTERN.test(targetPath)) continue;
      const targetDirectory = targetPath.startsWith('/') ? bundleDirectory : dirname(indexPath);
      linkedPaths.add(relative(bundleDirectory, join(targetDirectory, targetPath)));
    }
  }
  return listConceptFiles(bundleDirectory)
    .map((conceptPath) => relative(bundleDirectory, conceptPath))
    .filter((conceptPath) => !linkedPaths.has(conceptPath))
    .sort();
}

// Concepts that still exist and changed in commits after the last one that touched the overview:
// the overview may not describe them yet. [] without git or when the overview was never committed.
export function listConceptsChangedSinceOverview(projectRoot, bundleRelativePath) {
  const overviewRepoPath = `${bundleRelativePath}/${overviewFileName(join(projectRoot, bundleRelativePath))}`;
  const overviewLastCommit = tryGit(projectRoot, ['log', '-1', '--format=%H', '--', overviewRepoPath]);
  if (!overviewLastCommit) return [];
  const changedOutput = tryGit(projectRoot, ['log', '--format=', '--name-only', `${overviewLastCommit}..HEAD`, '--', bundleRelativePath]) || '';
  const bundlePrefix = `${bundleRelativePath}/`;
  return [...new Set(changedOutput.split('\n'))]
    .filter((changedPath) => changedPath.startsWith(bundlePrefix) && isConceptPath(changedPath.slice(bundlePrefix.length))
      && existsSync(join(projectRoot, changedPath)))
    .sort();
}

export function buildMaintenanceRules(bundleRelativePath, specVersion) {
  const maintenanceRules = [
    `Update the affected concept in \`${bundleRelativePath}/\`: body, cross-links, and \`generated: { by: claude-code/<model>, at: <now> }\` with the real current UTC time (\`date -u +%Y-%m-%dT%H:%M:%SZ\`); a person writes \`human:<id>\`. A new asset gets a new concept.`,
    `Add a dated entry to \`${bundleRelativePath}/log.md\` only for lifecycle events (created, deprecated, superseded, regenerated, verified); routine edits get none.`,
    `Validate with /ai1:okf-validate-bundle ${bundleRelativePath} and fix every ERROR.`,
  ];
  if (specVersion && specVersion.startsWith('0.1')) {
    maintenanceRules.push('This bundle is still OKF v0.1: legacy-format warnings (timestamp, # Citations) are expected. Do NOT migrate the bundle on your own; migration is a deliberate, per-repo step. In each concept you edit, REPLACE its `timestamp:` line with `generated` (do not keep both).');
  }
  return maintenanceRules;
}
