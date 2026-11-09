// Shared state of the lanes feature: work plans of deep-lane tasks and their approvals.
// A plan lives in `.ai1/work/<slug>/plan.md` (frontmatter `status: draft | ready | approved | done`)
// with `progress.md` next to it. `.ai1/work/` ignores itself, so plans never reach git.
// Approval comes only from the person: the lanes-approval hook records it in ai1's state
// directory, outside the repo; the `status` written in the plan is informative.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { splitFrontmatter, writeFrontmatterField } from '../core/frontmatter.mjs';
import { AI1_DIRECTORY } from '../core/config.mjs';
import { resolveStateDirectory, shortHash, readStateJson, writeStateText } from '../core/session-state.mjs';

export const WORK_DIRECTORY = join(AI1_DIRECTORY, 'work');
export const UNAPPROVED_STATUSES = new Set(['draft', 'ready']);
const FINISHED_STATUSES = new Set(['done', 'abandoned']);

export function readPlanStatus(planText) {
  const { frontmatterText } = splitFrontmatter(planText);
  const statusMatch = frontmatterText && /^status:\s*['"]?([a-z-]+)/m.exec(frontmatterText);
  return statusMatch ? statusMatch[1] : 'draft';
}

export function readPlanTitle(planText, fallbackTitle) {
  const { frontmatterText } = splitFrontmatter(planText);
  const titleMatch = frontmatterText && /^title:\s*['"]?(.+?)['"]?\s*$/m.exec(frontmatterText);
  return titleMatch ? titleMatch[1] : fallbackTitle;
}

export function writePlanStatus(planPath, newStatus) {
  writeFileSync(planPath, writeFrontmatterField(readFileSync(planPath, 'utf8'), 'status', newStatus));
}

// Every plan in .ai1/work, newest first: { slug, planPath, relativePath, status, title, modifiedMilliseconds }.
export function listWorkPlans(projectRoot) {
  const workDirectory = join(projectRoot, WORK_DIRECTORY);
  if (!existsSync(workDirectory)) return [];
  const workPlans = [];
  for (const slug of readdirSync(workDirectory)) {
    const planPath = join(workDirectory, slug, 'plan.md');
    if (!existsSync(planPath)) continue;
    const planText = readFileSync(planPath, 'utf8');
    workPlans.push({
      slug,
      planPath,
      relativePath: relative(projectRoot, planPath),
      status: readPlanStatus(planText),
      title: readPlanTitle(planText, slug),
      modifiedMilliseconds: statSync(planPath).mtimeMs,
    });
  }
  return workPlans.sort((firstPlan, secondPlan) => secondPlan.modifiedMilliseconds - firstPlan.modifiedMilliseconds);
}

export function isPlanFinished(workPlan) {
  return FINISHED_STATUSES.has(workPlan.status);
}

// Plans touched in this session that are not finished: an old forgotten draft never blocks work.
export function listActivePlans(projectRoot, sessionStartMilliseconds) {
  return listWorkPlans(projectRoot).filter((workPlan) => !isPlanFinished(workPlan)
    && (sessionStartMilliseconds == null || workPlan.modifiedMilliseconds >= sessionStartMilliseconds));
}

function approvalsStatePath(projectRoot, environment) {
  return join(resolveStateDirectory(environment), `approvals-${shortHash(projectRoot)}.json`);
}

export function readApprovals(projectRoot, environment) {
  return readStateJson(approvalsStatePath(projectRoot, environment));
}

export function recordApproval(projectRoot, environment, planRelativePath, approvedAt = new Date().toISOString()) {
  const approvals = readApprovals(projectRoot, environment);
  approvals[planRelativePath] = approvedAt;
  writeStateText(approvalsStatePath(projectRoot, environment), JSON.stringify(approvals, null, 2));
}

export function isPlanApproved(workPlan, approvals) {
  return Boolean(approvals[workPlan.relativePath]);
}

// `.ai1/work/.gitignore` with `*` keeps plans out of git without touching the repo's own .gitignore
// (the rest of `.ai1/` - config, bundle, RFCs - is committed).
export function ensureWorkDirectoryIgnored(projectRoot) {
  const workDirectory = join(projectRoot, WORK_DIRECTORY);
  const ignorePath = join(workDirectory, '.gitignore');
  if (existsSync(ignorePath)) return false;
  mkdirSync(workDirectory, { recursive: true });
  writeFileSync(ignorePath, '*\n');
  return true;
}
