// later-upkeep (Stop, feature `later`): when this session touched .ai1/later/, stops the agent from
// finishing while the folder is inconsistent (the same checks as `ai1 later check`: frontmatter,
// numbering, decided dates, an outdated index, an accepted entry that no bundle concept cites). Also
// reminds to mark an accepted entry implemented when a deep-lane plan built from it (`later: <number>`
// in its frontmatter) was finished in this session.
// Each set of problems is reported once, and at most a few times per session (never loops).

import { readFileSync } from 'node:fs';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { splitFrontmatter, readFrontmatterField } from '../core/frontmatter.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, claimStopBlock } from '../core/session-state.mjs';
import { listWorkPlans } from '../lanes/lanes-work.mjs';
import { checkLaterEntries, listLaterEntries, findLaterEntry, resolveCitingBundle, resolveKnowledgePath, LATER_DIRECTORY } from './later-documents.mjs';

const MODULE_ID = 'later-upkeep';
const MAX_BLOCKS_PER_SESSION = 3;
const MAX_LISTED_PROBLEMS = 15;

// Accepted later entries whose deep-lane plan (`later: <number>`) was marked done in this session.
export function listBuiltLaterReminders(sharedRoot, laterEntries, sessionStartMilliseconds) {
  return listWorkPlans(sharedRoot)
    .filter((workPlan) => workPlan.status === 'done' && workPlan.modifiedMilliseconds >= sessionStartMilliseconds)
    .flatMap((workPlan) => {
      const entryNumber = readFrontmatterField(splitFrontmatter(readFileSync(workPlan.planPath, 'utf8')).frontmatterText, 'later');
      const builtEntry = entryNumber ? findLaterEntry(laterEntries, entryNumber) : null;
      if (!builtEntry || builtEntry.status !== 'accepted') return [];
      return [`${builtEntry.relativePath}: the plan \`${workPlan.relativePath}\` built from it is done; if the entry is fully built, run \`ai1 later set ${builtEntry.fileNumber} implemented\` and check its mechanisms are documented in the bundle`];
    });
}

export function buildLaterUpkeepReminder(laterProblems) {
  return [
    `Later: ${LATER_DIRECTORY}/ needs attention before finishing:`,
    ...laterProblems.slice(0, MAX_LISTED_PROBLEMS).map((laterProblem) => `  - ${laterProblem}`),
    ...(laterProblems.length > MAX_LISTED_PROBLEMS ? [`  - ... and ${laterProblems.length - MAX_LISTED_PROBLEMS} more (run \`ai1 later check\`)`] : []),
    'Fix them (the /ai1:later-write skill says how), or say in one line why not and finish.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'later',
  description: 'When the session touched .ai1/later/, checks the later entries are consistent and that accepted ones are carried to the bundle; reminds to mark an entry implemented when its plan is done.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const laterEntries = listLaterEntries(projectRoot);
    // Plans live in the main checkout (shared root), the later entries in the checkout being worked on.
    const builtEntryReminders = listBuiltLaterReminders(sharedRoot, laterEntries, sessionBase.sessionStartMilliseconds);
    const laterTouched = listFilesChangedSinceBase(projectRoot, sessionBase.baseHead).some((changedPath) => changedPath.startsWith(`${LATER_DIRECTORY}/`));
    if (!laterTouched && !builtEntryReminders.length) return allowDecision();

    const laterProblems = [
      ...(laterTouched ? checkLaterEntries(projectRoot, { knowledgePath: resolveKnowledgePath(config), bundleDirectory: resolveCitingBundle(projectRoot, config) }) : []),
      ...builtEntryReminders,
    ];
    if (!laterProblems.length) return allowDecision();
    const checkedPath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'later-checked');
    if (!claimStopBlock(checkedPath, laterProblems.join('\n'), MAX_BLOCKS_PER_SESSION)) return allowDecision();
    return blockDecision(MODULE_ID, buildLaterUpkeepReminder(laterProblems));
  },
};
