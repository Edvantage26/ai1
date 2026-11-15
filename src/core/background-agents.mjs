// Agents the session launched in the background that have not reported back yet, read from the
// transcript: the Agent tool's "Async agent launched" result adds its tool_use_id, a
// `<task-notification>` carrying that `<tool-use-id>` with a finished `<status>` removes it (seen in real
// transcripts on 2026-11-15). Stop hooks that ask the agent to wrap up (okf-upkeep, reuse-check) wait
// while any is pending: the session has stopped only to wait for their reports.

import { TOOL_RESULT_MARKER, eventContentBlocks } from './transcript-scan.mjs';

const BACKGROUND_LAUNCH_TEXT = 'Async agent launched successfully';
export const TASK_NOTIFICATION_MARKER = '<task-notification>';
const TASK_NOTIFICATION_PATTERN = /<task-notification>[\s\S]*?<tool-use-id>([^<]+)<\/tool-use-id>[\s\S]*?<status>([^<]+)<\/status>/g;
const FINISHED_TASK_STATUSES = new Set(['completed', 'failed', 'killed', 'cancelled', 'error', 'stopped']);
// The transcript lines a caller must read for this (pass them to readNewTranscriptEvents).
export const BACKGROUND_AGENT_MARKERS = [TOOL_RESULT_MARKER, TASK_NOTIFICATION_MARKER];

function resultText(resultBlock) {
  const resultContent = resultBlock?.content;
  if (typeof resultContent === 'string') return resultContent;
  return Array.isArray(resultContent) ? resultContent.map((contentPart) => contentPart?.text || '').join('\n') : '';
}

// The text of a user event (a task notification arrives as plain text or text blocks).
function eventText(transcriptEvent) {
  const messageContent = transcriptEvent?.message?.content;
  if (typeof messageContent === 'string') return messageContent;
  return Array.isArray(messageContent) ? messageContent.filter((contentBlock) => contentBlock?.type === 'text').map((contentBlock) => contentBlock.text || '').join('\n') : '';
}

// The pending tool_use_ids after these events, starting from `pendingIds` (an array from saved state).
export function updatePendingBackgroundAgents(pendingIds, transcriptEvents) {
  const pendingAgents = new Set(pendingIds || []);
  for (const transcriptEvent of transcriptEvents) {
    for (const resultBlock of eventContentBlocks(transcriptEvent, 'tool_result')) {
      if (resultText(resultBlock).includes(BACKGROUND_LAUNCH_TEXT)) pendingAgents.add(resultBlock.tool_use_id);
    }
    for (const notificationMatch of eventText(transcriptEvent).matchAll(TASK_NOTIFICATION_PATTERN)) {
      if (FINISHED_TASK_STATUSES.has(notificationMatch[2])) pendingAgents.delete(notificationMatch[1]);
    }
  }
  return [...pendingAgents];
}
