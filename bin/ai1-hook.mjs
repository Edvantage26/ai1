#!/usr/bin/env node
// Single entry point for every ai1 hook: `node bin/ai1-hook.mjs <EventName>`, with the hook
// input JSON on stdin. Always exits 0; the decision travels in the JSON printed on stdout.
// Imports only the modules of this event: a tool call pays for one or two modules, not all of them.

import { readHookInput } from '../src/core/hook-io.mjs';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { loadModulesForEvent } from '../src/core/module-index.mjs';

const eventName = process.argv[2];

try {
  const hookInput = await readHookInput();
  const resolvedEventName = eventName || hookInput.hook_event_name;
  const runnableModules = await loadModulesForEvent(resolvedEventName, hookInput.tool_name);
  const hookOutput = dispatchHookEvent(resolvedEventName, hookInput, { runnableModules });
  if (hookOutput) process.stdout.write(JSON.stringify(hookOutput));
} catch (hookError) {
  process.stderr.write(`ai1: hook ${eventName} failed open: ${hookError.stack || hookError}\n`);
}
process.exit(0);
