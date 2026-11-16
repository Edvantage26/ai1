// okf-catch-up-prompt (UserPromptSubmit, feature `okf`): the same check as okf-catch-up-start, on each
// message of the person but only after HEAD moved since the last check (a merge or a pull done in a
// terminal while the session is open), so it is seen at the next message, not at the next session.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { findCatchUpInstruction } from './okf-catch-up.mjs';

const MODULE_ID = 'okf-catch-up-prompt';

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'okf',
  description: 'After HEAD moved during a session, says when a merged branch had no knowledge bundle, and has a background agent document its changes.',
  run({ hookInput, projectRoot, environment }) {
    const catchUpInstruction = findCatchUpInstruction({ hookInput, projectRoot, environment, onlyWhenHeadMoved: true });
    return catchUpInstruction ? contextDecision(MODULE_ID, catchUpInstruction) : allowDecision();
  },
};
