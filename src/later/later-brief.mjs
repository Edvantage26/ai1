// later-brief (SessionStart, feature `later`): tells the agent where undecided changes are noted down
// for later and that they are not the system, so a future feature the person mentions is noted down
// instead of being lost or written into the knowledge bundle as if it were real; that later is only on
// demand (never offered, a yes to a reply is never a request for it); that "propuesta"
// or "proposal" in the conversation is the agent's own proposal, not this feature; and lists the open entries.
// The text only changes when the entries change, so it does not break the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { contextList, shortenListTitle } from '../core/context-list.mjs';
import { listLaterEntries, resolveKnowledgePath, OPEN_LATER_STATUSES, LATER_DIRECTORY, LATER_INDEX_FILE, padEntryNumber } from './later-documents.mjs';

const MODULE_ID = 'later-brief';
// The list is a reminder that they exist; later-recall brings the related ones on each message.
const MAX_LISTED_LATER_ENTRIES = 3;

export function buildLaterRecipe(knowledgePath) {
  const bundleText = knowledgePath ? `the knowledge bundle (\`${knowledgePath}/\`)` : 'the project documentation';
  return [
    `Later: large changes and future features that are not decided yet are noted down for later in \`${LATER_DIRECTORY}/\` (called by number, "later 0003").`,
    `- A later entry is not the system: never describe its design in ${bundleText} as if it were real; only what is decided or built goes there.`,
    '- "Propuesta", "proposal", "proponme algo", "acepto la propuesta" in the conversation mean your own proposal in this conversation (answer it, or build it by its size), never this feature.',
    '- Later is only on demand: an entry is created only when the person explicitly asks for it, in their own words ("apúntalo para luego", "anótalo en later", "apárcalo"). Never offer it, recommend it or mention it as an option, never note one down on your own, never as a step or "next step" inside a larger reply. A "sí", "adelante" or "ok" to a reply is never a request for it.',
    '- The subject the person is talking about is never offered for fork, however large, nor its ideas, follow-ups or next steps: the default is to build it now, so close with its size and offer to do it here (a deep one starts with its design). When a clearly different and large subject comes up (a new feature unrelated to the task at hand), mention it in one line at the end of your report with the way you recommend: do it here or fork it into a new conversation (/ai1:session-fork-conversation); do not stop to ask. A small fix you found on the way is done here without asking. To note one down when asked, or to accept, reject or resume one the person names by number, load /ai1:later-write.',
  ].join('\n');
}

// Parts for contextDecision: the open entries as a list that can lose items.
export function describeOpenLaterEntries(laterEntries) {
  const openEntries = laterEntries.filter((laterEntry) => OPEN_LATER_STATUSES.has(laterEntry.status));
  if (!openEntries.length) return [];
  return [
    'Open later entries (not facts, unless accepted):',
    contextList(openEntries.map((laterEntry) => `- ${padEntryNumber(laterEntry.fileNumber)} "${shortenListTitle(laterEntry.title || laterEntry.slug)}" (${laterEntry.size}, ${laterEntry.status})`),
      (leftOutCount) => `- ... and ${leftOutCount} more in \`${LATER_DIRECTORY}/${LATER_INDEX_FILE}\``, { shownAtMost: MAX_LISTED_LATER_ENTRIES }),
  ];
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'later',
  description: 'Tells the agent where undecided changes are noted down for later, when to note one down, and lists the open ones at session start.',
  run({ hookInput, config, projectRoot }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    const openEntryParts = describeOpenLaterEntries(listLaterEntries(projectRoot));
    return contextDecision(MODULE_ID, [buildLaterRecipe(resolveKnowledgePath(config)), ...(openEntryParts.length ? ['', ...openEntryParts] : [])]);
  },
};
