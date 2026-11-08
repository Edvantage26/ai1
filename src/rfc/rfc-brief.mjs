// rfc-brief (SessionStart, feature `rfc`): tells the agent where proposals live and that they are not
// the system, so a future feature the person mentions is saved as an RFC instead of being lost or
// written into the knowledge bundle as if it were real; and lists the RFCs still open.
// The text only changes when the RFCs change, so it does not break the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listRfcs, resolveKnowledgePath, OPEN_RFC_STATUSES, RFC_DIRECTORY, RFC_INDEX_FILE, padRfcNumber } from './rfc-documents.mjs';

const MODULE_ID = 'rfc-brief';
const MAX_LISTED_RFCS = 15;

export function buildRfcRecipe(knowledgePath) {
  const bundleText = knowledgePath ? `the knowledge bundle (\`${knowledgePath}/\`)` : 'the project documentation';
  return [
    `RFCs: proposals for large changes and future features that are not decided yet live in \`${RFC_DIRECTORY}/\` (one file each, index in \`${RFC_DIRECTORY}/${RFC_INDEX_FILE}\`).`,
    `- A proposal is not the system: never describe a proposed design in ${bundleText} as if it were real; only what is decided or built goes there.`,
    '- When the person wants to save a future feature, an idea or a proposal for later, or asks for an RFC, load /ai1:rfc-write-proposal.',
    '- Create and change RFCs with `ai1 rfc new` and `ai1 rfc set`; never number, rename or index them by hand.',
  ].join('\n');
}

export function describeOpenRfcs(rfcDocuments) {
  const openRfcs = rfcDocuments.filter((rfcDocument) => OPEN_RFC_STATUSES.has(rfcDocument.status));
  if (!openRfcs.length) return '';
  const rfcLines = ['Open RFCs (proposals, not facts, unless accepted):'];
  rfcLines.push(...openRfcs.slice(0, MAX_LISTED_RFCS).map((rfcDocument) => `- ${padRfcNumber(rfcDocument.fileNumber)} "${rfcDocument.title || rfcDocument.slug}" (${rfcDocument.size}, ${rfcDocument.status}): \`${rfcDocument.relativePath}\``));
  if (openRfcs.length > MAX_LISTED_RFCS) rfcLines.push(`- ... and ${openRfcs.length - MAX_LISTED_RFCS} more in \`${RFC_DIRECTORY}/${RFC_INDEX_FILE}\``);
  return rfcLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'rfc',
  description: 'Tells the agent where RFCs (undecided proposals) live and lists the open ones at session start.',
  run({ hookInput, config, projectRoot }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    const openRfcsText = describeOpenRfcs(listRfcs(projectRoot));
    return contextDecision(MODULE_ID, [buildRfcRecipe(resolveKnowledgePath(config)), openRfcsText].filter(Boolean).join('\n\n'));
  },
};
