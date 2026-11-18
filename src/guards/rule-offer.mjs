// rule-offer (UserPromptSubmit, feature `danger`): when the person corrects the agent so that something
// never happens again ("no vuelvas a...", "que no pase más", "never do that again"), tells the agent to
// offer, in one line after doing what was asked, turning it into a guard rule of the repo
// (/ai1:danger-write-rule). A rule in a reply is forgotten; a guard is not. Nothing is written without a yes.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';

const MODULE_ID = 'rule-offer';

// Phrases of a lasting correction, in Spanish and English. Kept narrow: a word like "bloquea" alone is
// too often about the product, not about the agent.
const LASTING_CORRECTION_PATTERNS = [
  /\bno vuelvas a\b/i,
  /\bnunca (?:más|mas) /i,
  /\bque no (?:se )?(?:vuelva a (?:pasar|ocurrir)|(?:pase|ocurra) (?:más|mas))\b/i,
  /\bnever (?:do|run|touch|edit|use) (?:that|this|it)\b.*\bagain\b/i,
  /\b(?:don't|do not) ever\b/i,
  /\bnever again\b/i,
];

export const RULE_OFFER_TEXT = 'ai1/rule-offer: the person is correcting something that must not happen again. Do what they asked first. '
  + 'Then, if it is a command or an edit an agent could repeat in this repo, offer in one line at the end to turn it into a guard rule with /ai1:danger-write-rule; write nothing without their yes. '
  + 'A correction of how an ai1 skill works is a customization (/ai1:core-customize-skill) instead; a personal preference is neither.';

export function isLastingCorrection(promptText) {
  return LASTING_CORRECTION_PATTERNS.some((correctionPattern) => correctionPattern.test(String(promptText || '')));
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'danger',
  description: 'When the person says something must never happen again, has the agent offer to turn it into a guard rule (/ai1:danger-write-rule).',
  run({ hookInput }) {
    return isLastingCorrection(hookInput.prompt) ? contextDecision(MODULE_ID, RULE_OFFER_TEXT) : allowDecision();
  },
};
