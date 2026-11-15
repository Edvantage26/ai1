// brief: tells the agent, once per session, which harness this repo runs, so it knows the rules
// before it acts instead of discovering them when a guard stops it. Also records the session's
// base HEAD, shared by okf, sizing and verify. Warns while a plugin that overlaps with an enabled
// feature (src/core/plugin-overlaps.mjs) is still enabled, so the person can switch it off, and when
// the skills hidden in .claude/settings.json no longer match the features (src/core/skill-visibility.mjs).

import { contextDecision } from '../core/hook-io.mjs';
import { FEATURES, isFeatureEnabled } from '../core/features.mjs';
import { recordSessionBaseHead } from '../core/session-base.mjs';
import { readEnabledPlugins, findOverlappingPlugins, describeOverlap } from '../core/plugin-overlaps.mjs';
import { findSkillVisibilityDrift } from '../core/skill-visibility.mjs';
import { readJsonFileIfValid } from '../core/json-file.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MODULE_ID = 'brief';

export function buildHarnessBrief(config, enabledPluginIds = [], projectSettings = {}) {
  const activeFeatures = FEATURES.filter((featureDefinition) => !featureDefinition.alwaysOn && isFeatureEnabled(featureDefinition.id, config));
  // Most important first: when the session-start texts go over the hook limit, the cut takes the end
  // (core/hook-io.mjs). Warnings about this repo, then how to work, then the reference lists.
  const briefLines = [
    `ai1 harness is active in this repo (protected branch: ${config.trunk}).`,
  ];
  const pluginsToDisable = findOverlappingPlugins(enabledPluginIds, activeFeatures.map((featureDefinition) => featureDefinition.id))
    .filter((overlappingPlugin) => overlappingPlugin.action === 'disable');
  if (pluginsToDisable.length) {
    briefLines.push(`Plugins that overlap with ai1 are enabled here: ${pluginsToDisable.map(describeOverlap).join('; ')}. Tell the person once and offer to disable them in this repo with /ai1:core-setup-repo (personal settings only, nothing committed).`);
  }
  const driftedSkills = findSkillVisibilityDrift(projectSettings, config);
  if (driftedSkills.length) {
    briefLines.push(`The skills listed for this repo do not match its features (${driftedSkills.join(', ')}): tell the person once; \`ai1 init\` again with the same features fixes \`skillOverrides\`.`);
  }
  briefLines.push('When an ai1 hook asks or refuses, follow its reason; do not work around it.');
  briefLines.push('Ask the person only for what is truly delicate: a deep design, publishing (push, tag, release), production, or what an ai1 guard flags. Everything else (creating, committing in and finishing a worktree, a plan, a step you recommend) you do, then report in one line; the person can stop you. Do not end a reply with a question you could answer yourself, do not re-ask a pending question, and a yes covers what you recommended.');
  if (config.verify.length) {
    const verifyList = config.verify.map((verifyCommand) => `\`${verifyCommand}\``).join(', ');
    briefLines.push(isFeatureEnabled('verify', config)
      ? `Before saying a change is done, run: ${verifyList}, in full (no filters); the verify gate checks it when you stop.`
      : `Before saying a change is done, run: ${verifyList}.`);
  }
  // The features as one line of ids: each one with its own session-start text explains itself there,
  // the others are enforced by their hooks at the moment (`ai1 status` lists them for the person).
  if (activeFeatures.length) {
    briefLines.push(`Features on in .ai1/config.json: ${activeFeatures.map((featureDefinition) => featureDefinition.id).join(', ')}.`);
  }
  return briefLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'core',
  description: 'Summarizes the active harness for the agent at session start.',
  run({ hookInput, config, projectRoot, environment, homeDirectory = homedir() }) {
    // Every feature that judges "what this session changed" needs the HEAD at session start.
    recordSessionBaseHead(hookInput, projectRoot, environment);
    const enabledPluginIds = readEnabledPlugins(projectRoot, join(homeDirectory, '.claude', 'settings.json'));
    const projectSettings = readJsonFileIfValid(join(projectRoot, '.claude', 'settings.json')) ?? {};
    return contextDecision(MODULE_ID, buildHarnessBrief(config, enabledPluginIds, projectSettings));
  },
};
