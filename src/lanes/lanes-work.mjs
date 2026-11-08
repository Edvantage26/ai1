// Shared state of the lanes feature: work plans of deep-lane tasks and their approvals.
// A plan lives in `.jig/work/<slug>/plan.md` (frontmatter `status: draft | ready | approved | done`)
// with `progress.md` next to it. `.jig/` ignores itself, so plans never reach git.
// Approval comes only from the person: the lanes-approval hook records it in jig's state
// directory, outside the repo; the `status` written in the plan is informative.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { resolveStateDirectory, shortHash, readStateText, writeStateText } from '../core/session-state.mjs';

export const JIG_DIRECTORY = '.jig';
export const WORK_DIRECTORY = join(JIG_DIRECTORY, 'work');
export const UNAPPROVED_STATUSES = new Set(['draft', 'ready']);
const FINISHED_STATUSES = new Set(['done', 'abandoned']);

export function readPlanStatus(planText) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(planText);
  const statusMatch = frontmatterMatch && /^status:\s*['"]?([a-z-]+)/m.exec(frontmatterMatch[1]);
  return statusMatch ? statusMatch[1] : 'draft';
}

export function readPlanTitle(planText, fallbackTitle) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(planText);
  const titleMatch = frontmatterMatch && /^title:\s*['"]?(.+?)['"]?\s*$/m.exec(frontmatterMatch[1]);
  return titleMatch ? titleMatch[1] : fallbackTitle;
}

export function writePlanStatus(planPath, newStatus) {
  const planText = readFileSync(planPath, 'utf8');
  const frontmatterMatch = /^---\n([\s\S]*?)\n---/.exec(planText);
  if (!frontmatterMatch) {
    writeFileSync(planPath, `---\nstatus: ${newStatus}\n---\n\n${planText}`);
    return;
  }
  const frontmatterText = /^status:/m.test(frontmatterMatch[1])
    ? frontmatterMatch[1].replace(/^status:.*$/m, `status: ${newStatus}`)
    : `${frontmatterMatch[1]}\nstatus: ${newStatus}`;
  writeFileSync(planPath, `---\n${frontmatterText}\n---${planText.slice(frontmatterMatch[0].length)}`);
}

// Every plan in .jig/work, newest first: { slug, planPath, relativePath, status, title, modifiedMilliseconds }.
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
  try {
    return JSON.parse(readStateText(approvalsStatePath(projectRoot, environment)) || '{}');
  } catch {
    return {};
  }
}

export function recordApproval(projectRoot, environment, planRelativePath, approvedAt = new Date().toISOString()) {
  const approvals = readApprovals(projectRoot, environment);
  approvals[planRelativePath] = approvedAt;
  writeStateText(approvalsStatePath(projectRoot, environment), JSON.stringify(approvals, null, 2));
}

export function isPlanApproved(workPlan, approvals) {
  return Boolean(approvals[workPlan.relativePath]);
}

// `.jig/.gitignore` with `*` keeps plans out of git without touching the repo's own .gitignore.
export function ensureJigDirectoryIgnored(projectRoot) {
  const jigDirectory = join(projectRoot, JIG_DIRECTORY);
  const ignorePath = join(jigDirectory, '.gitignore');
  if (existsSync(ignorePath)) return false;
  mkdirSync(jigDirectory, { recursive: true });
  writeFileSync(ignorePath, '*\n');
  return true;
}

// Path relative to the project root, or null when it falls outside the project.
export function projectRelativePath(projectRoot, targetPath, workingDirectory = projectRoot) {
  if (typeof targetPath !== 'string' || !targetPath) return null;
  const absolutePath = isAbsolute(targetPath) ? targetPath : resolve(workingDirectory, targetPath);
  const relativePath = relative(projectRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return relativePath;
}
