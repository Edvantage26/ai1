// okf-index (SessionStart, feature `okf`): puts the bundle's index.md in the agent's context with
// the maintenance rules and the concepts the overview or the indexes miss, and records the HEAD at session start so okf-upkeep can tell which files
// this session changed.

import { contextDecision } from '../core/hook-io.mjs';
import { contextList } from '../core/context-list.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';
import {
  resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, buildMaintenanceRules, overviewFileName,
  listConceptsChangedSinceOverview, listConceptsMissingFromIndex,
} from './okf-bundle.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { describeBundleLocation, resolveRelatedEntries } from './okf-related.mjs';

const MODULE_ID = 'okf-index';
// Under the 9,500 characters all session-start texts share (MAX_FIELD_CHARACTERS in core/hook-io.mjs),
// so a long index is cut here, with the pointer to index.md, before the generic cut. The index is a map
// (its first lines matter most); okf-recall and okf-file-context bring the concepts on demand.
const MAX_INDEX_CHARACTERS = 3000;
const MAX_LISTED_CONCEPTS = 3;

// The related repositories of .ai1/config.json, with where each one's knowledge is on this machine.
export function buildRelatedParts(projectRoot, relatedEntries = []) {
  if (!relatedEntries.length) return [];
  return [
    '',
    'Related repositories (`related` in .ai1/config.json), each with its own knowledge: read it before changing what depends on it:',
    contextList(resolveRelatedEntries(projectRoot, relatedEntries).map((resolvedEntry) => {
      const { entry } = resolvedEntry;
      const detailText = [entry.branch ? `branch \`${entry.branch}\`` : null, entry.owns?.length ? `owns: ${entry.owns.join('; ')}` : null].filter(Boolean).join(', ');
      return `- ${entry.name}${detailText ? ` (${detailText})` : ''}: ${describeBundleLocation(projectRoot, resolvedEntry)}`;
    }), (leftOutCount) => `- ... and ${leftOutCount} more under \`related\` in .ai1/config.json`),
  ];
}

// The index as lines that can be left out from the end: its first lines (the map's top) matter most.
function buildIndexList(indexText, bundleRelativePath) {
  const indexLines = indexText.split('\n');
  let shownLines = 0;
  let shownLength = 0;
  while (shownLines < indexLines.length && shownLength + indexLines[shownLines].length + 1 <= MAX_INDEX_CHARACTERS) {
    shownLength += indexLines[shownLines].length + 1;
    shownLines += 1;
  }
  return contextList(indexLines, (leftOutCount) => `[... ${leftOutCount} more lines of the index; read ${bundleRelativePath}/index.md]`, { shownAtMost: Math.max(1, shownLines) });
}

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
    return contextDecision(MODULE_ID, [
      `This repo keeps its knowledge in an OKF bundle at \`${bundleRelativePath}/\` (spec ${specVersion || 'unknown'}). READ IT BEFORE touching code: start from the index below and follow the links relevant to the task.`,
      'After a change that affects a documented asset (service, API, schema, feature, decision):',
      ...buildMaintenanceRules(bundleRelativePath, specVersion).map((maintenanceRule) => `- ${maintenanceRule}`),
      ...buildBundleHealthNotes(projectRoot, bundleDirectory, bundleRelativePath),
      ...buildRelatedParts(projectRoot, config?.related),
      '',
      `--- ${bundleRelativePath}/index.md ---`,
      buildIndexList(indexText, bundleRelativePath),
    ]);
  },
};

// Signs that the index or the overview no longer describe the bundle: concepts changed after the
// overview was last committed, and concepts no index.md links to.
function buildBundleHealthNotes(projectRoot, bundleDirectory, bundleRelativePath) {
  const healthNotes = [];
  const listPaths = (conceptPaths, whereAll) => [contextList(conceptPaths.map((conceptPath) => `  - ${conceptPath}`),
    (leftOutCount) => `  - ... and ${leftOutCount} more (${whereAll})`, { shownAtMost: MAX_LISTED_CONCEPTS })];
  const overviewPath = `${bundleRelativePath}/${overviewFileName(bundleDirectory)}`;
  const conceptsChangedSinceOverview = listConceptsChangedSinceOverview(projectRoot, bundleRelativePath);
  if (conceptsChangedSinceOverview.length) {
    healthNotes.push('', `Changed after the last commit that touched \`${overviewPath}\` (the overview may not describe them yet; if the task touches them, update the overview):`);
    healthNotes.push(...listPaths(conceptsChangedSinceOverview, `\`git log --name-only\` of ${bundleRelativePath}/ since the overview's last commit lists them`));
  }
  const conceptsMissingFromIndex = listConceptsMissingFromIndex(bundleDirectory);
  if (conceptsMissingFromIndex.length) {
    healthNotes.push('', 'Not linked from any index.md (link each from its folder\'s index.md when you next edit the bundle):');
    healthNotes.push(...listPaths(conceptsMissingFromIndex.map((conceptPath) => `${bundleRelativePath}/${conceptPath}`), 'the concept files no index.md links to'));
  }
  return healthNotes;
}
