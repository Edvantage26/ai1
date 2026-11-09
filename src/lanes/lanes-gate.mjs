// lanes-gate (PreToolUse, feature `lanes`): while a deep-lane design of this session is not approved
// by the person, refuses edits to project files outside `.ai1/`, the knowledge bundle and proposals (Edit,
// Write, MultiEdit, NotebookEdit, and shell commands that write files) and asks before inline
// interpreter scripts, whose writes cannot be told from the command line. Designing, asking and
// reading stay free; building waits for the approval that lanes-approval records.

import { join } from 'node:path';
import { allowDecision, askDecision, denyDecision } from '../core/hook-io.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import {
  listActivePlans, readApprovals, isPlanApproved, readSessionPlanSlugs, UNAPPROVED_STATUSES,
} from './lanes-work.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { PROPOSALS_DIRECTORY } from '../proposals/proposals-documents.mjs';
import { KNOWLEDGE_BUNDLE_PATH, WORK_DIRECTORY } from '../core/config.mjs';

const MODULE_ID = 'lanes-gate';
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

export function findUnapprovedPlan(projectRoot, sessionStartMilliseconds, approvals, sessionPlanSlugs = null) {
  return listActivePlans(projectRoot, sessionStartMilliseconds, sessionPlanSlugs)
    .find((workPlan) => UNAPPROVED_STATUSES.has(workPlan.status) || !isPlanApproved(workPlan, approvals));
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: [...FILE_EDITING_TOOLS, 'Bash'],
  feature: 'lanes',
  description: 'Refuses code edits while a deep-lane design of this session waits for the person\'s approval.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    // Plans live in the main checkout, where this gate, the approval and `ai1 step-done` read them; one
    // written inside a worktree would be invisible to all three, so the design would never be gated.
    const misplacedPlanPath = projectRoot !== sharedRoot
      && listEditedProjectPaths(hookInput, projectRoot).find((relativePath) => isPathInside(relativePath, WORK_DIRECTORY));
    if (misplacedPlanPath) {
      return denyDecision(MODULE_ID, `Work plans live in the main checkout, not in a worktree: write \`${join(sharedRoot, misplacedPlanPath)}\` instead of \`${misplacedPlanPath}\` here. The design gate, the approval and \`ai1 step-done\` only read it there.`);
    }
    // Designing stays free: the work folder, the knowledge bundle and, with the proposals feature, proposals.
    const designDirectories = [WORK_DIRECTORY, KNOWLEDGE_BUNDLE_PATH, isFeatureEnabled('proposals', config) && PROPOSALS_DIRECTORY].filter(Boolean);
    const editedPaths = listEditedProjectPaths(hookInput, projectRoot)
      .filter((relativePath) => !designDirectories.some((designDirectory) => isPathInside(relativePath, designDirectory)));
    // An inline script (`python3 - <<EOF`, `node -e`) may write any file, and may only read.
    const runsInlineScript = hookInput.tool_name === 'Bash' && listShellWriteTargets(hookInput.tool_input?.command).runsInlineScript;
    if (editedPaths.length === 0 && !runsInlineScript) return allowDecision();
    const sessionBase = readSessionBase(hookInput, sharedRoot, environment);
    const unapprovedPlan = findUnapprovedPlan(sharedRoot, sessionBase?.sessionStartMilliseconds, readApprovals(sharedRoot, environment),
      readSessionPlanSlugs(hookInput, sharedRoot, environment));
    if (!unapprovedPlan) return allowDecision();
    if (editedPaths.length === 0) {
      return askDecision(MODULE_ID, `Deep lane: the design \`${unapprovedPlan.relativePath}\` is not approved yet and this inline script may write project files. Confirm only if it just reads; edits wait for the approval.`);
    }
    return denyDecision(MODULE_ID, [
      `Deep lane: the design \`${unapprovedPlan.relativePath}\` (status: ${unapprovedPlan.status}) is not approved by the person yet, so \`${editedPaths[0]}\` cannot be edited.`,
      unapprovedPlan.status === 'ready'
        ? 'Ask the person to approve it (or what to change); their reply unlocks edits.'
        : 'Finish the design, set `status: ready` and ask the person to approve it; their reply unlocks edits.',
      'If the person wants to skip the design, set the plan to `status: abandoned` and say so.',
    ].join(' '));
  },
};
