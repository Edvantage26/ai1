// local-sync-stop (Stop, core): when the person's .ai1/local/ files changed since the last sync, seals them
// again into .ai1/contributors/<email>.sealed (left for them to commit; ai1 never commits). A conflict is
// told to the person once, as a message (no agent tokens). See src/core/person-seal.mjs.

import { homedir } from 'node:os';
import { allowDecision, noticeDecision } from './hook-io.mjs';
import { readGitUserEmail } from './person-project.mjs';
import { mayUseSealedSync, syncLocalFilesAtStop } from './person-seal.mjs';

const MODULE_ID = 'local-sync-stop';

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'core',
  description: 'Seals the person\'s .ai1/local/ again when it changed; tells them once about a conflict.',
  run({ projectRoot, sharedRoot, environment, homeDirectory }) {
    if (!mayUseSealedSync(projectRoot, sharedRoot || projectRoot)) return allowDecision();
    const syncOutcome = syncLocalFilesAtStop({
      repoRoot: projectRoot,
      sharedRoot: sharedRoot || projectRoot,
      personEmail: readGitUserEmail(projectRoot),
      pathOptions: { environment, homeDirectory: homeDirectory || homedir() },
    });
    return syncOutcome.action === 'notice' ? noticeDecision(MODULE_ID, syncOutcome.text) : allowDecision();
  },
};
