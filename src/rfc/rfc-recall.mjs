// rfc-recall (UserPromptSubmit, feature `rfc`): on every message from the person, finds the RFCs
// related to it, so "let's pick up the prod guard idea" brings back the proposal written months ago.
// Same keyword scoring as okf-recall; every hit is labelled with its status, because a proposal is
// not a fact.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { buildKeywordCatalog, rankConceptsForPrompt } from '../okf/okf-recall.mjs';
import { listRfcs, describeRfcStatus, padRfcNumber } from './rfc-documents.mjs';

const MODULE_ID = 'rfc-recall';

export function rankRfcsForPrompt(promptText, rfcDocuments) {
  const rfcByPath = new Map(rfcDocuments.map((rfcDocument) => [rfcDocument.relativePath, rfcDocument]));
  const rfcCatalog = buildKeywordCatalog(rfcDocuments.map((rfcDocument) => ({
    relativePath: rfcDocument.relativePath,
    title: rfcDocument.title,
    description: '',
    tags: '',
    bodyText: rfcDocument.bodyText,
  })));
  return rankConceptsForPrompt(promptText, rfcCatalog).map((rankedEntry) => rfcByPath.get(rankedEntry.relativePath));
}

export function buildRfcRecallText(rankedRfcs) {
  return [
    'RFCs related to this request. They are proposals: only an accepted or implemented RFC reflects a decision. Read the relevant ones before answering:',
    ...rankedRfcs.map((rfcDocument) => `- ${rfcDocument.relativePath} — RFC ${padRfcNumber(rfcDocument.fileNumber)} "${rfcDocument.title || rfcDocument.slug}" (${rfcDocument.size}, ${describeRfcStatus(rfcDocument)})`),
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'rfc',
  description: 'On every message, points the agent to the RFCs related to it, labelled with their status.',
  run({ hookInput, projectRoot }) {
    const promptText = hookInput.prompt;
    if (typeof promptText !== 'string' || promptText.trim().startsWith('/')) return allowDecision();
    const rfcDocuments = listRfcs(projectRoot);
    if (!rfcDocuments.length) return allowDecision();
    const rankedRfcs = rankRfcsForPrompt(promptText, rfcDocuments);
    return rankedRfcs.length ? contextDecision(MODULE_ID, buildRfcRecallText(rankedRfcs)) : allowDecision();
  },
};
