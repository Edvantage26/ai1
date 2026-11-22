// config-sync-start (SessionStart, core, person-scoped): runs in any folder, with or without ai1 set up
// there, once the person has a config repo (`ai1 config`). Copies to ~/.claude and ~/.config/ai1 what
// changed in the repo, names conflicts, and asks the agent to run `ai1 config sync` when the last sync is
// older than 12 hours (the hook never uses the network: pulling is the CLI's job). Without a config repo,
// tells the person about /ai1:core-setup-config (a message, no agent tokens) at most every 30 days.

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { allowDecision, contextDecision, noticeDecision } from '../core/hook-io.mjs';
import { configRepoDirectory, hasConfigRepo, readConfigState, writeConfigState } from './config-repo.mjs';
import { applyFromRepo, hasRemote, isConfigSyncOn, withConfigLock } from './config-sync.mjs';

const MODULE_ID = 'config-sync-start';
export const SYNC_DUE_MILLISECONDS = 12 * 60 * 60 * 1000;

export function describeStartOutcome(outcome, { syncDue }) {
  const lines = [];
  const applied = (outcome?.done?.length || 0) + (outcome?.settingsDone?.length || 0);
  if (applied) lines.push(`ai1 config: ${applied} change(s) from the person's config repo were copied into place.`);
  const conflictKeys = [...(outcome?.conflicts || []).map((conflict) => conflict.key), ...(outcome?.settingsConflicts || []).map((conflict) => `settings.json "${conflict.key}"`)];
  if (conflictKeys.length) lines.push(`ai1 config: changed both in the config repo and here, left untouched: ${conflictKeys.join(', ')}. Tell the person in one line; \`ai1 config status\` shows them.`);
  if (syncDue) lines.push('ai1 config: the person\'s config repo was not synced for over 12 hours. Run `ai1 config sync` (pull, apply, commit) once at a quiet moment and say what it reported in one line.');
  return lines;
}

export const SETUP_OFFER_INTERVAL_MILLISECONDS = 30 * 24 * 60 * 60 * 1000;
export const SETUP_OFFER = 'your Claude Code config (global CLAUDE.md, user skills, settings, ai1 customizations) is in no config repo: not versioned nor shared between machines. /ai1:core-setup-config keeps it in a private repo that ai1 commits by itself (`ai1 config off` stops this note).';

// No config repo yet: offer the setup at most every 30 days, only when there is something of the
// person's to keep (a global CLAUDE.md or user skills), and never after `ai1 config off`.
function offerSetup(pathOptions) {
  const state = readConfigState(pathOptions);
  if (state.off === true) return allowDecision();
  const claudeDirectory = join(pathOptions.homeDirectory, '.claude');
  const hasOwnConfig = existsSync(join(claudeDirectory, 'CLAUDE.md')) || (existsSync(join(claudeDirectory, 'skills')) && readdirSync(join(claudeDirectory, 'skills')).some((entryName) => !['synced', '.trash'].includes(entryName)));
  if (!hasOwnConfig) return allowDecision();
  const lastOfferAt = Date.parse(state.setupOfferedAt || '') || 0;
  if (Date.now() - lastOfferAt < SETUP_OFFER_INTERVAL_MILLISECONDS) return allowDecision();
  writeConfigState({ ...state, setupOfferedAt: new Date().toISOString() }, pathOptions);
  return noticeDecision(MODULE_ID, SETUP_OFFER);
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'core',
  personScoped: true,
  description: 'Copies into place what changed in the person\'s config repo, names conflicts, and asks for `ai1 config sync` when it is over 12 hours old.',
  run({ environment, homeDirectory }) {
    const pathOptions = { environment: environment || process.env, homeDirectory: homeDirectory || homedir() };
    if (!hasConfigRepo(pathOptions)) return offerSetup(pathOptions);
    if (!isConfigSyncOn(pathOptions)) return allowDecision();
    const locked = withConfigLock(pathOptions, () => ({ outcome: applyFromRepo(pathOptions) }));
    const lastSyncAt = Date.parse(readConfigState(pathOptions).lastSyncAt || '') || 0;
    const syncDue = hasRemote(configRepoDirectory(pathOptions)) && Date.now() - lastSyncAt > SYNC_DUE_MILLISECONDS;
    const lines = describeStartOutcome(locked.locked ? locked.outcome : null, { syncDue });
    return lines.length ? contextDecision(MODULE_ID, lines.join('\n')) : allowDecision();
  },
};
