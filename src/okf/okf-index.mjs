// okf-index (SessionStart, feature `okf`): puts the bundle's index.md in the agent's context with
// the maintenance rules and the concepts the overview or the indexes miss, and records the HEAD at session start so okf-upkeep can tell which files
// this session changed.

import { contextDecision } from '../core/hook-io.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';
import {
  resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, buildMaintenanceRules, overviewFileName,
  listConceptsChangedSinceOverview, listConceptsMissingFromIndex,
} from './okf-bundle.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

const MODULE_ID = 'okf-index';
const MAX_INDEX_CHARACTERS = 12000;
const MAX_LISTED_CONCEPTS = 10;

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'okf',
  description: 'Loads the OKF bundle index and its maintenance rules at session start.',
  run({ hookInput, config, projectRoot, environment }) {
    const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    const indexText = readBundleIndex(bundleDirectory);
    if (indexText === null) {
      return contextDecision(MODULE_ID, `OKF is enabled for this repo but there is no bundle at \`${bundleRelativePath}/index.md\`. If the person wants one, create it with /ai1:okf-maintain-knowledge (produce mode).`);
    }
    recordSessionBaseHead(hookInput, projectRoot, environment);
    const specVersion = readBundleSpecVersion(indexText);
    const visibleIndex = indexText.length > MAX_INDEX_CHARACTERS
      ? `${indexText.slice(0, MAX_INDEX_CHARACTERS)}\n[... index truncated; read ${bundleRelativePath}/index.md]`
      : indexText;
    return contextDecision(MODULE_ID, [
      `This repo keeps its knowledge in an OKF bundle at \`${bundleRelativePath}/\` (spec ${specVersion || 'unknown'}). READ IT BEFORE touching code: start from the index below and follow the links relevant to the task.`,
      'After a change that affects a documented asset (service, API, schema, feature, decision):',
      ...buildMaintenanceRules(bundleRelativePath, specVersion).map((maintenanceRule) => `- ${maintenanceRule}`),
      ...buildBundleHealthNotes(projectRoot, bundleDirectory, bundleRelativePath),
      '',
      `--- ${bundleRelativePath}/index.md ---`,
      visibleIndex,
    ].join('\n'));
  },
};

// Signs that the index or the overview no longer describe the bundle: concepts changed after the
// overview was last committed, and concepts no index.md links to.
function buildBundleHealthNotes(projectRoot, bundleDirectory, bundleRelativePath) {
  const healthNotes = [];
  const listPaths = (conceptPaths) => [
    ...conceptPaths.slice(0, MAX_LISTED_CONCEPTS).map((conceptPath) => `  - ${conceptPath}`),
    ...(conceptPaths.length > MAX_LISTED_CONCEPTS ? [`  - ... and ${conceptPaths.length - MAX_LISTED_CONCEPTS} more`] : []),
  ];
  const overviewPath = `${bundleRelativePath}/${overviewFileName(bundleDirectory)}`;
  const conceptsChangedSinceOverview = listConceptsChangedSinceOverview(projectRoot, bundleRelativePath);
  if (conceptsChangedSinceOverview.length) {
    healthNotes.push('', `These concepts changed in commits after the last one that touched \`${overviewPath}\`, so the overview may not describe them yet. Read them before trusting the overview and, if the task touches them, bring the overview up to date:`);
    healthNotes.push(...listPaths(conceptsChangedSinceOverview));
  }
  const conceptsMissingFromIndex = listConceptsMissingFromIndex(bundleDirectory);
  if (conceptsMissingFromIndex.length) {
    healthNotes.push('', 'These concepts are not linked from any index.md of the bundle (nobody finds them from the index); link each one from the index.md of its folder when you next edit the bundle:');
    healthNotes.push(...listPaths(conceptsMissingFromIndex.map((conceptPath) => `${bundleRelativePath}/${conceptPath}`)));
  }
  return healthNotes;
}
