// reuse-check (Stop, feature `reuse`): after real work - `minToolCalls` tool calls or more since the
// last check, counted across turns from the session transcript (incremental read) - asks the agent once
// to judge in one line whether this work will be asked again in this repo, and to search this repo's
// history (`ai1 reuse search`) or propose encapsulating it accordingly. The count restarts after each
// check; at most `MAX_CHECKS_PER_SESSION` per session. No model, no network: the judgment is the agent's.
//
// Options (modules.reuse-check): minToolCalls (default 8).

import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { resolveStateDirectory, sessionStatePath, readStateJson, writeStateText } from '../core/session-state.mjs';
import { readNewTranscriptEvents, eventContentBlocks } from '../core/transcript-scan.mjs';

const MODULE_ID = 'reuse-check';
const DEFAULT_MIN_TOOL_CALLS = 8;
const MAX_CHECKS_PER_SESSION = 2;

export function buildReuseCheckReason(toolCallCount) {
  return [
    `Reuse: this task took ${toolCallCount} tool calls. Judge silently whether this kind of work will be asked again in this repo:`,
    '- low (a one-off bug, exploration, something only this change needs): finish without writing anything about it; the person never hears about a reuse check that found nothing;',
    '- medium (a procedure you had to figure out that is not tied to this change): run `ai1 reuse search "<3-5 keywords>"` and propose only if it was done before here or a project skill, command or MCP server already covers part of it; otherwise finish without a word about it;',
    '- high (the person said "otra vez", "como la última vez", "cada vez que"; setting up the same thing again; operating an external system step by step): propose directly.',
    'A proposal is one line at the end of your report, with its evidence and the container you recommend (a rule, hook, script, skill, MCP entry, or completing or merging an existing one): "Esto se repite (N veces en este repo). Recomiendo encapsularlo como <x>." A yes means you load /ai1:reuse-encapsulate; a no means `ai1 reuse dismiss <slug> --keywords "<words>" "<why>"`. Never propose what `ai1 reuse search` reports as dismissed.',
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'reuse',
  description: 'After 8 or more tool calls since the last check, asks once to judge whether the work will recur in this repo and to search its history or propose encapsulating it.',
  run({ hookInput, projectRoot, environment, moduleOptions }) {
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'reuse-check');
    const checkState = { offset: 0, toolCallsSinceCheck: 0, checks: 0, ...readStateJson(statePath) };
    const newTranscript = readNewTranscriptEvents(hookInput.transcript_path, checkState);
    if (!newTranscript) return allowDecision();
    if (newTranscript.restarted) checkState.toolCallsSinceCheck = 0;
    checkState.toolCallsSinceCheck += newTranscript.events.reduce((total, transcriptEvent) => total + eventContentBlocks(transcriptEvent, 'tool_use').length, 0);
    const minToolCalls = moduleOptions.minToolCalls ?? DEFAULT_MIN_TOOL_CALLS;
    const shouldCheck = checkState.toolCallsSinceCheck >= minToolCalls && checkState.checks < MAX_CHECKS_PER_SESSION;
    const toolCallCount = checkState.toolCallsSinceCheck;
    if (shouldCheck) {
      checkState.checks += 1;
      checkState.toolCallsSinceCheck = 0;
    }
    writeStateText(statePath, JSON.stringify(checkState));
    return shouldCheck ? blockDecision(MODULE_ID, buildReuseCheckReason(toolCallCount)) : allowDecision();
  },
};
