// sizing-gate (PreToolUse, feature `sizing`): while a deep design of this session (not a plan task's
// plan, which needs no approval) is not approved
// by the person, refuses edits to project files outside `.ai1/`, the knowledge bundle and later entries (Edit,
// Write, MultiEdit, NotebookEdit, and shell commands that write files) and asks before inline
// interpreter scripts, whose writes cannot be told from the command line. Designing, asking and
// reading stay free; building waits for the approval that sizing-approval records.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { allowDecision, askDecision, denyDecision } from '../core/hook-io.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import {
  listActivePlans, listPlanRoots, ensureWorkDirectoryIgnored, readApprovals, isPlanApproved, readSessionPlanSlugs, UNAPPROVED_STATUSES,
} from './sizing-work.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { findPlanScenarioViolation } from './sizing-scenarios.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { LATER_DIRECTORY } from '../later/later-documents.mjs';
import { KNOWLEDGE_BUNDLE_PATH, WORK_DIRECTORY } from '../core/config.mjs';

const MODULE_ID = 'sizing-gate';
export const FILE_EDITING_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

// Project-relative paths the tool call would write; paths outside the project are left out.
export function listEditedProjectPaths(hookInput, projectRoot) {
  const toolInput = hookInput.tool_input || {};
  const workingDirectory = hookInput.cwd || projectRoot;
  const candidatePaths = hookInput.tool_name === 'Bash'
    ? listShellWriteTargets(toolInput.command).targetPaths
    : [toolInput.file_path ?? toolInput.notebook_path];
  return candidatePaths
    .map((candidatePath) => projectRelativePath(projectRoot, candidatePath, workingDirectory))
    .filter((relativePath) => relativePath !== null);
}

function isPathInside(relativePath, directoryPath) {
  const directoryPrefix = String(directoryPath).replace(/^\.\//, '').replace(/\/+$/, '');
  return relativePath === directoryPrefix || relativePath.startsWith(`${directoryPrefix}/`);
}

export function findUnapprovedPlan(planRoots, sessionStartMilliseconds, approvals, sessionPlanSlugs = null) {
  return listActivePlans(planRoots, sessionStartMilliseconds, sessionPlanSlugs)
    .find((workPlan) => workPlan.size === 'deep' && (UNAPPROVED_STATUSES.has(workPlan.status) || !isPlanApproved(workPlan, approvals)));
}

// The text a Write, Edit or MultiEdit leaves in a file whose current text is `diskText`.
function applyFileEdit(toolName, toolInput, diskText) {
  if (toolName === 'Write') return String(toolInput.content ?? '');
  const fileEdits = toolName === 'MultiEdit' ? toolInput.edits || [] : [toolInput];
  return fileEdits.reduce((editedText, fileEdit) => {
    const oldString = String(fileEdit?.old_string ?? '');
    const newString = String(fileEdit?.new_string ?? '');
    if (!oldString) return editedText;
    return fileEdit.replace_all ? editedText.split(oldString).join(newString) : editedText.replace(oldString, () => newString);
  }, diskText);
}

function isPlanPath(relativePath) {
  return Boolean(relativePath) && basename(relativePath) === 'plan.md' && dirname(dirname(relativePath)) === WORK_DIRECTORY;
}

// A write to a plan with behaviour scenarios that sets `status: done` by hand or drops an approved
// scenario: the reason to refuse it, or null. Milliseconds: reads only that plan.md.
function findPlanWriteViolation(hookInput, planRoots) {
  if (!['Write', 'Edit', 'MultiEdit'].includes(hookInput.tool_name)) return null;
  const planRoot = planRoots.find((candidateRoot) => isPlanPath(listEditedProjectPaths(hookInput, candidateRoot)[0]));
  if (!planRoot) return null;
  const relativePath = listEditedProjectPaths(hookInput, planRoot)[0];
  const planPath = join(planRoot, relativePath);
  if (!existsSync(planPath)) return null;
  const diskText = readFileSync(planPath, 'utf8');
  return findPlanScenarioViolation(basename(dirname(relativePath)), diskText, applyFileEdit(hookInput.tool_name, hookInput.tool_input || {}, diskText));
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: [...FILE_EDITING_TOOLS, 'Bash'],
  feature: 'sizing',
  description: 'Refuses code edits while a deep design of this session waits for the person\'s approval.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    // A session isolated in a worktree writes its plans there (it cannot write the main checkout); the
    // gate, the approval and `ai1 step-done` read both, and finish or drop moves them home. The
    // worktree's `.ai1/work/` must ignore itself before the first plan, or it would be committed.
    const planRoots = listPlanRoots(projectRoot, sharedRoot);
    if (projectRoot !== sharedRoot && listEditedProjectPaths(hookInput, projectRoot).some((relativePath) => isPathInside(relativePath, WORK_DIRECTORY))) {
      ensureWorkDirectoryIgnored(projectRoot);
    }
    const planWriteViolation = findPlanWriteViolation(hookInput, planRoots);
    if (planWriteViolation) return denyDecision(MODULE_ID, `Deep task: ${planWriteViolation}`);
    // Designing stays free: the work folder, the knowledge bundle and, with the later feature, later entries.
    const designDirectories = [WORK_DIRECTORY, KNOWLEDGE_BUNDLE_PATH, isFeatureEnabled('later', config) && LATER_DIRECTORY].filter(Boolean);
    const editedPaths = listEditedProjectPaths(hookInput, projectRoot)
      .filter((relativePath) => !designDirectories.some((designDirectory) => isPathInside(relativePath, designDirectory)));
    // An inline script (`python3 - <<EOF`, `node -e`) may write any file, and may only read.
    const runsInlineScript = hookInput.tool_name === 'Bash' && listShellWriteTargets(hookInput.tool_input?.command).runsInlineScript;
    if (editedPaths.length === 0 && !runsInlineScript) return allowDecision();
    const sessionBase = readSessionBase(hookInput, sharedRoot, environment);
    const unapprovedPlan = findUnapprovedPlan(planRoots, sessionBase?.sessionStartMilliseconds, readApprovals(sharedRoot, environment),
      readSessionPlanSlugs(hookInput, sharedRoot, environment));
    if (!unapprovedPlan) return allowDecision();
    if (editedPaths.length === 0) {
      return askDecision(MODULE_ID, `Deep task: the design \`${unapprovedPlan.relativePath}\` is not approved yet and this inline script may write project files. Confirm only if it just reads; edits wait for the approval.`);
    }
    return denyDecision(MODULE_ID, [
      `Deep task: the design \`${unapprovedPlan.relativePath}\` (status: ${unapprovedPlan.status}) is not approved by the person yet, so \`${editedPaths[0]}\` cannot be edited.`,
      unapprovedPlan.status === 'ready'
        ? 'Ask the person to approve it (or what to change); their reply unlocks edits.'
        : 'Finish the design, set `status: ready` and ask the person to approve it; their reply unlocks edits.',
      'If the person wants to skip the design, set the plan to `status: abandoned` and say so.',
    ].join(' '));
  },
};
