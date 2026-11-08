// Incremental reading of the session transcript (JSONL, tens of MB in long sessions).
// `scanState.offset` keeps the byte offset already read, so each call only parses what was
// appended since. Only complete lines are read; a line still being written comes next time.
// Only lines containing one of `markers` are parsed, which keeps the scan cheap.

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

export const TOOL_USE_MARKER = '"type":"tool_use"';
export const TOOL_RESULT_MARKER = '"type":"tool_result"';

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
      events.push(JSON.parse(transcriptLine));
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
