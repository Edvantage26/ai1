// worktree-brief (SessionStart, feature `worktrees`): tells the agent how this repo works with
// worktrees: any change to the repo's files happens in a worktree (created before the first edit), made
// with the basic recipe ai1 works out from the repo plus the project recipe when there is one, which
// the agent itself completes when the basic recipe falls short; inside a worktree it names it, and asks
// to mention it in every progress report. Byte-stable within a session.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
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

// The rules only; the how is in `ai1 worktree` (its usage line and what create prints under "next")
// and in /ai1:worktrees-plan-recipe, which `ai1 worktree` names when the recipe falls short.
export function buildWorktreeRules(hasProjectSkill = false) {
  return [
    `Worktrees: any change to the files of this repo happens in a worktree, never in the main checkout${hasProjectSkill ? ', following the project skill `/worktree` (its rules win over these)' : ''}. If the task needs edits and this session is not in a worktree, create one before the first edit and tell the person its name in one line; questions and research without edits need none.`,
    '- `ai1 worktree create <name>`, then EnterWorktree with the printed path and run what it lists under "next"; work and run project steps only inside it (`ai1 worktree run <name> <command>`). Inside, edit with Edit/Write (Claude Code refuses heredocs or sed programs naming git).',
    '- Start every progress report with one line naming the worktree you work in.',
    '- Close it yourself, without asking, once the work is done and verified: commit in its branch and `ai1 worktree finish <name>` (nothing is pushed), or `ai1 worktree drop <name> --confirm`.',
    `- When \`ai1 worktree\` reports a gap in the recipe or a step was done by hand, add the fix to ${RECIPE_RELATIVE_PATH} yourself (/ai1:worktrees-plan-recipe) and say it in one line; propose it first when it would share a folder that holds state or delete data.`,
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
    const contextParts = [buildWorktreeRules(existsSync(join(sharedRoot, '.claude', 'skills', 'worktree', 'SKILL.md')))];
    const sessionWorktree = findSessionWorktree(projectRoot, sharedRoot);
    if (sessionWorktree) contextParts.push(`This session works in ${describeSessionWorktree(sessionWorktree)}.`);
    return contextDecision(MODULE_ID, contextParts.join('\n\n'));
  },
};
