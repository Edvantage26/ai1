// okf-index (SessionStart, feature `okf`): puts the bundle's index.md in the agent's context with
// the maintenance rules, and records the HEAD at session start so okf-upkeep can tell which files
// this session changed.

import { contextDecision } from '../core/hook-io.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';
import { resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, buildMaintenanceRules } from './okf-bundle.mjs';

const MODULE_ID = 'okf-index';
const MAX_INDEX_CHARACTERS = 12000;

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'okf',
  description: 'Loads the OKF bundle index and its maintenance rules at session start.',
  run({ hookInput, config, projectRoot, environment }) {
    const bundleRelativePath = config.knowledge || '.okf';
    const indexText = readBundleIndex(resolveBundleDirectory(projectRoot, config));
    if (indexText === null) {
      return contextDecision(MODULE_ID, `OKF is enabled for this repo but there is no bundle at \`${bundleRelativePath}/index.md\`. If the person wants one, create it with /jig:okf (produce mode).`);
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
      '',
      `--- ${bundleRelativePath}/index.md ---`,
      visibleIndex,
    ].join('\n'));
  },
};
