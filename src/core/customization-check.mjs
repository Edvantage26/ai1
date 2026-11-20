// customization-check (Stop, feature `core`): after a customizable ai1 skill was used - loaded by the
// agent (a `Skill` tool call `ai1:<skill>`) or typed by the person (`<command-name>/ai1:<skill>`) - and
// `minToolCalls` tool calls followed it (counted across turns from the transcript, incremental read),
// asks the agent once per skill and session to judge silently whether something could have gone better
// and, only then, to propose the customization rule (what the skill does, that it can be customized, the rule) that would have avoided it. Skills the
// person quieted (`ai1 skill-context quiet <skill>`) are left out. No model, no network.
//
// Options (modules.customization-check): minToolCalls (default 3).

import { allowDecision, blockDecision } from './hook-io.mjs';
import { resolveStateDirectory, sessionStatePath, readStateJson, writeStateText } from './session-state.mjs';
import { readNewTranscriptEvents, eventContentBlocks, isPersonPromptEvent, TOOL_USE_MARKER } from './transcript-scan.mjs';
import { BACKGROUND_AGENT_MARKERS, updatePendingBackgroundAgents } from './background-agents.mjs';
import { SKILL_CUSTOMIZATION_INDEX } from './skill-customization-index.mjs';
import { describeCustomizationOffer, isSkillQuiet } from './skill-customization.mjs';

const MODULE_ID = 'customization-check';
const DEFAULT_MIN_TOOL_CALLS = 3;
const PLUGIN_SKILL_PREFIX = 'ai1:';
const TYPED_SKILL_MARKER = 'command-name>/ai1:';
const TYPED_SKILL_PATTERN = /<command-name>\/ai1:([a-z0-9-]+)<\/command-name>/g;

function isCustomizableSkill(skillFolder) {
  return SKILL_CUSTOMIZATION_INDEX[skillFolder]?.customizable === true;
}

function typedSkills(transcriptEvent) {
  if (!isPersonPromptEvent(transcriptEvent)) return [];
  const messageContent = transcriptEvent.message.content;
  const promptText = typeof messageContent === 'string' ? messageContent : messageContent.filter((contentBlock) => contentBlock?.type === 'text').map((contentBlock) => contentBlock.text).join('\n');
  return [...promptText.matchAll(TYPED_SKILL_PATTERN)].map((skillMatch) => skillMatch[1]);
}

// Walks new events in order: a skill load starts counting for that skill (unless asked already this
// session), every other tool call counts for each skill being counted.
export function countToolCallsAfterSkillLoads(transcriptEvents, checkState) {
  const startCounting = (skillFolder) => {
    if (isCustomizableSkill(skillFolder) && !checkState.asked.includes(skillFolder) && !(skillFolder in checkState.counting)) checkState.counting[skillFolder] = 0;
  };
  for (const transcriptEvent of transcriptEvents) {
    typedSkills(transcriptEvent).forEach(startCounting);
    for (const toolUseBlock of eventContentBlocks(transcriptEvent, 'tool_use')) {
      const loadedSkill = toolUseBlock.name === 'Skill' ? String(toolUseBlock.input?.skill || '') : '';
      if (loadedSkill.startsWith(PLUGIN_SKILL_PREFIX)) {
        startCounting(loadedSkill.slice(PLUGIN_SKILL_PREFIX.length));
        continue;
      }
      for (const skillFolder of Object.keys(checkState.counting)) checkState.counting[skillFolder] += 1;
    }
  }
}

export function buildCustomizationCheckReason(skillFolders) {
  const skillNames = skillFolders.map((skillFolder) => `/ai1:${skillFolder}`).join(', ');
  return [
    `Customization: ${skillNames} ran in this session. Judge silently whether it could have gone better here because of something the skill did not know about this project or this person:`,
    '- a step redone or worked around; something you had to ask that will be the same next time; the person corrected the result; a rule of its customization made it worse.',
    `If none: finish without writing anything about it. If one did: at the end of your report, offer the exact rule to add or change and where (this project, committed, or only for the person). A yes loads /ai1:core-customize-skill; nothing is written without it. A "no me lo preguntes más" means \`ai1 skill-context quiet <skill>\`.`,
    describeCustomizationOffer('for this project (committed) or only for the person'),
    'Not this: work that repeats in this repo is a reuse proposal (its own line, never merged with this one); "never do X" is a guard rule (/ai1:danger-write-rule); tool data (where forks open, hook options, the worktree recipe) has its own place.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'core',
  description: 'After a customizable ai1 skill was used and 3 or more tool calls followed, asks once per skill and session whether a customization rule would have made it go better.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment, moduleOptions }) {
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, MODULE_ID);
    const checkState = { offset: 0, counting: {}, asked: [], backgroundAgents: [], ...readStateJson(statePath) };
    const newTranscript = readNewTranscriptEvents(hookInput.transcript_path, checkState, [TOOL_USE_MARKER, TYPED_SKILL_MARKER, ...BACKGROUND_AGENT_MARKERS]);
    if (!newTranscript) return allowDecision();
    if (newTranscript.restarted) checkState.counting = {};
    checkState.backgroundAgents = updatePendingBackgroundAgents(newTranscript.restarted ? [] : checkState.backgroundAgents, newTranscript.events);
    countToolCallsAfterSkillLoads(newTranscript.events, checkState);
    const minToolCalls = moduleOptions?.minToolCalls ?? DEFAULT_MIN_TOOL_CALLS;
    const quietSkills = Object.keys(checkState.counting).filter((skillFolder) => isSkillQuiet(sharedRoot, skillFolder));
    quietSkills.forEach((skillFolder) => delete checkState.counting[skillFolder]);
    // Background agents still working: the skill has not finished, so the question waits for them.
    const dueSkills = checkState.backgroundAgents.length ? [] : Object.keys(checkState.counting).filter((skillFolder) => checkState.counting[skillFolder] >= minToolCalls);
    for (const skillFolder of dueSkills) {
      delete checkState.counting[skillFolder];
      checkState.asked.push(skillFolder);
    }
    writeStateText(statePath, JSON.stringify(checkState));
    return dueSkills.length ? blockDecision(MODULE_ID, buildCustomizationCheckReason(dueSkills)) : allowDecision();
  },
};
