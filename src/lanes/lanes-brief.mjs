// lanes-brief (SessionStart, feature `lanes`): tells the agent to size each task and pick the
// lightest lane that fits (quick, plan, deep), and lists unfinished deep-lane plans. After a
// compaction it puts the tail of each active plan's progress back in context, because the
// agent's memory of where it was is exactly what compaction loses.
// The text stays byte-stable between sessions so it does not break the prompt cache.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { recordSessionBaseHead, readSessionBase } from '../core/session-base.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import {
  listWorkPlans, isPlanFinished, isSessionPlan, readSessionPlanSlugs, readApprovals, isPlanApproved, ensureWorkDirectoryIgnored,
} from './lanes-work.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';

const MODULE_ID = 'lanes-brief';
const PROGRESS_TAIL_LINES = 15;

export function buildLanesRecipe(verifyCommands, usesWorktrees = false) {
  const verifyText = verifyCommands.length ? verifyCommands.map((verifyCommand) => `\`${verifyCommand}\``).join(', ') : 'the project checks';
  return [
    'Lanes: size every new task before acting and say the lane in one line ("Lane: quick, because ...").',
    `- quick: a clear, contained change (a bug, a wording, a small tweak). Do it, run ${verifyText}, report.`,
    '- plan: several pieces but a clear goal. Read the relevant code, present a short plan (files, steps, how you will verify), and start after the person says yes.',
    '- deep: unclear goal, design choices, a risky area (auth, data, money, migrations, public API) or hours of work. Load the /ai1:lanes-design-before-code skill and follow it: questions, a design in `' + WORK_DIRECTORY + '/<slug>/plan.md`, approval by the person, then step by step.',
    ...(usesWorktrees ? ['- plan and deep tasks are built in their own worktree (see Worktrees); name it in the plan so it survives compaction.'] : []),
    'Pick the lightest lane that fits. "rápido"/"quick" or "piénsalo bien"/"think it through" from the person sets the lane. When a quick task grows, stop and move to plan.',
  ].join('\n');
}

function readProgressTail(planPath) {
  const progressPath = join(dirname(planPath), 'progress.md');
  if (!existsSync(progressPath)) return '(no progress.md yet)';
  return readFileSync(progressPath, 'utf8').trimEnd().split('\n').slice(-PROGRESS_TAIL_LINES).join('\n');
}

export function describeUnfinishedPlans(workPlans, approvals, { withProgress }) {
  if (workPlans.length === 0) return '';
  const planLines = ['Unfinished deep-lane plans in this repo:'];
  for (const workPlan of workPlans) {
    const approvalText = isPlanApproved(workPlan, approvals) ? 'approved by the person' : 'not approved yet';
    planLines.push(`- \`${workPlan.relativePath}\` "${workPlan.title}" (status: ${workPlan.status}, ${approvalText})`);
    if (withProgress) planLines.push(`  Last progress:\n${readProgressTail(workPlan.planPath).replace(/^/gm, '    ')}`);
  }
  planLines.push(withProgress
    ? 'Context was compacted: trust these files and `git log` over your memory of the work. Re-read the plan before the next step.'
    : 'Resume one only if the person asks for it; mark a plan `status: abandoned` when the person drops it.');
  return planLines.join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'lanes',
  description: 'Asks the agent to pick a lane (quick, plan, deep) per task and restores deep-lane progress after compaction.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    // Plans live in the main checkout (shared root), so every worktree of the repo sees the same ones.
    recordSessionBaseHead(hookInput, projectRoot, environment);
    if (sharedRoot !== projectRoot) recordSessionBaseHead(hookInput, sharedRoot, environment);
    ensureWorkDirectoryIgnored(sharedRoot);
    const isAfterCompaction = hookInput.source === 'compact';
    const sessionBase = isAfterCompaction ? readSessionBase(hookInput, sharedRoot, environment) : null;
    const unfinishedPlans = listWorkPlans(sharedRoot).filter((workPlan) => !isPlanFinished(workPlan));
    const sessionPlanSlugs = isAfterCompaction ? readSessionPlanSlugs(hookInput, sharedRoot, environment) : null;
    const plansToRestore = isAfterCompaction && (sessionBase || sessionPlanSlugs)
      ? unfinishedPlans.filter((workPlan) => isSessionPlan(workPlan, sessionBase?.sessionStartMilliseconds, sessionPlanSlugs))
      : [];
    const contextParts = [buildLanesRecipe(config.verify, isFeatureEnabled('worktrees', config))];
    const approvals = readApprovals(sharedRoot, environment);
    const planDescription = plansToRestore.length
      ? describeUnfinishedPlans(plansToRestore, approvals, { withProgress: true })
      : describeUnfinishedPlans(unfinishedPlans, approvals, { withProgress: false });
    if (planDescription) contextParts.push(planDescription);
    return contextDecision(MODULE_ID, contextParts.join('\n\n'));
  },
};
