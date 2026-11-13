// worktree-brief (SessionStart, feature `worktrees`): tells the agent how this repo works with
// worktrees: any change to the repo's files happens in a worktree (created before the first edit), made
// with the basic recipe ai1 works out from the repo plus the project overlay when there is one, which
// the agent itself completes when the basic recipe falls short; inside a worktree it names it, and asks
// to mention it in every progress report. Byte-stable within a session.

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
    'Worktrees: any change to the files of this repo happens in a worktree, never in the main checkout, following the project skill `/worktree` when the repo has one (its rules win over these). If the task needs edits and this session is not in a worktree, create one before the first edit and tell the person its name in one line; questions and research without edits need none.',
    '- Create: `ai1 worktree create <name>` (mode auto by default), then enter it with EnterWorktree and the printed path; run what it lists under "next" (`ai1 worktree run <name> setup`).',
    '- Work only inside the worktree; run project steps with `ai1 worktree run <name> <command>` (env and port applied).',
    '- Start every progress report with one line naming the worktree you work in.',
    '- Close: commit in the worktree branch and run `ai1 worktree finish <name>` yourself once the work is done and verified (it integrates into the local base after its checks; nothing is pushed), without asking; `ai1 worktree drop <name> --confirm` to abandon (its commits are kept in a bundle). `ai1 worktree list` shows them all.',
    `- The recipe: ai1 works it out from the repo (base the trunk, ignored .env files copied, installs by lockfile, pre-finish the verify commands); ${RECIPE_RELATIVE_PATH} holds only what this repo does differently. When \`ai1 worktree\` reports something the recipe does not cover, or you had to do a step by hand after creating a worktree, add the fix there yourself (only the fields that differ; /ai1:worktrees-plan-recipe has the format) and say it in one line; propose it first when it would share a folder that holds state or delete data.`,
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'worktrees',
  description: 'Tells the agent to make every change in a worktree following the project recipe, or to plan the recipe with /ai1:worktrees-plan-recipe.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot }) {
    if (hookInput.source === 'resume') return allowDecision();
    const loadedRecipe = loadRecipe(sharedRoot);
    if (loadedRecipe.status === 'invalid') {
      return contextDecision(MODULE_ID, `The worktree recipe ${RECIPE_RELATIVE_PATH} is invalid: ${loadedRecipe.errors.join('; ')}. Tell the person; /ai1:worktrees-plan-recipe revisar can fix it.`);
    }
    const contextParts = [buildWorktreeRules()];
    const sessionWorktree = findSessionWorktree(projectRoot, sharedRoot);
    if (sessionWorktree) contextParts.push(`This session works in ${describeSessionWorktree(sessionWorktree)}.`);
    return contextDecision(MODULE_ID, contextParts.join('\n\n'));
  },
};
