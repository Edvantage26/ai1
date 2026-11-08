// lanes-gate (PreToolUse, feature `lanes`): while a deep-lane design of this session is not approved
// by the person, refuses edits to project files outside `.jig/`, the knowledge bundle and RFCs (Edit,
// Write, MultiEdit, NotebookEdit, and shell commands that write files). Designing, asking and
// reading stay free; building waits for the approval that lanes-approval records.

import { allowDecision, denyDecision } from '../core/hook-io.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import {
  listActivePlans, readApprovals, isPlanApproved, UNAPPROVED_STATUSES, JIG_DIRECTORY,
} from './lanes-work.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { RFC_DIRECTORY } from '../rfc/rfc-documents.mjs';

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

export function findUnapprovedPlan(projectRoot, sessionStartMilliseconds, approvals) {
  return listActivePlans(projectRoot, sessionStartMilliseconds)
    .find((workPlan) => UNAPPROVED_STATUSES.has(workPlan.status) || !isPlanApproved(workPlan, approvals));
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: [...FILE_EDITING_TOOLS, 'Bash'],
  feature: 'lanes',
  description: 'Refuses code edits while a deep-lane design of this session waits for the person\'s approval.',
  run({ hookInput, config, projectRoot, sharedRoot = projectRoot, environment }) {
    // Designing stays free: the work folder, the knowledge bundle and, with the rfc feature, RFCs.
    const designDirectories = [JIG_DIRECTORY, config.knowledge, isFeatureEnabled('rfc', config) && RFC_DIRECTORY].filter(Boolean);
    const editedPaths = listEditedProjectPaths(hookInput, projectRoot)
      .filter((relativePath) => !designDirectories.some((designDirectory) => isPathInside(relativePath, designDirectory)));
    if (editedPaths.length === 0) return allowDecision();
    const sessionBase = readSessionBase(hookInput, sharedRoot, environment);
    const unapprovedPlan = findUnapprovedPlan(sharedRoot, sessionBase?.sessionStartMilliseconds, readApprovals(sharedRoot, environment));
    if (!unapprovedPlan) return allowDecision();
    return denyDecision(MODULE_ID, [
      `Deep lane: the design \`${unapprovedPlan.relativePath}\` (status: ${unapprovedPlan.status}) is not approved by the person yet, so \`${editedPaths[0]}\` cannot be edited.`,
      unapprovedPlan.status === 'ready'
        ? 'Ask the person to approve it (or what to change); their reply unlocks edits.'
        : 'Finish the design, set `status: ready` and ask the person to approve it; their reply unlocks edits.',
      'If the person wants to skip the design, set the plan to `status: abandoned` and say so.',
    ].join(' '));
  },
};
