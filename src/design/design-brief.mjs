// design-brief (SessionStart, feature `design`): tells the agent how UI work goes in this repo:
// read the product and design-system context first, avoid the generic AI look, keep a quality floor,
// and expect design-detect to report on every UI file it edits. The design context lives in the
// knowledge bundle as concepts of type `Product` (with the user profiles under `## Users`, which
// /ai1:design-review-usability reads) and `DesignSystem`; Impeccable's PRODUCT.md and DESIGN.md at the
// repo root are read too, so both tools can share the same context. When the Impeccable or the
// frontend-design skill is installed, the brief points to it instead of repeating it, and asks that
// the tokens frontend-design decides land in the design-system context.
// The text only changes when those files or that install change, so it keeps the prompt cache.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { resolveBundleDirectory, readBundleIndex, listBundleConcepts } from '../okf/okf-bundle.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { repoHasFrontend } from '../cli/feature-recommendations.mjs';

const MODULE_ID = 'design-brief';
const DESIGN_CONCEPT_TYPES = new Set(['product', 'designsystem']);
const IMPECCABLE_CONTEXT_FILES = ['PRODUCT.md', 'DESIGN.md'];

// Repo-relative paths of the files that hold the product and design-system context.
export function listDesignContextFiles(projectRoot, config) {
  const contextFiles = [];
  if (isFeatureEnabled('okf', config)) {
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (readBundleIndex(bundleDirectory) !== null) {
      const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
      contextFiles.push(...listBundleConcepts(bundleDirectory)
        .filter((bundleConcept) => DESIGN_CONCEPT_TYPES.has(bundleConcept.type.replace(/[\s_-]/g, '').toLowerCase()))
        .map((bundleConcept) => `${bundleRelativePath}/${bundleConcept.relativePath}`)
        .sort());
    }
  }
  contextFiles.push(...IMPECCABLE_CONTEXT_FILES.filter((contextFileName) => existsSync(join(projectRoot, contextFileName))));
  return contextFiles;
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

export function buildDesignRecipe({ contextFiles, canRecordInBundle, hasImpeccable, hasFrontendDesign }) {
  let contextRule;
  if (contextFiles.length) {
    contextRule = `- Context first: before building or changing UI, read the product and design-system context (${contextFiles.map((contextFile) => `\`${contextFile}\``).join(', ')}): who the product is for, its tone, palette, type scale, spacing and radii. Use its tokens; a new colour, font or size is a deliberate addition to that context, not a one-off.`;
  } else {
    const recordWhere = canRecordInBundle
      ? 'record the answers as knowledge concepts of type `Product` (the people who use it under `## Users`, one `### <name>` per profile: who they are, what they already know, device, what they come to do) and `DesignSystem` (with /ai1:okf-maintain-knowledge)'
      : 'write them down in the repo';
    contextRule = `- Context first: there is no product or design-system context yet. Before a sizeable UI task, ask the person who uses the product, its tone and its brand (colours, typefaces), then ${recordWhere} and follow them.`;
  }
  const recipeLines = [
    'Design: UI in this repo comes from its own context, not from defaults.',
    contextRule,
    '- Avoid the generic AI look: no Inter / Roboto / Geist by reflex, no purple-violet gradients or gradient text, no coloured glows, no thick accent border on one side of a card, no icon tile above every heading, no tiny uppercase kicker above headings, no cream background by reflex, no marketing buzzwords (seamless, empower, cutting-edge...).',
    '- Quality floor: text contrast of at least 4.5:1 (WCAG AA), no text under 11px, heading levels in order, real images (no empty or placeholder src), spacing with rhythm (tight inside a group, generous between sections).',
    '- The design-detect hook checks every UI file you edit and reports what the edit introduced: fix each finding or say in one line why the choice is deliberate.',
    '- Whether a flow is intuitive for the people who use it (the profiles under `## Users` of the `Product` context) is checked with /ai1:design-review-usability, offered after a storyboard.',
  ];
  if (hasFrontendDesign) {
    recipeLines.push(`- The frontend-design skill is installed: use it to set the visual direction of new UI or a redesign, then record the palette, typefaces and type scale it decides in the design-system context${canRecordInBundle ? ' (the `DesignSystem` concept)' : ''}, so later sessions and design-detect build on them.`);
  }
  if (hasImpeccable) {
    recipeLines.push('- The impeccable skill is installed: for a deeper pass use /impeccable critique or /impeccable audit to review, and /impeccable polish before calling UI work done.');
  }
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
    return contextDecision(MODULE_ID, buildDesignRecipe({
      contextFiles: listDesignContextFiles(projectRoot, config),
      canRecordInBundle: isFeatureEnabled('okf', config),
      hasImpeccable: isDesignSkillInstalled('impeccable', projectRoot, homeDirectory),
      hasFrontendDesign: isDesignSkillInstalled('frontend-design', projectRoot, homeDirectory),
    }));
  },
};
