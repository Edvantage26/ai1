#!/usr/bin/env node
// Single entry point for every ai1 hook: `node bin/ai1-hook.mjs <EventName>`, with the hook
// input JSON on stdin. Always exits 0; the decision travels in the JSON printed on stdout.

import { readHookInput } from '../src/core/hook-io.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';

const eventName = process.argv[2];

try {
  const hookInput = await readHookInput();
  const hookOutput = runHookEvent(eventName || hookInput.hook_event_name, hookInput);
  if (hookOutput) process.stdout.write(JSON.stringify(hookOutput));
} catch (hookError) {
  process.stderr.write(`ai1: hook ${eventName} failed open: ${hookError.stack || hookError}\n`);
}
process.exit(0);
