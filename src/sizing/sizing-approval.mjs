// sizing-approval (UserPromptSubmit, feature `sizing`): the person approves a deep design by
// answering the agent's request for approval ("aprobado", "adelante", "ok", "go ahead"...). Only a
// plan the agent marked `status: ready` can be approved, so a "yes" to a question asked while the
// design is still a draft does not count. The approval is recorded by this hook, not by the agent.
// The yes must answer the turn that presented the plan: the agent's last turn wrote it (set it
// ready, or updated it and asked again). Seen on 2026-11-15: with a design ready, the agent proposed
// a redesign and asked "shall I change it and present it again?"; the person's "Si" approved the old
// design. Reading what the agent asked would depend on its wording; whether it wrote the plan does not.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { eventContentBlocks, readLastAgentTurnEvents } from '../core/transcript-scan.mjs';
import { listPlanRoots, listPlanSlugsWrittenBy, listWorkPlans, readSessionPlanSlugs, recordApproval, writePlanStatus } from './sizing-work.mjs';

const MODULE_ID = 'sizing-approval';
const MAX_APPROVAL_CHARACTERS = 120;
const APPROVAL_WORDS = /\b(aprobad[oa]|apruebo|aprueba|apruebalo|aprobar|adelante|dale|vale|ok|okay|perfecto|listo|acepto|aceptad[oa]|approved?|accept(?:ed)?|lgtm|go ahead|proceed|yes|sounds good)\b/;
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

// Whether the agent's last turn wrote this plan, or null when there is no transcript to tell.
export function lastTurnWrotePlan(transcriptPath, planSlug) {
  const lastTurnEvents = readLastAgentTurnEvents(transcriptPath);
  if (!lastTurnEvents) return null;
  return lastTurnEvents.some((transcriptEvent) => eventContentBlocks(transcriptEvent, 'tool_use')
    .some((toolUse) => listPlanSlugsWrittenBy(toolUse).includes(planSlug)));
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'sizing',
  description: 'Records the person\'s approval of a deep design marked ready.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    if (!isApprovalMessage(hookInput.prompt)) return allowDecision();
    // A yes in this session approves this session's design, never one another session has waiting.
    const sessionPlanSlugs = readSessionPlanSlugs(hookInput, sharedRoot, environment);
    const readyPlan = listWorkPlans(listPlanRoots(projectRoot, sharedRoot))
      .find((workPlan) => workPlan.status === 'ready' && (!sessionPlanSlugs || sessionPlanSlugs.has(workPlan.slug)));
    if (!readyPlan) return allowDecision();
    // Without a transcript there is no way to tell what the yes answers: the ready plan decides.
    if (lastTurnWrotePlan(hookInput.transcript_path, readyPlan.slug) === false) {
      return contextDecision(MODULE_ID, [
        `The person said yes, but the design \`${readyPlan.relativePath}\` is NOT approved: your last turn did not present it (it did not write the plan), so the yes answers something else you asked.`,
        'Do what they said yes to. To ask for approval, write the plan in the turn where you ask (update it with what was discussed, keep `status: ready`) and ask again.',
        `If you did write it from Bash, it was not recognised: write it with Write/Edit, or name its full path \`${readyPlan.relativePath}\` in the command.`,
      ].join('\n'));
    }
    recordApproval(sharedRoot, environment, readyPlan.relativePath);
    writePlanStatus(readyPlan.planPath, 'approved');
    return contextDecision(MODULE_ID, [
      `The person approved the design \`${readyPlan.relativePath}\` ("${readyPlan.title}"); code edits are open now.`,
      `Implement it step by step. Close each step with \`ai1 step-done ${readyPlan.slug} "<step>: <files>"\` (runs the verify commands, logs the step in progress.md only if green).`,
      'If the design turns out wrong, stop and update the plan; set `status: ready` again to ask for a new approval. When finished, set `status: done` and move lasting decisions to the knowledge bundle.',
    ].join('\n'));
  },
};
