// Every ai1 module loaded, for in-process callers that run any event (tests, the CLI). The hook
// entry point loads only the modules of its event instead (see module-index.mjs, the list).

import { MODULE_INDEX, KNOWN_MODULE_IDS, modulesForEvent, loadModule } from './module-index.mjs';

export const ALL_MODULES = await Promise.all(MODULE_INDEX.map(loadModule));

export { KNOWN_MODULE_IDS, modulesForEvent };
