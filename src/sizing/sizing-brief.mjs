// sizing-brief (SessionStart, feature `sizing`): tells the agent to size each task and pick the
// lightest size that fits (quick, plan, deep), and lists unfinished plan and deep plans. After a
// compaction it puts the tail of each active plan's progress back in context, because the
// agent's memory of where it was is exactly what compaction loses.
// The text stays byte-stable between sessions so it does not break the prompt cache.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { recordSessionBaseHead, readSessionBase } from '../core/session-base.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import {
  listPlanRoots, listWorkPlans, isPlanFinished, isSessionPlan, readSessionPlanSlugs, readApprovals, isPlanApproved, ensureWorkDirectoryIgnored,
} from './sizing-work.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { contextList, shortenListTitle } from '../core/context-list.mjs';

const MODULE_ID = 'sizing-brief';
const PROGRESS_TAIL_LINES = 15;

export function buildSizingRecipe(verifyCommands, usesWorktrees = false) {
  const verifyText = verifyCommands.length ? verifyCommands.map((verifyCommand) => `\`${verifyCommand}\``).join(', ') : 'the project checks';
  return [
    'Sizing: size every new task before acting and say the size in one line ("Size: quick, because ...").',
    `- quick: a clear, contained change that could be resumed from the request and \`git diff\` alone (a bug, a wording, a small tweak). Do it, run ${verifyText}, report.`,
    '- plan: several pieces, a clear goal. Say the plan in a few lines (files, steps, how you will verify) and start; do not wait for a yes. Over about 3 steps or more than one go, also write `' + WORK_DIRECTORY + '/<slug>/plan.md` (frontmatter `size: plan`, `status: active`, `title`; steps as `- [ ]`), tick each step and close with `ai1 plan-done <slug>`.',
    '- deep: unclear goal, design choices, a risky area (auth, data or irreversible effects, money, migrations, a public API or contract others use, concurrency, deploy or environment, code no test would catch breaking) or hours of work. Load /ai1:sizing-design-before-code and follow it (a design the person approves before code).',
    ...(usesWorktrees ? ['- plan and deep tasks are built in their own worktree; name it in the plan.'] : []),
    'Pick the lightest size that fits; the number of files never decides it. "rápido"/"quick" or "piénsalo bien"/"think it through" from the person sets the size. When a quick task grows, stop and move to plan.',
  ].join('\n');
}

function readProgressTail(planPath) {
  const progressPath = join(dirname(planPath), 'progress.md');
  if (!existsSync(progressPath)) return '(no progress.md yet)';
  return readFileSync(progressPath, 'utf8').trimEnd().split('\n').slice(-PROGRESS_TAIL_LINES).join('\n');
}

const MAX_LISTED_PLANS = 3;

// Parts for contextDecision. After a compaction, this session's plans come whole with their progress
// (the work depends on them); at startup the repo's unfinished plans are a list that can lose items.
export function describeUnfinishedPlans(workPlans, approvals, { withProgress }) {
  if (workPlans.length === 0) return [];
  const describePlan = (workPlan) => {
    const approvalText = workPlan.size === 'plan' ? 'plan task' : isPlanApproved(workPlan, approvals) ? 'approved by the person' : 'not approved yet';
    const titleText = withProgress ? workPlan.title : shortenListTitle(workPlan.title || '');
    const planLine = `- \`${workPlan.relativePath}\` "${titleText}" (status: ${workPlan.status}, ${approvalText})`;
    return withProgress ? `${planLine}\n  Last progress:\n${readProgressTail(workPlan.planPath).replace(/^/gm, '    ')}` : planLine;
  };
  const planItems = workPlans.map(describePlan);
  return [
    'Unfinished plans in this repo:',
    withProgress ? planItems.join('\n') : contextList(planItems, (leftOutCount) => `- ... and ${leftOutCount} more in \`${WORK_DIRECTORY}/\``, { shownAtMost: MAX_LISTED_PLANS }),
    withProgress
      ? 'Context was compacted: trust these files and `git log` over your memory of the work. Re-read the plan before the next step.'
      : 'Resume one only if the person asks for it; mark a plan `status: abandoned` when the person drops it.',
  ];
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'sizing',
  description: 'Asks the agent to size each task (quick, plan, deep) per task and restores plan progress after compaction.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    // A resumed session already has this text in its history.
    if (hookInput.source === 'resume') return allowDecision();
    // Plans live in the main checkout (shared root), so every worktree of the repo sees the same ones;
    // a session isolated in a worktree keeps its own there until finish (listPlanRoots).
    recordSessionBaseHead(hookInput, projectRoot, environment);
    if (sharedRoot !== projectRoot) recordSessionBaseHead(hookInput, sharedRoot, environment);
    ensureWorkDirectoryIgnored(sharedRoot);
    const isAfterCompaction = hookInput.source === 'compact';
    const sessionBase = isAfterCompaction ? readSessionBase(hookInput, sharedRoot, environment) : null;
    const unfinishedPlans = listWorkPlans(listPlanRoots(projectRoot, sharedRoot)).filter((workPlan) => !isPlanFinished(workPlan));
    const sessionPlanSlugs = isAfterCompaction ? readSessionPlanSlugs(hookInput, sharedRoot, environment) : null;
    const plansToRestore = isAfterCompaction && (sessionBase || sessionPlanSlugs)
      ? unfinishedPlans.filter((workPlan) => isSessionPlan(workPlan, sessionBase?.sessionStartMilliseconds, sessionPlanSlugs))
      : [];
    const contextParts = [buildSizingRecipe(config.verify, isFeatureEnabled('worktrees', config))];
    const approvals = readApprovals(sharedRoot, environment);
    const planParts = plansToRestore.length
      ? describeUnfinishedPlans(plansToRestore, approvals, { withProgress: true })
      : describeUnfinishedPlans(unfinishedPlans, approvals, { withProgress: false });
    if (planParts.length) contextParts.push('', ...planParts);
    return contextDecision(MODULE_ID, contextParts);
  },
};
