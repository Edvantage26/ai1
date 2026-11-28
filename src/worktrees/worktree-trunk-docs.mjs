// worktree-trunk-docs (PreToolUse, feature `worktrees`): knowledge of what is already done (CLAUDE.md,
// README, docs/, the OKF bundle, later entries) may go straight to the trunk in the main checkout, but
// not by mistake while this session has a worktree open: then that knowledge most likely belongs to the
// worktree's work. The first edit of such a file in the main checkout is refused with the reason; the
// same file again in the session passes (the agent decided it describes the trunk, not the task).
// A session has a worktree when it created it (`created_by_session`, from CLAUDE_CODE_SESSION_ID) or works in it.

import { isAbsolute, relative, resolve } from 'node:path';
import { allowDecision, denyDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { readGitDirectories } from '../core/project-roots.mjs';
import { resolveStateDirectory, sessionStatePath, readStateJson, writeStateText } from '../core/session-state.mjs';
import { KNOWLEDGE_BUNDLE_PATH, LATER_DIRECTORY } from '../core/config.mjs';
import { listWorktreeStates } from './worktree-state.mjs';

const MODULE_ID = 'worktree-trunk-docs';
export const KNOWLEDGE_PATHS = ['CLAUDE.md', 'AGENTS.md', 'README*', 'docs/**', `${KNOWLEDGE_BUNDLE_PATH}/**`, `${LATER_DIRECTORY}/**`];

function relativeInside(parentPath, childPath) {
  const relativePath = relative(parentPath, childPath);
  return relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath) ? relativePath.split('\\').join('/') : null;
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit'],
  feature: 'worktrees',
  description: 'Stops once a knowledge edit (CLAUDE.md, README, docs, the OKF bundle) in the main checkout while this session has a worktree open, so it does not land on the trunk by mistake.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    const filePath = hookInput.tool_input?.file_path;
    if (!filePath) return allowDecision();
    const absolutePath = resolve(hookInput.cwd || projectRoot, filePath);
    const repoPath = relativeInside(sharedRoot, absolutePath);
    if (!repoPath) return allowDecision();
    const commonDirectory = readGitDirectories(sharedRoot)?.commonDirectory;
    if (!commonDirectory) return allowDecision();
    const worktreeStates = listWorktreeStates(commonDirectory);
    if (worktreeStates.some((worktreeState) => relativeInside(worktreeState.path, absolutePath))) return allowDecision();
    const sessionWorktrees = worktreeStates.filter((worktreeState) => (hookInput.session_id && worktreeState.created_by_session === hookInput.session_id) || worktreeState.path === projectRoot);
    if (sessionWorktrees.length === 0 || !matchesAnyGlob(repoPath, KNOWLEDGE_PATHS)) return allowDecision();
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, sharedRoot, MODULE_ID);
    const warnedPaths = readStateJson(statePath, []);
    if (Array.isArray(warnedPaths) && warnedPaths.includes(repoPath)) return allowDecision();
    writeStateText(statePath, JSON.stringify([...(Array.isArray(warnedPaths) ? warnedPaths : []), repoPath]));
    const worktreeNames = sessionWorktrees.map((worktreeState) => `\`${worktreeState.name}\` (${worktreeState.path})`).join(', ');
    return denyDecision(MODULE_ID, `\`${repoPath}\` is in the main checkout (the trunk), but this session has the worktree ${worktreeNames} open. If this knowledge comes from that work, edit the file there. If it describes the trunk as it is, unrelated to that work, repeat the same edit: it will pass, and commit it on the trunk right away.`);
  },
};
