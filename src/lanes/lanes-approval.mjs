// lanes-approval (UserPromptSubmit, feature `lanes`): the person approves a deep-lane design by
// answering the agent's request for approval ("aprobado", "adelante", "ok", "go ahead"...). Only a
// plan the agent marked `status: ready` can be approved, so a "yes" to a question asked while the
// design is still a draft does not count. The approval is recorded by this hook, not by the agent.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { listWorkPlans, readSessionPlanSlugs, recordApproval, writePlanStatus } from './lanes-work.mjs';

const MODULE_ID = 'lanes-approval';
const MAX_APPROVAL_CHARACTERS = 120;
const APPROVAL_WORDS = /\b(aprobad[oa]|apruebo|aprueba|apruebalo|aprobar|adelante|dale|vale|ok|okay|perfecto|listo|approved?|lgtm|go ahead|proceed|yes|sounds good)\b/;
// "si" is a yes only when it opens the message ("si", "sí, adelante"); inside a sentence it is the
// conditional "if" ("que si hay un error...").
const LEADING_YES = /^si\b/;
const RESERVATION_WORDS = /\b(no|pero|cambia|cambiar|antes|espera|falta|duda|aunque|but|change|wait|before|instead|not)\b/;

export function normalizePrompt(promptText) {
  return String(promptText || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// A short message that says yes and puts no condition on it. A question never approves: it asks.
export function isApprovalMessage(promptText) {
  const normalizedPrompt = normalizePrompt(promptText);
  if (!normalizedPrompt || normalizedPrompt.length > MAX_APPROVAL_CHARACTERS || normalizedPrompt.includes('?')) return false;
  return (APPROVAL_WORDS.test(normalizedPrompt) || LEADING_YES.test(normalizedPrompt)) && !RESERVATION_WORDS.test(normalizedPrompt);
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'lanes',
  description: 'Records the person\'s approval of a deep-lane design marked ready.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    if (!isApprovalMessage(hookInput.prompt)) return allowDecision();
    // A yes in this session approves this session's design, never one another session has waiting.
    const sessionPlanSlugs = readSessionPlanSlugs(hookInput, sharedRoot, environment);
    const readyPlan = listWorkPlans(sharedRoot)
      .find((workPlan) => workPlan.status === 'ready' && (!sessionPlanSlugs || sessionPlanSlugs.has(workPlan.slug)));
    if (!readyPlan) return allowDecision();
    recordApproval(sharedRoot, environment, readyPlan.relativePath);
    writePlanStatus(readyPlan.planPath, 'approved');
    return contextDecision(MODULE_ID, [
      `The person approved the design \`${readyPlan.relativePath}\` ("${readyPlan.title}"); code edits are open now.`,
      `Implement it step by step. Close each step with \`ai1 step-done ${readyPlan.slug} "<step>: <files>"\` (runs the verify commands, logs the step in progress.md only if green).`,
      'If the design turns out wrong, stop and update the plan; set `status: ready` again to ask for a new approval. When finished, set `status: done` and move lasting decisions to the knowledge bundle.',
    ].join('\n'));
  },
};
