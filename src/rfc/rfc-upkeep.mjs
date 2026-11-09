// rfc-upkeep (Stop, feature `rfc`): when this session touched .ai1/rfc/, stops the agent from
// finishing while the RFC folder is inconsistent (the same checks as `ai1 rfc check`: frontmatter,
// numbering, decided dates, an outdated index, an accepted RFC that no bundle concept cites). Also
// reminds to mark an accepted RFC implemented when a deep-lane plan built from it (`rfc: <number>`
// in its frontmatter) was finished in this session.
// Each set of problems is reported once, and at most a few times per session (never loops).

import { readFileSync } from 'node:fs';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { splitFrontmatter, readFrontmatterField } from '../core/frontmatter.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, claimStopBlock } from '../core/session-state.mjs';
import { listWorkPlans } from '../lanes/lanes-work.mjs';
import { checkRfcs, listRfcs, findRfc, resolveCitingBundle, resolveKnowledgePath, RFC_DIRECTORY } from './rfc-documents.mjs';

const MODULE_ID = 'rfc-upkeep';
const MAX_BLOCKS_PER_SESSION = 3;
const MAX_LISTED_PROBLEMS = 15;

// Accepted RFCs whose deep-lane plan (`rfc: <number>`) was marked done in this session.
export function listBuiltRfcReminders(sharedRoot, rfcDocuments, sessionStartMilliseconds) {
  return listWorkPlans(sharedRoot)
    .filter((workPlan) => workPlan.status === 'done' && workPlan.modifiedMilliseconds >= sessionStartMilliseconds)
    .flatMap((workPlan) => {
      const rfcNumber = readFrontmatterField(splitFrontmatter(readFileSync(workPlan.planPath, 'utf8')).frontmatterText, 'rfc');
      const builtRfc = rfcNumber ? findRfc(rfcDocuments, rfcNumber) : null;
      if (!builtRfc || builtRfc.status !== 'accepted') return [];
      return [`${builtRfc.relativePath}: the plan \`${workPlan.relativePath}\` built from it is done; if the RFC is fully built, run \`ai1 rfc set ${builtRfc.fileNumber} implemented\` and check its mechanisms are documented in the bundle`];
    });
}

export function buildRfcUpkeepReminder(rfcProblems) {
  return [
    `RFCs: ${RFC_DIRECTORY}/ needs attention before finishing:`,
    ...rfcProblems.slice(0, MAX_LISTED_PROBLEMS).map((rfcProblem) => `  - ${rfcProblem}`),
    ...(rfcProblems.length > MAX_LISTED_PROBLEMS ? [`  - ... and ${rfcProblems.length - MAX_LISTED_PROBLEMS} more (run \`ai1 rfc check\`)`] : []),
    'Fix them (the /ai1:rfc-write-proposal skill says how), or say in one line why not and finish.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'rfc',
  description: 'When the session touched .ai1/rfc/, checks the RFCs are consistent and that accepted ones are carried to the bundle; reminds to mark an RFC implemented when its plan is done.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const rfcDocuments = listRfcs(projectRoot);
    // Plans live in the main checkout (shared root), the RFCs in the checkout being worked on.
    const builtRfcReminders = listBuiltRfcReminders(sharedRoot, rfcDocuments, sessionBase.sessionStartMilliseconds);
    const rfcsTouched = listFilesChangedSinceBase(projectRoot, sessionBase.baseHead).some((changedPath) => changedPath.startsWith(`${RFC_DIRECTORY}/`));
    if (!rfcsTouched && !builtRfcReminders.length) return allowDecision();

    const rfcProblems = [
      ...(rfcsTouched ? checkRfcs(projectRoot, { knowledgePath: resolveKnowledgePath(config), bundleDirectory: resolveCitingBundle(projectRoot, config) }) : []),
      ...builtRfcReminders,
    ];
    if (!rfcProblems.length) return allowDecision();
    const checkedPath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'rfc-checked');
    if (!claimStopBlock(checkedPath, rfcProblems.join('\n'), MAX_BLOCKS_PER_SESSION)) return allowDecision();
    return blockDecision(MODULE_ID, buildRfcUpkeepReminder(rfcProblems));
  },
};
