// runHookEvent: dispatches a hook event with every module loaded, for in-process callers (tests,
// the CLI). The hook entry point (bin/ai1-hook.mjs) calls dispatchHookEvent with only the modules
// of its event instead.

import { dispatchHookEvent } from './hook-dispatch.mjs';
import { ALL_MODULES } from './registry.mjs';

// availableModules: the modules to consider, loaded (default: all of them).
export function runHookEvent(eventName, hookInput, { availableModules = ALL_MODULES, ...dispatchOptions } = {}) {
  return dispatchHookEvent(eventName, hookInput, { ...dispatchOptions, moduleDefinitions: availableModules, runnableModules: availableModules });
}
