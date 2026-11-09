// worktree-reminder (UserPromptSubmit, feature `worktrees`): one line with the active worktrees
// when they change and every `reminder_every` prompts (recipe), marking the one this session works
// in, so the agent keeps telling the person where it is developing. Silent when there are none.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { readGitDirectories } from '../core/project-roots.mjs';
import { resolveStateDirectory, sessionStatePath, writeStateText, readStateJson } from '../core/session-state.mjs';
import { loadRecipe } from './worktree-recipe.mjs';
import { listWorktreeStates } from './worktree-state.mjs';

const MODULE_ID = 'worktree-reminder';

export function describeActiveWorktrees(worktreeStates, projectRoot) {
  const worktreeTexts = worktreeStates.map((worktreeState) => {
    const detailText = [worktreeState.branch, worktreeState.mode, worktreeState.port ? `port ${worktreeState.port}` : null].filter(Boolean).join(', ');
    return `${worktreeState.name} (${detailText})${worktreeState.path === projectRoot ? ' <- this session' : ''}`;
  });
  const sessionInWorktree = worktreeStates.some((worktreeState) => worktreeState.path === projectRoot);
  return `[ai1 worktrees] Active: ${worktreeTexts.join('; ')}.${sessionInWorktree ? ' Start your reply with one line naming this session\'s worktree.' : ' Worktrees not marked are from other sessions.'}`;
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'worktrees',
  description: 'Reminds the active worktrees when they change and every few prompts, marking the one this session works in.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    const loadedRecipe = loadRecipe(sharedRoot);
    if (loadedRecipe.status !== 'ok') return allowDecision();
    const commonDirectory = readGitDirectories(sharedRoot)?.commonDirectory;
    if (!commonDirectory) return allowDecision();
    const worktreeStates = listWorktreeStates(commonDirectory);
    const snapshotText = worktreeStates.map((worktreeState) => `${worktreeState.name}@${worktreeState.path === projectRoot ? 'here' : 'other'}`).join(',');
    const reminderStatePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, sharedRoot, 'worktree-reminder');
    const reminderState = { prompts: 0, snapshot: '', ...readStateJson(reminderStatePath) };
    const promptCount = reminderState.prompts + 1;
    writeStateText(reminderStatePath, JSON.stringify({ prompts: promptCount, snapshot: snapshotText }));
    if (worktreeStates.length === 0) {
      return reminderState.snapshot ? contextDecision(MODULE_ID, '[ai1 worktrees] No active worktrees now.') : allowDecision();
    }
    const reminderEvery = loadedRecipe.recipe.reminder_every;
    const isPeriodicTurn = reminderEvery > 0 && promptCount % reminderEvery === 0;
    if (snapshotText === reminderState.snapshot && !isPeriodicTurn) return allowDecision();
    return contextDecision(MODULE_ID, describeActiveWorktrees(worktreeStates, projectRoot));
  },
};
