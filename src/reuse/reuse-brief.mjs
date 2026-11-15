// reuse-brief (SessionStart, feature `reuse`): before a task that sounds like something done before in
// this repo, look up how it was done (`ai1 reuse search`) instead of working it out again, and how a
// proposal to encapsulate repeated work is worded. Static text, so it never breaks the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';

const MODULE_ID = 'reuse-brief';

// The proposal itself (wording, containers, dismiss) comes with reuse-check at Stop, when there is work to judge.
export const REUSE_BRIEF_TEXT = [
  'Reuse: work that comes back in this repo becomes a reusable piece instead of being worked out again.',
  '- When a request sounds like something done before here ("otra vez", "como la última vez", setting up or operating the same thing again), run `ai1 reuse search "<3-5 keywords>"` first and reuse how it was done. Only this repo: never search, cite or propose from other repos\' sessions.',
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
