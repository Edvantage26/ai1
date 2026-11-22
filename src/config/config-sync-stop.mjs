// config-sync-stop (Stop, core, person-scoped): runs in any folder once the person has a config repo.
// Takes into the repo what this session changed in ~/.claude and ~/.config/ai1 (skills, CLAUDE.md,
// settings keys, ai1 customizations, stack) and commits it locally. A file held back because a line looks
// like a secret, or a conflict, is told to the person as a message; nothing else is said. No network:
// pushing is `ai1 config sync`/`push`.

import { homedir } from 'node:os';
import { allowDecision, noticeDecision } from '../core/hook-io.mjs';
import { captureAndCommit, isConfigSyncOn, withConfigLock } from './config-sync.mjs';

const MODULE_ID = 'config-sync-stop';

export function describeStopOutcome(outcome) {
  const lines = [];
  for (const repoPath of outcome?.commit?.heldBack || []) lines.push(`ai1 config: not committed, a line looks like a secret: ${repoPath} (check it; \`ai1 config commit --include ${repoPath}\` if it is not one).`);
  const conflictKeys = [...(outcome?.conflicts || []).map((conflict) => conflict.key), ...(outcome?.settingsConflicts || []).map((conflict) => `settings.json "${conflict.key}"`)];
  if (conflictKeys.length) lines.push(`ai1 config: changed both here and in the config repo, not committed: ${conflictKeys.join(', ')} (\`ai1 config status\`).`);
  return lines;
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'core',
  personScoped: true,
  description: 'Commits into the person\'s config repo what the session changed in their Claude Code config; tells them about a held-back file or a conflict.',
  run({ environment, homeDirectory }) {
    const pathOptions = { environment: environment || process.env, homeDirectory: homeDirectory || homedir() };
    if (!isConfigSyncOn(pathOptions)) return allowDecision();
    const locked = withConfigLock(pathOptions, () => ({ outcome: captureAndCommit(pathOptions) }));
    const lines = locked.locked ? describeStopOutcome(locked.outcome) : [];
    return lines.length ? noticeDecision(MODULE_ID, lines.join('\n')) : allowDecision();
  },
};
