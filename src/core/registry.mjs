// Every jig module, in one list. A module is:
//   { id, event, feature, description, toolNames?, run(moduleContext) -> decision }
// `feature` is an id from src/core/features.mjs; the repo enables features in jig.json.
// `toolNames` (PreToolUse/PostToolUse only) limits the module to those tools; omit it to see all.
// Adding a module means adding it here; hooks/hooks.json does not change.

import briefContext from '../context/brief.mjs';
import dangerGuard from '../guards/danger.mjs';
import craftBriefContext from '../craft/craft-brief.mjs';
import okfIndexContext from '../okf/okf-index.mjs';
import okfUpkeepGate from '../okf/okf-upkeep.mjs';
import okfRecallContext from '../okf/okf-recall.mjs';
import lanesBriefContext from '../lanes/lanes-brief.mjs';
import lanesApprovalContext from '../lanes/lanes-approval.mjs';
import lanesGate from '../lanes/lanes-gate.mjs';
import lanesEscalateGuard from '../lanes/lanes-escalate.mjs';

export const ALL_MODULES = [
  briefContext, okfIndexContext, okfRecallContext, dangerGuard, okfUpkeepGate, craftBriefContext,
  lanesBriefContext, lanesApprovalContext, lanesGate, lanesEscalateGuard,
];

export const KNOWN_MODULE_IDS = ALL_MODULES.map((moduleDefinition) => moduleDefinition.id);

export function modulesForEvent(eventName, toolName, candidateModules = ALL_MODULES) {
  return candidateModules.filter((moduleDefinition) => moduleDefinition.event === eventName
    && (!moduleDefinition.toolNames || moduleDefinition.toolNames.includes(toolName)));
}
