// worktree-recipe-offer (Stop, feature `worktrees`): when the repo has no worktree recipe and this
// session changed files in the main checkout (by any tool, shell edits included: it reads git, not
// the tool calls), asks the agent once per session to offer /ai1:worktrees-plan-recipe in one line.
// The SessionStart brief alone is forgotten by the time the first edit comes.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, claimStopBlock } from '../core/session-state.mjs';
import { loadRecipe } from './worktree-recipe.mjs';

const MODULE_ID = 'worktree-recipe-offer';
const MAX_BLOCKS_PER_SESSION = 1;
const MAX_LISTED_FILES = 5;

export function buildRecipeOffer(changedPaths) {
  const listedFiles = changedPaths.slice(0, MAX_LISTED_FILES).map((changedPath) => `\`${changedPath}\``).join(', ')
    + (changedPaths.length > MAX_LISTED_FILES ? ` and ${changedPaths.length - MAX_LISTED_FILES} more` : '');
  return `Worktrees: this session changed files in the main checkout (${listedFiles}) and the repo has no worktree recipe yet. `
    + 'Offer the person in one line to plan it with /ai1:worktrees-plan-recipe, so the next changes go to a worktree, and finish.';
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'worktrees',
  description: 'Reminds once, at stop, to offer planning the worktree recipe when the session changed files in the main checkout of a repo without one.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    if (projectRoot !== sharedRoot) return allowDecision();
    if (loadRecipe(sharedRoot).status !== 'missing') return allowDecision();
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const changedPaths = listFilesChangedSinceBase(projectRoot, sessionBase.baseHead)
      .filter((changedPath) => existsSync(join(projectRoot, changedPath)))
      .filter((changedPath) => statSync(join(projectRoot, changedPath)).mtimeMs >= sessionBase.sessionStartMilliseconds)
      .sort();
    if (!changedPaths.length) return allowDecision();
    const blockStatePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'worktree-recipe-offered');
    if (!claimStopBlock(blockStatePath, changedPaths.join('\n'), MAX_BLOCKS_PER_SESSION)) return allowDecision();
    return blockDecision(MODULE_ID, buildRecipeOffer(changedPaths));
  },
};
