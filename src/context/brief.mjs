// brief: tells the agent, once per session, which harness this repo runs, so it knows the rules
// before it acts instead of discovering them when a guard stops it. Also records the session's
// base HEAD, shared by okf, sizing and verify. Warns while a plugin that overlaps with an enabled
// feature (src/core/plugin-overlaps.mjs) is still enabled, so the person can switch it off.

import { contextDecision } from '../core/hook-io.mjs';
import { FEATURES, isFeatureEnabled } from '../core/features.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';
import { readEnabledPlugins, findOverlappingPlugins, describeOverlap } from '../core/plugin-overlaps.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODULE_ID = 'brief';

export function buildHarnessBrief(config, enabledModules, enabledPluginIds = []) {
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
  briefLines.push('Ask the person only for what is truly delicate: a deep design, publishing (push, tag, release), production, or what an ai1 guard flags. Everything else (creating, committing in and finishing a worktree, a plan, a step you recommend) you do, then report in one line; the person can stop you. Do not end a reply with a question you could answer yourself, do not re-ask a pending question, and a yes covers what you recommended.');
  const pluginsToDisable = findOverlappingPlugins(enabledPluginIds, activeFeatures.map((featureDefinition) => featureDefinition.id))
    .filter((overlappingPlugin) => overlappingPlugin.action === 'disable');
  if (pluginsToDisable.length) {
    briefLines.push(`Plugins that overlap with ai1 are enabled here: ${pluginsToDisable.map(describeOverlap).join('; ')}. Tell the person once and offer to disable them in this repo with /ai1:core-setup-repo (personal settings only, nothing committed).`);
  }
  return briefLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'core',
  description: 'Summarizes the active harness for the agent at session start.',
  run({ hookInput, config, projectRoot, environment, homeDirectory = homedir(), enabledModules }) {
    // Every feature that judges "what this session changed" needs the HEAD at session start.
    recordSessionBaseHead(hookInput, projectRoot, environment);
    const enabledPluginIds = readEnabledPlugins(projectRoot, join(homeDirectory, '.claude', 'settings.json'));
    return contextDecision(MODULE_ID, buildHarnessBrief(config, enabledModules, enabledPluginIds));
  },
};
