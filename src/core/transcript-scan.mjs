// Incremental reading of the session transcript (JSONL, tens of MB in long sessions).
// `scanState.offset` keeps the byte offset already read, so each call only parses what was
// appended since. Only complete lines are read; a line still being written comes next time.
// Only lines containing one of `markers` are parsed, which keeps the scan cheap.

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export const TOOL_USE_MARKER = '"type":"tool_use"';
export const TOOL_RESULT_MARKER = '"type":"tool_result"';
// Copies of the API request Claude Code also writes to the transcript: the same tool calls again,
// without a timestamp. Counting them would see every call twice.
const REQUEST_COPY_EVENT_TYPES = new Set(['api-request-blob']);

// Returns { events, restarted } (restarted: the transcript was replaced or truncated, so callers
// must drop what they had accumulated), or null when the transcript is not available.
export function readNewTranscriptEvents(transcriptPath, scanState, markers = [TOOL_USE_MARKER]) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const transcriptSize = statSync(transcriptPath).size;
  const startOffset = (scanState.offset || 0) <= transcriptSize ? (scanState.offset || 0) : 0;
  const transcriptDescriptor = openSync(transcriptPath, 'r');
  let appendedText;
  try {
    const appendedBytes = Buffer.alloc(transcriptSize - startOffset);
    readSync(transcriptDescriptor, appendedBytes, 0, appendedBytes.length, startOffset);
    appendedText = appendedBytes.toString('utf8');
  } finally {
    closeSync(transcriptDescriptor);
  }
  const lastNewlineIndex = appendedText.lastIndexOf('\n');
  const completeText = lastNewlineIndex >= 0 ? appendedText.slice(0, lastNewlineIndex + 1) : '';
  const events = [];
  for (const transcriptLine of completeText.split('\n')) {
    if (!markers.some((marker) => transcriptLine.includes(marker))) continue;
    try {
      const transcriptEvent = JSON.parse(transcriptLine);
      if (!REQUEST_COPY_EVENT_TYPES.has(transcriptEvent?.type)) events.push(transcriptEvent);
    } catch {
      // Not a JSON event line: ignore.
    }
  }
  scanState.offset = startOffset + Buffer.byteLength(completeText, 'utf8');
  return { events, restarted: startOffset === 0 };
}

// The content blocks of one transcript event, e.g. tool_use or tool_result blocks.
export function eventContentBlocks(transcriptEvent, blockType) {
  const contentBlocks = transcriptEvent?.message?.content;
  return Array.isArray(contentBlocks) ? contentBlocks.filter((contentBlock) => contentBlock?.type === blockType) : [];
}

// A prompt the person typed: a user event that is not a tool result and not text injected by
// Claude Code (skill bodies, reminders: `isMeta`).
export function isPersonPromptEvent(transcriptEvent) {
  if (transcriptEvent?.type !== 'user' || transcriptEvent.isMeta) return false;
  const messageContent = transcriptEvent.message?.content;
  if (typeof messageContent === 'string') return true;
  return Array.isArray(messageContent)
    && messageContent.some((contentBlock) => contentBlock?.type === 'text')
    && !messageContent.some((contentBlock) => contentBlock?.type === 'tool_result');
}

// The events of the agent's last turn: what follows the person's last prompt, read from the end of
// the transcript. The prompt being submitted may already be written: a prompt with nothing after it
// is skipped. A turn longer than the tail read is cut at its start. Null without a transcript.
export function readLastAgentTurnEvents(transcriptPath, tailBytes = 4 * 1024 * 1024) {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const transcriptSize = statSync(transcriptPath).size;
  const scanState = { offset: Math.max(0, transcriptSize - tailBytes) };
  const tailEvents = readNewTranscriptEvents(transcriptPath, scanState, ['"type":"user"', '"type":"assistant"'])?.events ?? [];
  let turnEnd = tailEvents.length;
  while (turnEnd > 0 && isPersonPromptEvent(tailEvents[turnEnd - 1])) turnEnd -= 1;
  let turnStart = turnEnd;
  while (turnStart > 0 && !isPersonPromptEvent(tailEvents[turnStart - 1])) turnStart -= 1;
  return tailEvents.slice(turnStart, turnEnd);
}
