// craft-brief (SessionStart, feature `craft`): tells the agent how to write code so the repo grows
// in order: the minimum change that solves the task, nothing outside it, reuse before writing,
// refactors proposed instead of applied, and names that explain themselves. Thinking before coding
// and verifying before "done" are left to `lanes` and `verify`. Where things live (layout, how to add
// each kind of piece, reusable helpers) belongs in the knowledge bundle, not here.
// The text stays byte-stable between sessions so it does not break the prompt cache.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

const MODULE_ID = 'craft-brief';

export function buildCraftRecipe(config) {
  const reuseSources = isFeatureEnabled('okf', config)
    ? `the code and the knowledge bundle (\`${KNOWLEDGE_BUNDLE_PATH}\`)`
    : 'the code';
  return [
    'Craft: keep the code growing in order.',
    '- Simplicity: write the minimum code that solves the task. No features, options or abstractions nobody asked for, no handling for cases that cannot happen.',
    '- Surgical changes: every changed line traces to the request. Match the style of the surrounding code; do not reformat or "improve" code next to yours. Remove only what your own change left unused.',
    `- Reuse before writing: before adding a function, helper or pattern, look in ${reuseSources} for one that already does it, and follow the existing way of adding that kind of piece.`,
    '- Refactors: when you see duplicated code, dead code, or an abstraction that is missing or not needed, mention it in one line (what and why) at the end of your report, without stopping to ask; apply it right away only when it is trivial.',
    '- Names: self-explanatory, saying what a variable holds or what a function does, even if long. No single letters or cryptic abbreviations; follow the casing of the language and the repo.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'craft',
  description: 'Gives the agent the code craft rules at session start: simplicity, surgical changes, reuse before writing, proposed refactors, clear names.',
  run({ hookInput, config }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    return contextDecision(MODULE_ID, buildCraftRecipe(config));
  },
};
