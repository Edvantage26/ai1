// worktree-brief (SessionStart, feature `worktrees`): tells the agent how this repo works with
// worktrees. Without a recipe it points to /ai1:worktrees-plan-recipe to plan one; with a recipe it says to do
// each significant change in its own worktree, following the project skill; inside a worktree it
// names it, and asks to mention it in every progress report. Byte-stable within a session.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { readGitDirectories } from '../core/project-roots.mjs';
import { loadRecipe, RECIPE_RELATIVE_PATH } from './worktree-recipe.mjs';
import { listWorktreeStates } from './worktree-state.mjs';

const MODULE_ID = 'worktree-brief';

export function findSessionWorktree(projectRoot, sharedRoot) {
  if (projectRoot === sharedRoot) return null;
  const commonDirectory = readGitDirectories(sharedRoot)?.commonDirectory;
  if (!commonDirectory) return null;
  return listWorktreeStates(commonDirectory).find((worktreeState) => worktreeState.path === projectRoot)
    ?? { name: projectRoot.split(/[\\/]/).pop(), path: projectRoot, branch: null, mode: null, port: null, external: true };
}

export function describeSessionWorktree(sessionWorktree) {
  const detailParts = [
    sessionWorktree.branch ? `branch \`${sessionWorktree.branch}\`` : null,
    sessionWorktree.mode ? `mode ${sessionWorktree.mode}` : null,
    sessionWorktree.port ? `port ${sessionWorktree.port}` : null,
  ].filter(Boolean);
  return `worktree \`${sessionWorktree.name}\` (${sessionWorktree.path}${detailParts.length ? `; ${detailParts.join(', ')}` : ''})`;
}

export function buildWorktreeRules() {
  return [
    'Worktrees: do each significant change (a plan or deep task, several files, anything with a build) in its own worktree, following the project skill `/worktree` (its rules win over these). Propose it once, in one line, with a suggested name; the person decides.',
    '- Create: `ai1 worktree create <name>` (mode auto by default), then enter it with EnterWorktree and the printed path; run what it lists under "next" (`ai1 worktree run <name> setup`).',
    '- Work only inside the worktree; run project steps with `ai1 worktree run <name> <command>` (env and port applied).',
    '- Start every progress report with one line naming the worktree you work in.',
    '- Close: when the person approves, `ai1 worktree finish <name>` (integrates into the base after its checks; it asks the person) or `ai1 worktree drop <name> --confirm` to abandon. `ai1 worktree list` shows them all.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'worktrees',
  description: 'Tells the agent to do significant changes in a worktree following the project recipe, or to plan the recipe with /ai1:worktrees-plan-recipe.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot }) {
    if (hookInput.source === 'resume') return allowDecision();
    const loadedRecipe = loadRecipe(sharedRoot);
    if (loadedRecipe.status === 'missing') {
      return contextDecision(MODULE_ID, `Worktrees feature is on but this repo has no worktree recipe (${RECIPE_RELATIVE_PATH}). Before the first significant change, offer the person to plan it with /ai1:worktrees-plan-recipe (one line); until then, work as usual.`);
    }
    if (loadedRecipe.status === 'invalid') {
      return contextDecision(MODULE_ID, `The worktree recipe ${RECIPE_RELATIVE_PATH} is invalid: ${loadedRecipe.errors.join('; ')}. Tell the person; /ai1:worktrees-plan-recipe revisar can fix it.`);
    }
    const contextParts = [buildWorktreeRules()];
    const sessionWorktree = findSessionWorktree(projectRoot, sharedRoot);
    if (sessionWorktree) contextParts.push(`This session works in ${describeSessionWorktree(sessionWorktree)}.`);
    return contextDecision(MODULE_ID, contextParts.join('\n\n'));
  },
};
