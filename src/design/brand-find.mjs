// `ai1 brand find "<owner>"`: the brand of a client already recorded in another repo on this machine,
// so /ai1:design-gather-brand reuses it instead of starting over. A brand lives in a `DesignSystem`
// concept with `brand_owner: <name>` in its frontmatter and a `## Brand` section (logo, colours,
// typefaces, imagery, each with its source). Repos come from the decision-log sidecars (every repo
// where ai1 ran) and `related` in .ai1/config.json. Exact name match, ignoring case, accents and
// punctuation: another client's brand is worse than none. No network.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { listLoggedRepositories } from '../core/decision-log.mjs';
import { readFrontmatterField } from '../core/frontmatter.mjs';
import { findMainCheckout, findWorkingTreeTop } from '../core/project-roots.mjs';
import { listBundleConcepts } from '../okf/okf-bundle.mjs';
import { findBundleIndex, resolveRelatedEntries } from '../okf/okf-related.mjs';

export const BRAND_OWNER_FIELD = 'brand_owner';
export const BRAND_HEADING = '## Brand';

export function normalizeBrandOwner(ownerName) {
  return String(ownerName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function isDesignSystemConcept(bundleConcept) {
  return String(bundleConcept.type ?? '').replace(/[\s_-]/g, '').toLowerCase() === 'designsystem';
}

// The `## Brand` section of a concept body (heading excluded), up to the next `## ` heading; null when absent.
export function readBrandSection(bodyText) {
  const bodyLines = String(bodyText ?? '').split('\n');
  const headingIndex = bodyLines.findIndex((bodyLine) => bodyLine.trim().toLowerCase() === BRAND_HEADING.toLowerCase());
  if (headingIndex < 0) return null;
  const nextHeadingOffset = bodyLines.slice(headingIndex + 1).findIndex((bodyLine) => /^##\s/.test(bodyLine));
  const sectionLines = bodyLines.slice(headingIndex + 1, nextHeadingOffset < 0 ? undefined : headingIndex + 1 + nextHeadingOffset);
  return sectionLines.join('\n').trim();
}

// Backticked paths that exist under the repo, made absolute so the brand can be copied from here.
function absolutizeAssetPaths(brandText, repoRoot) {
  return brandText.replace(/`([^`\s]+)`/g, (quotedPath, assetPath) => {
    if (isAbsolute(assetPath) || /^[a-z]+:\/\//i.test(assetPath)) return quotedPath;
    const absolutePath = resolve(repoRoot, assetPath);
    return existsSync(absolutePath) ? `\`${absolutePath}\`` : quotedPath;
  });
}

function mainCheckoutOf(directoryPath) {
  if (!directoryPath || !existsSync(directoryPath)) return null;
  const treeTop = findWorkingTreeTop(directoryPath);
  return treeTop ? findMainCheckout(treeTop) : null;
}

// [{ repoRoot, bundleDirectory }] of every other repo ai1 knows on this machine, once each.
function listCandidateRepositories(projectRoot, relatedEntries, environment, homeDirectory) {
  const currentCheckout = mainCheckoutOf(projectRoot);
  const candidates = new Map();
  for (const resolvedEntry of resolveRelatedEntries(projectRoot, relatedEntries)) {
    if (resolvedEntry.repoRoot && resolvedEntry.bundleIndex) candidates.set(resolvedEntry.repoRoot, dirname(resolvedEntry.bundleIndex));
  }
  for (const loggedRepository of listLoggedRepositories(environment, homeDirectory)) {
    const repoRoot = mainCheckoutOf(loggedRepository.path);
    if (!repoRoot || candidates.has(repoRoot)) continue;
    const bundleIndex = findBundleIndex(repoRoot);
    if (bundleIndex) candidates.set(repoRoot, dirname(bundleIndex));
  }
  candidates.delete(currentCheckout);
  return [...candidates].map(([repoRoot, bundleDirectory]) => ({ repoRoot, bundleDirectory }));
}

// [{ repoRoot, conceptPath, brandOwner, brand }] for every DesignSystem concept of that owner.
export function findRecordedBrands({ projectRoot, ownerName, relatedEntries = [], environment = process.env, homeDirectory }) {
  const wantedOwner = normalizeBrandOwner(ownerName);
  if (!wantedOwner) throw new Error('usage: ai1 brand find "<client or owner name>"');
  return listCandidateRepositories(projectRoot, relatedEntries, environment, homeDirectory).flatMap(({ repoRoot, bundleDirectory }) => {
    let bundleConcepts;
    try {
      bundleConcepts = listBundleConcepts(bundleDirectory);
    } catch {
      return [];
    }
    return bundleConcepts
      .filter((bundleConcept) => isDesignSystemConcept(bundleConcept))
      .map((bundleConcept) => ({ bundleConcept, brandOwner: readFrontmatterField(bundleConcept.frontmatterText, BRAND_OWNER_FIELD) }))
      .filter(({ brandOwner }) => normalizeBrandOwner(brandOwner) === wantedOwner)
      .map(({ bundleConcept, brandOwner }) => ({
        repoRoot,
        conceptPath: join(bundleDirectory, bundleConcept.relativePath),
        brandOwner,
        brand: absolutizeAssetPaths(readBrandSection(bundleConcept.bodyText) ?? '', repoRoot),
      }));
  });
}

export function formatRecordedBrands(ownerName, recordedBrands) {
  if (!recordedBrands.length) return `ai1 brand find: no brand of "${ownerName}" recorded in other repos on this machine (DesignSystem concepts with ${BRAND_OWNER_FIELD}).`;
  return recordedBrands.map((recordedBrand) => [
    `${recordedBrand.brandOwner} in ${recordedBrand.repoRoot}`,
    `concept: ${recordedBrand.conceptPath}`,
    recordedBrand.brand || '(no `## Brand` section in it)',
  ].join('\n')).join('\n\n');
}
