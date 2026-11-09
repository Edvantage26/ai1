// tool-loop (PreToolUse, feature `verify`): when the last `repeat_threshold` tool calls (default 5) are
// the same call with the same input, tells the agent once that it is going round in circles - polling
// by hand or retrying something that fails the same way. Counts every tool from the transcript (read
// incrementally, as fix-loop does) plus the call about to run, so a Read or Grep in between breaks the
// streak. 5, not 3: in Everything Claude Code 3 identical calls among 5 fired on legitimate retries.
// Told once per repeated call; a different call resets it. It never blocks.
// Options (`modules.tool-loop`): repeat_threshold.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { readStateJson, resolveStateDirectory, sessionStatePath, shortHash, writeStateText } from '../core/session-state.mjs';
import { eventContentBlocks, readNewTranscriptEvents, TOOL_USE_MARKER } from '../core/transcript-scan.mjs';

const MODULE_ID = 'tool-loop';
const DEFAULT_REPEAT_THRESHOLD = 5;
const MAX_SHOWN_CALL_CHARACTERS = 120;

// Same tool, same input; a Bash `description` is only a label, so it does not count.
export function toolCallSignature(toolName, toolInput) {
  const { description: _callDescription, ...meaningfulInput } = toolInput || {};
  return `${toolName}:${shortHash(JSON.stringify(meaningfulInput))}`;
}

function describeToolCall(toolName, toolInput) {
  const callSummary = toolInput?.command ?? toolInput?.file_path ?? toolInput?.pattern ?? toolInput?.url ?? '';
  const shownSummary = String(callSummary).length > MAX_SHOWN_CALL_CHARACTERS ? `${String(callSummary).slice(0, MAX_SHOWN_CALL_CHARACTERS)}...` : String(callSummary);
  return shownSummary ? `${toolName}: ${shownSummary}` : toolName;
}

// Adds a call to the ring of recent calls ({ toolUseId, signature }), once per tool use id.
function rememberToolCall(loopState, toolUseId, signature, repeatThreshold) {
  if (toolUseId && loopState.recentCalls.some((recentCall) => recentCall.toolUseId === toolUseId)) return;
  loopState.recentCalls.push({ toolUseId: toolUseId || null, signature });
  loopState.recentCalls = loopState.recentCalls.slice(-repeatThreshold);
}

// Updates loopState: { offset, recentCalls, toldSignature }; returns the repeated signature when the
// agent should be told now, else null.
export function scanToolLoop(hookInput, loopState, repeatThreshold) {
  loopState.recentCalls ||= [];
  const newTranscript = readNewTranscriptEvents(hookInput.transcript_path, loopState, [TOOL_USE_MARKER]);
  if (newTranscript?.restarted) Object.assign(loopState, { recentCalls: [], toldSignature: null });
  for (const transcriptEvent of newTranscript?.events || []) {
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) rememberToolCall(loopState, toolUse.id, toolCallSignature(toolUse.name, toolUse.input), repeatThreshold);
  }
  rememberToolCall(loopState, hookInput.tool_use_id, toolCallSignature(hookInput.tool_name, hookInput.tool_input), repeatThreshold);
  const latestSignature = loopState.recentCalls.at(-1).signature;
  const isLoop = loopState.recentCalls.length >= repeatThreshold && loopState.recentCalls.every((recentCall) => recentCall.signature === latestSignature);
  if (!isLoop) {
    if (loopState.toldSignature !== latestSignature) loopState.toldSignature = null;
    return null;
  }
  if (loopState.toldSignature === latestSignature) return null;
  loopState.toldSignature = latestSignature;
  return latestSignature;
}

export function buildToolLoopReminder(repeatThreshold, toolName, toolInput) {
  return `ai1/tool-loop: the last ${repeatThreshold} tool calls were the same call with the same input (\`${describeToolCall(toolName, toolInput)}\`). If you are waiting for something, wait for it in the background instead of polling by hand; if it keeps giving the same result, repeating it will not change it: stop, look for the cause or tell the person.`;
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
  feature: 'verify',
  description: 'When the last 5 tool calls are the same call with the same input, tells the agent once that it is going round in circles.',
  run({ hookInput, projectRoot, environment, moduleOptions }) {
    const repeatThreshold = Number.isInteger(moduleOptions.repeat_threshold) && moduleOptions.repeat_threshold >= 2 ? moduleOptions.repeat_threshold : DEFAULT_REPEAT_THRESHOLD;
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'tool-loop');
    const loopState = readStateJson(statePath);
    const repeatedSignature = scanToolLoop(hookInput, loopState, repeatThreshold);
    writeStateText(statePath, JSON.stringify(loopState));
    return repeatedSignature ? contextDecision(MODULE_ID, buildToolLoopReminder(repeatThreshold, hookInput.tool_name, hookInput.tool_input)) : allowDecision();
  },
};
