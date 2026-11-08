// Shared helpers for the `okf` feature: where the bundle is, its spec version, and the rules the
// agent must follow when maintaining it. Text addressed to the agent lives here so both OKF
// modules say the same thing.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { splitFrontmatter, readFrontmatterField } from '../core/frontmatter.mjs';
import { DEFAULT_KNOWLEDGE_PATH } from '../core/config.mjs';

export function resolveBundleDirectory(projectRoot, config) {
  return join(projectRoot, config.knowledge || DEFAULT_KNOWLEDGE_PATH);
}

export function readBundleIndex(bundleDirectory) {
  const indexPath = join(bundleDirectory, 'index.md');
  return existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null;
}

// Reads `okf_version` from the index frontmatter; null when absent.
export function readBundleSpecVersion(indexText) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(indexText || '');
  const versionMatch = frontmatterMatch && /^okf_version:\s*['"]?([0-9.]+)['"]?\s*$/m.exec(frontmatterMatch[1]);
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

function listConceptFiles(directoryPath) {
  const conceptFiles = [];
  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entryName);
    if (statSync(entryPath).isDirectory()) conceptFiles.push(...listConceptFiles(entryPath));
    else if (entryName.endsWith('.md') && entryName !== 'index.md' && entryName !== 'log.md') conceptFiles.push(entryPath);
  }
  return conceptFiles;
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
      bodyText,
    };
  });
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
