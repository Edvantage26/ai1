// Shared state of the sizing feature: work plans and the approvals of deep designs.
// A plan lives in `.ai1/work/<slug>/plan.md` with `progress.md` next to it, in the main checkout or,
// from a session isolated in a worktree, in that worktree until it is finished (listPlanRoots). A deep design has
// frontmatter `status: draft | ready | approved | done`; a plan task's plan has `size: plan` and
// `status: active | done`, needs no approval and is only there to survive compaction. `.ai1/work/` ignores itself, so plans never reach git.
// Approval comes only from the person: the sizing-approval hook records it in ai1's state
// directory, outside the repo; the `status` written in the plan is informative.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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

// `plan` for a plan task's plan (frontmatter `size: plan`), `deep` otherwise. `lane: plan` is the
// field before v0.32.0 (lanes renamed to sizing); still read so a plan in progress is never taken for a deep one.
export function readPlanSize(planText) {
  const { frontmatterText } = splitFrontmatter(planText);
  return frontmatterText && /^(?:size|lane):\s*['"]?plan\b/m.test(frontmatterText) ? 'plan' : 'deep';
}

export function readPlanTitle(planText, fallbackTitle) {
  const { frontmatterText } = splitFrontmatter(planText);
  const titleMatch = frontmatterText && /^title:\s*['"]?(.+?)['"]?\s*$/m.exec(frontmatterText);
  return titleMatch ? titleMatch[1] : fallbackTitle;
}

export function writePlanStatus(planPath, newStatus) {
  writeFileSync(planPath, writeFrontmatterField(readFileSync(planPath, 'utf8'), 'status', newStatus));
}

// Where plans are read: the checkout being worked on, then the main checkout. Plans belong in the main
// checkout, shared by every session; a session isolated in a worktree (Claude Code's EnterWorktree)
// cannot write outside it, so its plans live in the worktree's `.ai1/work/` until finish or drop
// moves them home (movePlansToMainCheckout).
export function listPlanRoots(projectRoot, sharedRoot = projectRoot) {
  return [...new Set([projectRoot, sharedRoot])];
}

// Every plan in .ai1/work of one root or of several (listPlanRoots; for a slug in more than one, the
// first root wins), newest first: { slug, planPath, relativePath, status, size, title, modifiedMilliseconds }.
export function listWorkPlans(planRoots) {
  const workPlans = [];
  const seenSlugs = new Set();
  for (const planRoot of [planRoots].flat()) {
    const workDirectory = join(planRoot, WORK_DIRECTORY);
    if (!existsSync(workDirectory)) continue;
    for (const slug of readdirSync(workDirectory)) {
      const planPath = join(workDirectory, slug, 'plan.md');
      if (seenSlugs.has(slug) || !existsSync(planPath)) continue;
      seenSlugs.add(slug);
      const planText = readFileSync(planPath, 'utf8');
      workPlans.push({
        slug,
        planPath,
        relativePath: relative(planRoot, planPath),
        status: readPlanStatus(planText),
        size: readPlanSize(planText),
        title: readPlanTitle(planText, slug),
        modifiedMilliseconds: statSync(planPath).mtimeMs,
      });
    }
  }
  return workPlans.sort((firstPlan, secondPlan) => secondPlan.modifiedMilliseconds - firstPlan.modifiedMilliseconds);
}

// The first root (listPlanRoots order) holding `.ai1/work/<slug>/plan.md`, or null.
export function findPlanRoot(planRoots, planSlug) {
  return planRoots.find((planRoot) => existsSync(join(planRoot, WORK_DIRECTORY, planSlug, 'plan.md'))) ?? null;
}

// Before a worktree is removed: its plan folders move to the main checkout's `.ai1/work/`. A slug the
// main checkout already has gets `-<worktree name>` so neither is lost. Returns the slugs moved there.
export function movePlansToMainCheckout(worktreeRoot, mainRoot, worktreeName) {
  const worktreeWorkDirectory = join(worktreeRoot, WORK_DIRECTORY);
  if (!existsSync(worktreeWorkDirectory)) return [];
  const mainWorkDirectory = join(mainRoot, WORK_DIRECTORY);
  const movedSlugs = [];
  for (const slug of readdirSync(worktreeWorkDirectory)) {
    if (!existsSync(join(worktreeWorkDirectory, slug, 'plan.md'))) continue;
    ensureWorkDirectoryIgnored(mainRoot);
    const targetSlug = existsSync(join(mainWorkDirectory, slug)) ? `${slug}-${worktreeName}` : slug;
    cpSync(join(worktreeWorkDirectory, slug), join(mainWorkDirectory, targetSlug), { recursive: true });
    rmSync(join(worktreeWorkDirectory, slug), { recursive: true, force: true });
    movedSlugs.push(targetSlug);
  }
  return movedSlugs;
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
export function listActivePlans(planRoots, sessionStartMilliseconds, sessionPlanSlugs = null) {
  return listWorkPlans(planRoots).filter((workPlan) => !isPlanFinished(workPlan)
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
  const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'sizing-plans');
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
