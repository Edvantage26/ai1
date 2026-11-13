// Which ai1 skills the agent sees in a repo: the skills of a disabled feature stay callable by the
// person (/ai1:<skill>) but leave the agent's skill list, through Claude Code's `skillOverrides` in
// the committed .claude/settings.json (`user-invocable-only`). Skills of an always-on feature (core)
// or of no feature (session) are always listed. ai1 only touches `ai1:<skill>` keys and leaves a
// stronger choice of the person (`off`) alone. See .ai1/okf/architecture/plugin-layout.md.

import { SKILL_CUSTOMIZATION_INDEX, featureOfSkill } from './skill-customization-index.mjs';
import { findFeature, isFeatureEnabled } from './features.mjs';

export const HIDDEN_SKILL_VALUE = 'user-invocable-only';
const HIDING_VALUES = new Set([HIDDEN_SKILL_VALUE, 'off']);

function skillOverrideKey(skillFolder) {
  return `ai1:${skillFolder}`;
}

// The ai1 skills (folders) whose feature can be switched off, with that feature's state in config.
function listFeatureSkills(config) {
  return Object.keys(SKILL_CUSTOMIZATION_INDEX)
    .map((skillFolder) => ({ skillFolder, featureDefinition: findFeature(featureOfSkill(skillFolder)) }))
    .filter(({ featureDefinition }) => featureDefinition && !featureDefinition.alwaysOn)
    .map(({ skillFolder, featureDefinition }) => ({ skillFolder, isEnabled: isFeatureEnabled(featureDefinition.id, config) }));
}

// projectSettings with `skillOverrides` matching the features of config (a new object).
export function applySkillVisibility(projectSettings, config) {
  const skillOverrides = { ...projectSettings.skillOverrides };
  for (const { skillFolder, isEnabled } of listFeatureSkills(config)) {
    const overrideKey = skillOverrideKey(skillFolder);
    if (!isEnabled && !HIDING_VALUES.has(skillOverrides[overrideKey])) skillOverrides[overrideKey] = HIDDEN_SKILL_VALUE;
    if (isEnabled && skillOverrides[overrideKey] === HIDDEN_SKILL_VALUE) delete skillOverrides[overrideKey];
  }
  const updatedSettings = { ...projectSettings, skillOverrides };
  if (!Object.keys(skillOverrides).length) delete updatedSettings.skillOverrides;
  return updatedSettings;
}

// The skills whose listing does not match config: shown though their feature is off, or hidden by
// ai1 though it is on. Empty when settings and config agree.
export function findSkillVisibilityDrift(projectSettings, config) {
  const skillOverrides = projectSettings?.skillOverrides ?? {};
  return listFeatureSkills(config)
    .filter(({ skillFolder, isEnabled }) => {
      const overrideValue = skillOverrides[skillOverrideKey(skillFolder)];
      return isEnabled ? overrideValue === HIDDEN_SKILL_VALUE : !HIDING_VALUES.has(overrideValue);
    })
    .map(({ skillFolder }) => skillOverrideKey(skillFolder));
}
