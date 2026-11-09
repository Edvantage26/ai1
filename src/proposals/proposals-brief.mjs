// proposals-brief (SessionStart, feature `proposals`): tells the agent where proposals live and that they are not
// the system, so a future feature the person mentions is saved as a proposal instead of being lost or
// written into the knowledge bundle as if it were real; and lists the proposals still open.
// The text only changes when the proposals change, so it does not break the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listProposals, resolveKnowledgePath, OPEN_PROPOSAL_STATUSES, PROPOSALS_DIRECTORY, PROPOSALS_INDEX_FILE, padProposalNumber } from './proposals-documents.mjs';

const MODULE_ID = 'proposals-brief';
const MAX_LISTED_PROPOSALS = 15;

export function buildProposalRecipe(knowledgePath) {
  const bundleText = knowledgePath ? `the knowledge bundle (\`${knowledgePath}/\`)` : 'the project documentation';
  return [
    `Proposals: large changes and future features that are not decided yet live in \`${PROPOSALS_DIRECTORY}/\` (one file each, index in \`${PROPOSALS_DIRECTORY}/${PROPOSALS_INDEX_FILE}\`).`,
    `- A proposal is not the system: never describe a proposed design in ${bundleText} as if it were real; only what is decided or built goes there.`,
    '- Never create a proposal on your own. Create one when the person asks for it. When, while working on one subject, a clearly different one comes up (a new feature or change unrelated to the task at hand), offer in one line three ways and let the person choose: do it here, in this conversation; fork it into a new conversation (/ai1:session-fork-conversation); or save it as a proposal for later ("Esto es otro tema: ¿lo hacemos aquí, lo abro en un fork o lo guardo como propuesta?"). Act only on the way the person picks; a yes to a question that bundles several things is not a pick. Never offer for details, steps or follow-ups of the current subject. For a proposal, load /ai1:proposals-write.',
    '- Create and change proposals with `ai1 proposals new` and `ai1 proposals set`; never number, rename or index them by hand.',
  ].join('\n');
}

export function describeOpenProposals(proposalDocuments) {
  const openProposals = proposalDocuments.filter((proposalDocument) => OPEN_PROPOSAL_STATUSES.has(proposalDocument.status));
  if (!openProposals.length) return '';
  const proposalLines = ['Open proposals (not facts, unless accepted):'];
  proposalLines.push(...openProposals.slice(0, MAX_LISTED_PROPOSALS).map((proposalDocument) => `- ${padProposalNumber(proposalDocument.fileNumber)} "${proposalDocument.title || proposalDocument.slug}" (${proposalDocument.size}, ${proposalDocument.status}): \`${proposalDocument.relativePath}\``));
  if (openProposals.length > MAX_LISTED_PROPOSALS) proposalLines.push(`- ... and ${openProposals.length - MAX_LISTED_PROPOSALS} more in \`${PROPOSALS_DIRECTORY}/${PROPOSALS_INDEX_FILE}\``);
  return proposalLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'proposals',
  description: 'Tells the agent where proposals (undecided changes) live, when to create one, and lists the open ones at session start.',
  run({ hookInput, config, projectRoot }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    const openProposalsText = describeOpenProposals(listProposals(projectRoot));
    return contextDecision(MODULE_ID, [buildProposalRecipe(resolveKnowledgePath(config)), openProposalsText].filter(Boolean).join('\n\n'));
  },
};
