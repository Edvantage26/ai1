// reuse-brief (SessionStart, feature `reuse`): before a task that sounds like something done before in
// this repo, look up how it was done (`ai1 reuse search`) instead of working it out again, and how a
// proposal to encapsulate repeated work is worded. Static text, so it never breaks the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';

const MODULE_ID = 'reuse-brief';

export const REUSE_BRIEF_TEXT = [
  'Reuse: work that comes back in this repo becomes a reusable piece instead of being worked out again.',
  '- When a request sounds like something done before here ("otra vez", "como la última vez", setting up or operating the same thing again), run `ai1 reuse search "<3-5 keywords>"` first: it lists this repo\'s past sessions that did it and the project skills, commands or MCP servers that already cover it; reuse how it was done.',
  '- When the work will clearly recur, or the search shows it already did, propose in one line at the end of your report how to encapsulate it, with its evidence: a rule, hook, script, skill, MCP entry, or completing or merging an existing project piece. Do not stop the task to ask. A yes means loading /ai1:reuse-encapsulate; a no means `ai1 reuse dismiss <slug> --keywords "<words>" "<why>"`, and a dismissed one is never proposed again.',
  '- Only this repo: never search, cite or propose from other repos\' sessions.',
].join('\n');

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'reuse',
  description: 'Tells the agent to look up how a recurring task was done in this repo before redoing it, and how to propose encapsulating repeated work.',
  run({ hookInput }) {
    if (hookInput.source === 'resume') return allowDecision();
    return contextDecision(MODULE_ID, REUSE_BRIEF_TEXT);
  },
};
