// design-brief (SessionStart, feature `design`): tells the agent how UI work goes in this repo:
// read the product and design-system context first, avoid the generic AI look, keep a quality floor,
// and expect design-detect to report on every UI file it edits. The design context lives in the
// knowledge bundle as concepts of type `Product` (with the user profiles under `## Users`, which
// /ai1:design-review-usability reads) and `DesignSystem`; Impeccable's PRODUCT.md and DESIGN.md at the
// repo root are read too, so both tools can share the same context. When the Impeccable or the
// frontend-design skill is installed, the brief points to it instead of repeating it, and asks that
// the tokens frontend-design decides land in the design-system context. A client's brand (`## Brand` of
// the `DesignSystem` concept or DESIGN.md) is used when recorded, else gathered with
// /ai1:design-gather-brand before designing.
// The text only changes when those files or that install change, so it keeps the prompt cache.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { resolveBundleDirectory, readBundleIndex, listBundleConcepts } from '../okf/okf-bundle.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { repoHasFrontend } from '../cli/feature-recommendations.mjs';
import { isDesignSystemConcept, readBrandSection } from './brand-find.mjs';

const MODULE_ID = 'design-brief';
const DESIGN_CONCEPT_TYPES = new Set(['product', 'designsystem']);
const IMPECCABLE_CONTEXT_FILES = ['PRODUCT.md', 'DESIGN.md'];

// Repo-relative paths of the files that hold the product and design-system context, and the first of
// them with a `## Brand` section (a `DesignSystem` concept or DESIGN.md), null when none has it.
export function readDesignContext(projectRoot, config) {
  const contextFiles = [];
  let brandFile = null;
  if (isFeatureEnabled('okf', config)) {
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (readBundleIndex(bundleDirectory) !== null) {
      const designConcepts = listBundleConcepts(bundleDirectory)
        .filter((bundleConcept) => DESIGN_CONCEPT_TYPES.has(bundleConcept.type.replace(/[\s_-]/g, '').toLowerCase()))
        .sort((leftConcept, rightConcept) => leftConcept.relativePath.localeCompare(rightConcept.relativePath));
      contextFiles.push(...designConcepts.map((bundleConcept) => `${KNOWLEDGE_BUNDLE_PATH}/${bundleConcept.relativePath}`));
      const brandConcept = designConcepts.find((bundleConcept) => isDesignSystemConcept(bundleConcept) && readBrandSection(bundleConcept.bodyText) !== null);
      if (brandConcept) brandFile = `${KNOWLEDGE_BUNDLE_PATH}/${brandConcept.relativePath}`;
    }
  }
  for (const contextFileName of IMPECCABLE_CONTEXT_FILES) {
    const contextFilePath = join(projectRoot, contextFileName);
    if (!existsSync(contextFilePath)) continue;
    contextFiles.push(contextFileName);
    if (!brandFile && contextFileName === 'DESIGN.md' && readBrandSection(readFileSync(contextFilePath, 'utf8')) !== null) brandFile = contextFileName;
  }
  return { contextFiles, brandFile };
}

// A design skill as a Claude Code plugin of that name (any marketplace) or as a skill in the repo or
// the user folder.
export function isDesignSkillInstalled(skillName, projectRoot, homeDirectory = homedir()) {
  const skillPaths = [join(projectRoot, '.claude', 'skills', skillName, 'SKILL.md'), join(homeDirectory, '.claude', 'skills', skillName, 'SKILL.md')];
  if (skillPaths.some((skillPath) => existsSync(skillPath))) return true;
  try {
    const installedPlugins = JSON.parse(readFileSync(join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.keys(installedPlugins.plugins || installedPlugins).some((pluginKey) => pluginKey.startsWith(`${skillName}@`));
  } catch {
    return false;
  }
}

export function buildDesignRecipe({ contextFiles, brandFile, canRecordInBundle, hasImpeccable, hasFrontendDesign }) {
  let contextRule;
  if (contextFiles.length) {
    contextRule = `- Context first: before building or changing UI, read the product and design-system context (${contextFiles.map((contextFile) => `\`${contextFile}\``).join(', ')}): who the product is for, its tone, palette, type scale, spacing and radii. Use its tokens; a new colour, font or size is a deliberate addition to that context, not a one-off.`;
  } else {
    const recordWhere = canRecordInBundle
      ? 'record them as concepts of type `Product` (the people who use it under `## Users`, one `### <name>` per profile) and `DesignSystem` (/ai1:okf-maintain-knowledge)'
      : 'write them down in the repo';
    contextRule = `- Context first: there is no product or design-system context yet. Before sizeable UI work, ask who uses the product and its tone, then ${recordWhere}.`;
  }
  // What depends on this repo first, the fixed rules last: an over-limit session start is cut at the end.
  const brandRule = brandFile
    ? `- Brand: recorded in \`${brandFile}\` (\`## Brand\`): design with its colours, logo and typefaces; never swap the logo or invent brand colours.`
    : '- Client brand: gather it first (colours, logo, images: /ai1:design-gather-brand); design within it.';
  const recipeLines = [
    'Design: UI in this repo comes from its own context, not from defaults.',
    contextRule,
    brandRule,
  ];
  if (hasFrontendDesign) {
    recipeLines.push(`- The frontend-design skill is installed: use it for the visual direction of new UI within the brand; record its palette, fonts and type scale in ${canRecordInBundle ? 'the `DesignSystem` concept' : 'the design-system context'}.`);
  }
  if (hasImpeccable) {
    recipeLines.push('- The impeccable skill is installed: for a deeper pass use /impeccable critique or /impeccable audit to review, and /impeccable polish before calling UI work done.');
  }
  // The full lists of design-detect's checks arrive with its findings, on the edit that breaks one.
  recipeLines.push(
    '- Avoid the generic AI look (fonts, purple gradients, glows, accent borders, icon tiles, kickers, buzzwords) and keep the quality floor (contrast 4.5:1, text 11px or more, heading order, real images, spacing with rhythm). The design-detect hook checks every UI file you edit: fix each finding or say why it is deliberate.',
    '- Is a flow intuitive for its users (`## Users`)? /ai1:design-review-usability, offered after a storyboard.',
  );
  return recipeLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'design',
  description: 'Gives the agent the UI rules at session start: read the product and design-system context, avoid the generic AI look, keep a quality floor.',
  run({ hookInput, config, projectRoot, homeDirectory }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    // On by default everywhere since v0.36.0: a repo without a frontend pays nothing for it.
    if (!repoHasFrontend(projectRoot)) return allowDecision();
    const { contextFiles, brandFile } = readDesignContext(projectRoot, config);
    return contextDecision(MODULE_ID, buildDesignRecipe({
      contextFiles,
      brandFile,
      canRecordInBundle: isFeatureEnabled('okf', config),
      hasImpeccable: isDesignSkillInstalled('impeccable', projectRoot, homeDirectory),
      hasFrontendDesign: isDesignSkillInstalled('frontend-design', projectRoot, homeDirectory),
    }));
  },
};
