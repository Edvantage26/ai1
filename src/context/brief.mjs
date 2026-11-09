// brief: tells the agent, once per session, which harness this repo runs, so it knows the rules
// before it acts instead of discovering them when a guard stops it. Also records the session's
// base HEAD, shared by okf, lanes and verify.

import { contextDecision } from '../core/hook-io.mjs';
import { FEATURES, isFeatureEnabled } from '../core/features.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';

const MODULE_ID = 'brief';

export function buildHarnessBrief(config, enabledModules) {
  const activeFeatures = FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn && isFeatureEnabled(featureDefinition.id, config));
  const briefLines = [
    `ai1 harness is active in this repo (protected branch: ${config.trunk}).`,
  ];
  // A feature with its own session-start text explains itself there: here only its title.
  const featuresWithOwnBrief = new Set(enabledModules
    .filter((moduleDefinition) => moduleDefinition.event === 'SessionStart' && moduleDefinition.id !== MODULE_ID)
    .map((moduleDefinition) => moduleDefinition.feature));
  if (activeFeatures.length) {
    briefLines.push('Features enabled in .ai1/config.json:');
    for (const featureDefinition of activeFeatures) {
      const featureSummary = featuresWithOwnBrief.has(featureDefinition.id) ? featureDefinition.title : featureDefinition.description;
      briefLines.push(`- ${featureDefinition.id}: ${featureSummary}`);
    }
  }
  const hookModules = enabledModules.filter((moduleDefinition) => moduleDefinition.id !== MODULE_ID);
  if (hookModules.length) briefLines.push(`Hooks enforcing them: ${hookModules.map((moduleDefinition) => moduleDefinition.id).join(', ')}.`);
  if (config.verify.length) {
    const verifyList = config.verify.map((verifyCommand) => `\`${verifyCommand}\``).join(', ');
    briefLines.push(isFeatureEnabled('verify', config)
      ? `Before saying a change is done, run: ${verifyList}, in full (no filters); the verify gate checks it when you stop.`
      : `Before saying a change is done, run: ${verifyList}.`);
  }
  briefLines.push('When an ai1 hook asks or refuses, follow its reason; do not work around it.');
  return briefLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'core',
  description: 'Summarizes the active harness for the agent at session start.',
  run({ hookInput, config, projectRoot, environment, enabledModules }) {
    // Every feature that judges "what this session changed" needs the HEAD at session start.
    recordSessionBaseHead(hookInput, projectRoot, environment);
    return contextDecision(MODULE_ID, buildHarnessBrief(config, enabledModules));
  },
};
