// proposals-upkeep (Stop, feature `proposals`): when this session touched .ai1/proposals/, stops the agent from
// finishing while the proposal folder is inconsistent (the same checks as `ai1 proposals check`: frontmatter,
// numbering, decided dates, an outdated index, an accepted proposal that no bundle concept cites). Also
// reminds to mark an accepted proposal implemented when a deep-lane plan built from it (`proposal: <number>`
// in its frontmatter) was finished in this session.
// Each set of problems is reported once, and at most a few times per session (never loops).

import { readFileSync } from 'node:fs';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { splitFrontmatter, readFrontmatterField } from '../core/frontmatter.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, claimStopBlock } from '../core/session-state.mjs';
import { listWorkPlans } from '../lanes/lanes-work.mjs';
import { checkProposals, listProposals, findProposal, resolveCitingBundle, resolveKnowledgePath, PROPOSALS_DIRECTORY } from './proposals-documents.mjs';

const MODULE_ID = 'proposals-upkeep';
const MAX_BLOCKS_PER_SESSION = 3;
const MAX_LISTED_PROBLEMS = 15;

// Accepted proposals whose deep-lane plan (`proposal: <number>`) was marked done in this session.
export function listBuiltProposalReminders(sharedRoot, proposalDocuments, sessionStartMilliseconds) {
  return listWorkPlans(sharedRoot)
    .filter((workPlan) => workPlan.status === 'done' && workPlan.modifiedMilliseconds >= sessionStartMilliseconds)
    .flatMap((workPlan) => {
      const proposalNumber = readFrontmatterField(splitFrontmatter(readFileSync(workPlan.planPath, 'utf8')).frontmatterText, 'proposal');
      const builtProposal = proposalNumber ? findProposal(proposalDocuments, proposalNumber) : null;
      if (!builtProposal || builtProposal.status !== 'accepted') return [];
      return [`${builtProposal.relativePath}: the plan \`${workPlan.relativePath}\` built from it is done; if the proposal is fully built, run \`ai1 proposals set ${builtProposal.fileNumber} implemented\` and check its mechanisms are documented in the bundle`];
    });
}

export function buildProposalUpkeepReminder(proposalProblems) {
  return [
    `Proposals: ${PROPOSALS_DIRECTORY}/ needs attention before finishing:`,
    ...proposalProblems.slice(0, MAX_LISTED_PROBLEMS).map((proposalProblem) => `  - ${proposalProblem}`),
    ...(proposalProblems.length > MAX_LISTED_PROBLEMS ? [`  - ... and ${proposalProblems.length - MAX_LISTED_PROBLEMS} more (run \`ai1 proposals check\`)`] : []),
    'Fix them (the /ai1:proposals-write skill says how), or say in one line why not and finish.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'proposals',
  description: 'When the session touched .ai1/proposals/, checks the proposals are consistent and that accepted ones are carried to the bundle; reminds to mark a proposal implemented when its plan is done.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const proposalDocuments = listProposals(projectRoot);
    // Plans live in the main checkout (shared root), the proposals in the checkout being worked on.
    const builtProposalReminders = listBuiltProposalReminders(sharedRoot, proposalDocuments, sessionBase.sessionStartMilliseconds);
    const proposalsTouched = listFilesChangedSinceBase(projectRoot, sessionBase.baseHead).some((changedPath) => changedPath.startsWith(`${PROPOSALS_DIRECTORY}/`));
    if (!proposalsTouched && !builtProposalReminders.length) return allowDecision();

    const proposalProblems = [
      ...(proposalsTouched ? checkProposals(projectRoot, { knowledgePath: resolveKnowledgePath(config), bundleDirectory: resolveCitingBundle(projectRoot, config) }) : []),
      ...builtProposalReminders,
    ];
    if (!proposalProblems.length) return allowDecision();
    const checkedPath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'proposals-checked');
    if (!claimStopBlock(checkedPath, proposalProblems.join('\n'), MAX_BLOCKS_PER_SESSION)) return allowDecision();
    return blockDecision(MODULE_ID, buildProposalUpkeepReminder(proposalProblems));
  },
};
