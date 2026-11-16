// okf-catch-up-start (SessionStart, feature `okf`): a branch that had no knowledge bundle was merged
// into the current branch and nobody caught the bundle up (see okf-catch-up.mjs): the agent is told to
// say it in one line and hand the catch-up to an independent background agent.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { findCatchUpInstruction } from './okf-catch-up.mjs';

const MODULE_ID = 'okf-catch-up-start';

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'okf',
  description: 'Says at session start when a merged branch had no knowledge bundle, and has a background agent document its changes.',
  run({ hookInput, projectRoot, environment }) {
    const catchUpInstruction = findCatchUpInstruction({ hookInput, projectRoot, environment, onlyWhenHeadMoved: false });
    return catchUpInstruction ? contextDecision(MODULE_ID, catchUpInstruction) : allowDecision();
  },
};
