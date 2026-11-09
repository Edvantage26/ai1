// Shared state of the lanes feature: work plans of deep-lane tasks and their approvals.
// A plan lives in `.ai1/work/<slug>/plan.md` (frontmatter `status: draft | ready | approved | done`)
// with `progress.md` next to it. `.ai1/work/` ignores itself, so plans never reach git.
// Approval comes only from the person: the lanes-approval hook records it in ai1's state
// directory, outside the repo; the `status` written in the plan is informative.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { splitFrontmatter, writeFrontmatterField } from '../core/frontmatter.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { resolveStateDirectory, sessionStatePath, shortHash, readStateJson, writeStateText } from '../core/session-state.mjs';
import { readNewTranscriptEvents, eventContentBlocks } from '../core/transcript-scan.mjs';
import { shellCommandOnlyReads } from '../core/session-writes.mjs';

export const UNAPPROVED_STATUSES = new Set(['draft', 'ready']);
const PLAN_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
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

// Whether a plan is this session's: written by it, per its transcript (`sessionPlanSlugs`); without a
// transcript (null), modified since the session started. Another session's plan in the same repo is
// not this one's, however recent: before 2026-11-09 its new draft blocked every session open there.
export function isSessionPlan(workPlan, sessionStartMilliseconds, sessionPlanSlugs = null) {
  if (sessionPlanSlugs) return sessionPlanSlugs.has(workPlan.slug);
  return sessionStartMilliseconds == null || workPlan.modifiedMilliseconds >= sessionStartMilliseconds;
}

// This session's plans that are not finished: an old forgotten draft never blocks work.
export function listActivePlans(projectRoot, sessionStartMilliseconds, sessionPlanSlugs = null) {
  return listWorkPlans(projectRoot).filter((workPlan) => !isPlanFinished(workPlan)
    && isSessionPlan(workPlan, sessionStartMilliseconds, sessionPlanSlugs));
}

// The slugs of the plans whose plan.md a transcript tool call may have written: Write/Edit on it,
// or a shell command naming it that is not read-only (`sed -i`, a redirect, a script).
export function listPlanSlugsWrittenBy(toolUse) {
  const planPathPattern = new RegExp(`(?:^|[\\s'"=/])${WORK_DIRECTORY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/\\s'"]+)/plan\\.md`, 'g');
  if (PLAN_WRITING_TOOLS.has(toolUse?.name)) {
    return [...String(toolUse.input?.file_path ?? '').matchAll(planPathPattern)].map((planMatch) => planMatch[1]);
  }
  if (toolUse?.name !== 'Bash') return [];
  const commandText = String(toolUse.input?.command ?? '');
  if (!commandText.includes('plan.md') || shellCommandOnlyReads(commandText)) return [];
  return [...commandText.matchAll(planPathPattern)].map((planMatch) => planMatch[1]);
}

// This session's plan slugs from its transcript (incremental, state per session), or null when the
// hook input has no readable transcript.
export function readSessionPlanSlugs(hookInput, projectRoot, environment) {
  const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'lanes-plans');
  const scanState = { offset: 0, slugs: [], ...readStateJson(statePath) };
  const newTranscript = readNewTranscriptEvents(hookInput.transcript_path, scanState);
  if (!newTranscript) return null;
  const planSlugs = new Set(newTranscript.restarted ? [] : scanState.slugs);
  for (const transcriptEvent of newTranscript.events) {
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) {
      for (const planSlug of listPlanSlugsWrittenBy(toolUse)) planSlugs.add(planSlug);
    }
  }
  writeStateText(statePath, JSON.stringify({ offset: scanState.offset, slugs: [...planSlugs] }));
  return planSlugs;
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

// A `.gitignore` with `*` inside a folder keeps it out of git without touching the repo's own
// .gitignore (the rest of `.ai1/` - config, bundle, later entries - is committed).
export function ensureDirectoryIgnoredByItself(directoryPath) {
  const ignorePath = join(directoryPath, '.gitignore');
  if (existsSync(ignorePath)) return false;
  mkdirSync(directoryPath, { recursive: true });
  writeFileSync(ignorePath, '*\n');
  return true;
}

export function ensureWorkDirectoryIgnored(projectRoot) {
  return ensureDirectoryIgnoredByItself(join(projectRoot, WORK_DIRECTORY));
}
