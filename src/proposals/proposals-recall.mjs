// proposals-recall (UserPromptSubmit, feature `proposals`): on every message from the person, finds the proposals
// related to it, so "let's pick up the prod guard idea" brings back the proposal written months ago.
// Same keyword scoring as okf-recall; every hit is labelled with its status, because a proposal is
// not a fact.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { buildKeywordCatalog, rankConceptsForPrompt } from '../okf/okf-recall.mjs';
import { listProposals, describeProposalStatus, padProposalNumber } from './proposals-documents.mjs';

const MODULE_ID = 'proposals-recall';

export function rankProposalsForPrompt(promptText, proposalDocuments) {
  const proposalByPath = new Map(proposalDocuments.map((proposalDocument) => [proposalDocument.relativePath, proposalDocument]));
  const proposalCatalog = buildKeywordCatalog(proposalDocuments.map((proposalDocument) => ({
    relativePath: proposalDocument.relativePath,
    title: proposalDocument.title,
    description: '',
    tags: '',
    bodyText: proposalDocument.bodyText,
  })));
  return rankConceptsForPrompt(promptText, proposalCatalog).map((rankedEntry) => proposalByPath.get(rankedEntry.relativePath));
}

export function buildProposalRecallText(rankedProposals) {
  return [
    'Proposals related to this request. They are not decided: only an accepted or implemented proposal reflects a decision. Read the relevant ones before answering:',
    ...rankedProposals.map((proposalDocument) => `- ${proposalDocument.relativePath} — Proposal ${padProposalNumber(proposalDocument.fileNumber)} "${proposalDocument.title || proposalDocument.slug}" (${proposalDocument.size}, ${describeProposalStatus(proposalDocument)})`),
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'proposals',
  description: 'On every message, points the agent to the proposals related to it, labelled with their status.',
  run({ hookInput, projectRoot }) {
    const promptText = hookInput.prompt;
    if (typeof promptText !== 'string' || promptText.trim().startsWith('/')) return allowDecision();
    const proposalDocuments = listProposals(projectRoot);
    if (!proposalDocuments.length) return allowDecision();
    const rankedProposals = rankProposalsForPrompt(promptText, proposalDocuments);
    return rankedProposals.length ? contextDecision(MODULE_ID, buildProposalRecallText(rankedProposals)) : allowDecision();
  },
};
