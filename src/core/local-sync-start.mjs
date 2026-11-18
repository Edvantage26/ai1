// local-sync-start (SessionStart, core): when the person's sealed copy of .ai1/local/ in the repo changed
// since the last sync (a pull from another machine), unseals it into .ai1/local/. A conflict, a missing
// key or a key that does not open it is told to the person once, as a message (no agent tokens).
// See src/core/person-seal.mjs.

import { homedir } from 'node:os';
import { allowDecision, noticeDecision } from './hook-io.mjs';
import { readGitUserEmail } from './person-project.mjs';
import { mayUseSealedSync, syncLocalFilesAtStart } from './person-seal.mjs';

const MODULE_ID = 'local-sync-start';

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'core',
  description: 'Unseals the person\'s sealed .ai1/local/ when a newer copy arrived in the repo; tells them once about a conflict or a missing key.',
  run({ projectRoot, sharedRoot, environment, homeDirectory }) {
    if (!mayUseSealedSync(projectRoot, sharedRoot || projectRoot)) return allowDecision();
    const syncOutcome = syncLocalFilesAtStart({
      repoRoot: projectRoot,
      sharedRoot: sharedRoot || projectRoot,
      personEmail: readGitUserEmail(projectRoot),
      pathOptions: { environment, homeDirectory: homeDirectory || homedir() },
    });
    return syncOutcome.action === 'notice' ? noticeDecision(MODULE_ID, syncOutcome.text) : allowDecision();
  },
};
