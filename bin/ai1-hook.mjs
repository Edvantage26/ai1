#!/usr/bin/env node
// Single entry point for every ai1 hook: `node bin/ai1-hook.mjs <EventName>`, with the hook
// input JSON on stdin. Always exits 0; the decision travels in the JSON printed on stdout.
// Imports only the modules of this event: a tool call pays for one or two modules, not all of them.

import { readHookInput } from '../src/core/hook-io.mjs';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { loadModulesForEvent } from '../src/core/module-index.mjs';
import { appendDecisionLog, errorSignature } from '../src/core/decision-log.mjs';
import { recordPendingErrors } from '../src/core/pending-errors.mjs';
import { resolveProjectRoots } from '../src/core/project-roots.mjs';
import { runSessionStartMigrations } from '../src/core/migrations.mjs';

const eventName = process.argv[2];

let hookInput = {};
try {
  hookInput = await readHookInput();
  const resolvedEventName = eventName || hookInput.hook_event_name;
  // Migrations first, so this session already reads the new names (src/core/migrations.mjs).
  const migrationNotice = resolvedEventName === 'SessionStart' ? runSessionStartMigrations(hookInput) : null;
  const runnableModules = await loadModulesForEvent(resolvedEventName, hookInput.tool_name);
  const hookOutput = dispatchHookEvent(resolvedEventName, hookInput, { runnableModules, migrationNotice });
  if (hookOutput) process.stdout.write(JSON.stringify(hookOutput));
} catch (hookError) {
  process.stderr.write(`ai1: hook ${eventName} failed open: ${hookError.stack || hookError}\n`);
  // A crash of ai1 itself goes to the decision log too, so it can be offered as an issue.
  try {
    const { sharedRoot } = resolveProjectRoots(hookInput || {});
    const crashEntries = [{ at: new Date().toISOString(), session: hookInput?.session_id, event: eventName, module: 'entrypoint', decision: 'error', error: errorSignature(hookError) }];
    appendDecisionLog(crashEntries, sharedRoot);
    recordPendingErrors(crashEntries, sharedRoot);
  } catch {
    // Nothing more to do: the hook already failed open.
  }
}
process.exit(0);
