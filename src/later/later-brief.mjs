// later-brief (SessionStart, feature `later`): tells the agent where undecided changes are noted down
// for later and that they are not the system, so a future feature the person mentions is noted down
// instead of being lost or written into the knowledge bundle as if it were real; that "propuesta" or
// "proposal" in the conversation is the agent's own proposal, not this feature; and lists the open entries.
// The text only changes when the entries change, so it does not break the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listLaterEntries, resolveKnowledgePath, OPEN_LATER_STATUSES, LATER_DIRECTORY, LATER_INDEX_FILE, padEntryNumber } from './later-documents.mjs';

const MODULE_ID = 'later-brief';
const MAX_LISTED_LATER_ENTRIES = 15;

export function buildLaterRecipe(knowledgePath) {
  const bundleText = knowledgePath ? `the knowledge bundle (\`${knowledgePath}/\`)` : 'the project documentation';
  return [
    `Later: large changes and future features that are not decided yet are noted down for later in \`${LATER_DIRECTORY}/\` (one file each, called by its number, "later 0003"; index in \`${LATER_DIRECTORY}/${LATER_INDEX_FILE}\`).`,
    `- A later entry is not the system: never describe its design in ${bundleText} as if it were real; only what is decided or built goes there.`,
    '- "Propuesta", "proposal", "proponme algo", "acepto la propuesta" in the conversation mean your own proposal in this conversation (answer it, or build it by its lane), never this feature.',
    '- Never note one down on your own. Do it when the person asks ("apúntalo para luego", "déjalo para más adelante", "apárcalo"). When, while working on one subject, a clearly different and large one comes up (a new feature unrelated to the task at hand), mention it in one line at the end of your report with the way you recommend: do it here, fork it into a new conversation (/ai1:session-fork-conversation) or note it down for later ("Otro tema: X. Recomiendo apuntarlo para luego."); do not stop to ask, and a yes means the way you recommended. A small fix you found on the way is done here without asking. Never offer for details, steps or follow-ups of the current subject. To note one down or to accept, reject or resume one the person names by number, load /ai1:later-write.',
    '- Create and change entries with `ai1 later new` and `ai1 later set`; never number, rename or index them by hand.',
  ].join('\n');
}

export function describeOpenLaterEntries(laterEntries) {
  const openEntries = laterEntries.filter((laterEntry) => OPEN_LATER_STATUSES.has(laterEntry.status));
  if (!openEntries.length) return '';
  const entryLines = ['Open later entries (not facts, unless accepted):'];
  entryLines.push(...openEntries.slice(0, MAX_LISTED_LATER_ENTRIES).map((laterEntry) => `- ${padEntryNumber(laterEntry.fileNumber)} "${laterEntry.title || laterEntry.slug}" (${laterEntry.size}, ${laterEntry.status}): \`${laterEntry.relativePath}\``));
  if (openEntries.length > MAX_LISTED_LATER_ENTRIES) entryLines.push(`- ... and ${openEntries.length - MAX_LISTED_LATER_ENTRIES} more in \`${LATER_DIRECTORY}/${LATER_INDEX_FILE}\``);
  return entryLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'later',
  description: 'Tells the agent where undecided changes are noted down for later, when to note one down, and lists the open ones at session start.',
  run({ hookInput, config, projectRoot }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    const openEntriesText = describeOpenLaterEntries(listLaterEntries(projectRoot));
    return contextDecision(MODULE_ID, [buildLaterRecipe(resolveKnowledgePath(config)), openEntriesText].filter(Boolean).join('\n\n'));
  },
};
