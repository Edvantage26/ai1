// later-recall (UserPromptSubmit, feature `later`): on every message from the person, finds the later
// entries related to it, so "let's pick up the prod guard idea" brings back the entry noted down months
// ago. Same keyword scoring as okf-recall; every hit is labelled with its status, because a later entry
// is not a fact.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { buildKeywordCatalog, rankConceptsForPrompt } from '../okf/okf-recall.mjs';
import { listLaterEntries, describeLaterEntryStatus, padEntryNumber } from './later-documents.mjs';

const MODULE_ID = 'later-recall';

export function rankLaterEntriesForPrompt(promptText, laterEntries) {
  const entryByPath = new Map(laterEntries.map((laterEntry) => [laterEntry.relativePath, laterEntry]));
  const entryCatalog = buildKeywordCatalog(laterEntries.map((laterEntry) => ({
    relativePath: laterEntry.relativePath,
    title: laterEntry.title,
    description: '',
    tags: '',
    bodyText: laterEntry.bodyText,
  })));
  return rankConceptsForPrompt(promptText, entryCatalog).map((rankedEntry) => entryByPath.get(rankedEntry.relativePath));
}

export function buildLaterRecallText(rankedEntries) {
  return [
    'Later entries related to this request. They are not decided: only an accepted or implemented entry reflects a decision. Read the relevant ones before answering:',
    ...rankedEntries.map((laterEntry) => `- ${laterEntry.relativePath} — Later ${padEntryNumber(laterEntry.fileNumber)} "${laterEntry.title || laterEntry.slug}" (${laterEntry.size}, ${describeLaterEntryStatus(laterEntry)})`),
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'later',
  description: 'On every message, points the agent to the later entries related to it, labelled with their status.',
  run({ hookInput, projectRoot }) {
    const promptText = hookInput.prompt;
    if (typeof promptText !== 'string' || promptText.trim().startsWith('/')) return allowDecision();
    const laterEntries = listLaterEntries(projectRoot);
    if (!laterEntries.length) return allowDecision();
    const rankedEntries = rankLaterEntriesForPrompt(promptText, laterEntries);
    return rankedEntries.length ? contextDecision(MODULE_ID, buildLaterRecallText(rankedEntries)) : allowDecision();
  },
};
