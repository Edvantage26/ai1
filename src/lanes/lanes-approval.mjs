// lanes-approval (UserPromptSubmit, feature `lanes`): the person approves a deep-lane design by
// answering the agent's request for approval ("aprobado", "adelante", "ok", "go ahead"...). Only a
// plan the agent marked `status: ready` can be approved, so a "yes" to a question asked while the
// design is still a draft does not count. The approval is recorded by this hook, not by the agent.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listWorkPlans, recordApproval, writePlanStatus } from './lanes-work.mjs';

const MODULE_ID = 'lanes-approval';
const MAX_APPROVAL_CHARACTERS = 120;
const APPROVAL_WORDS = /\b(aprobad[oa]|apruebo|aprueba|apruebalo|aprobar|adelante|dale|vale|ok|okay|si|perfecto|listo|approved?|lgtm|go ahead|proceed|yes|sounds good)\b/;
const RESERVATION_WORDS = /\b(no|pero|cambia|cambiar|antes|espera|falta|duda|aunque|but|change|wait|before|instead|not)\b/;

export function normalizePrompt(promptText) {
  return String(promptText || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// A short message that says yes and puts no condition on it.
export function isApprovalMessage(promptText) {
  const normalizedPrompt = normalizePrompt(promptText);
  if (!normalizedPrompt || normalizedPrompt.length > MAX_APPROVAL_CHARACTERS) return false;
  return APPROVAL_WORDS.test(normalizedPrompt) && !RESERVATION_WORDS.test(normalizedPrompt);
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'lanes',
  description: 'Records the person\'s approval of a deep-lane design marked ready.',
  run({ hookInput, projectRoot, environment }) {
    const readyPlan = listWorkPlans(projectRoot).find((workPlan) => workPlan.status === 'ready');
    if (!readyPlan || !isApprovalMessage(hookInput.prompt)) return allowDecision();
    recordApproval(projectRoot, environment, readyPlan.relativePath);
    writePlanStatus(readyPlan.planPath, 'approved');
    return contextDecision(MODULE_ID, [
      `The person approved the design \`${readyPlan.relativePath}\` ("${readyPlan.title}"); code edits are open now.`,
      `Implement it step by step. Close each step with \`jig step-done ${readyPlan.slug} "<step>: <files>"\` (runs the verify commands, logs the step in progress.md only if green).`,
      'If the design turns out wrong, stop and update the plan; set `status: ready` again to ask for a new approval. When finished, set `status: done` and move lasting decisions to the knowledge bundle.',
    ].join('\n'));
  },
};
