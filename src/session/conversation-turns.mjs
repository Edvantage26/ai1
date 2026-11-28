// The person's turns of a Claude Code conversation, read from its transcript, so a conversation can be
// split after the fact (`ai1 fork split`): each turn carries the id of the last assistant message
// before it, where `claude --resume-session-at` cuts a copy of the conversation.
// Transcripts live in <config dir>/projects/<folder slug>/<session id>.jsonl (config dir:
// CLAUDE_CONFIG_DIR or ~/.claude); entries are chained by `uuid` / `parentUuid`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TURN_PREVIEW_CHARACTERS = 100;

export function findTranscriptPath(sessionId, environment = process.env) {
  const projectsDirectory = join(environment.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
  if (!sessionId || !existsSync(projectsDirectory)) return null;
  for (const folderName of readdirSync(projectsDirectory)) {
    const transcriptPath = join(projectsDirectory, folderName, `${sessionId}.jsonl`);
    if (existsSync(transcriptPath)) return transcriptPath;
  }
  return null;
}

function parseTranscriptEntries(transcriptText) {
  const transcriptEntries = [];
  for (const transcriptLine of transcriptText.split('\n')) {
    if (!transcriptLine.trim()) continue;
    try {
      transcriptEntries.push(JSON.parse(transcriptLine));
    } catch {
      // A line still being written, or not an event: ignore.
    }
  }
  return transcriptEntries;
}

// What the person typed: a user entry of the main chain that is not a tool result nor injected
// by Claude Code (hook feedback and reminders are `isMeta`).
function readPersonText(transcriptEntry) {
  if (transcriptEntry.type !== 'user' || transcriptEntry.isSidechain || transcriptEntry.isMeta) return null;
  const messageContent = transcriptEntry.message?.content;
  if (typeof messageContent === 'string') return messageContent;
  if (!Array.isArray(messageContent) || messageContent.some((contentBlock) => contentBlock?.type === 'tool_result')) return null;
  const blockTexts = messageContent.filter((contentBlock) => contentBlock?.type === 'text').map((contentBlock) => contentBlock.text);
  return blockTexts.length ? blockTexts.join('\n') : null;
}

// The person's turns in order: { number, promptId, messageId, timestamp, preview, cutBeforeMessageId }.
// `cutBeforeMessageId` is the last assistant message before the turn (null for the first turn).
export function listPersonTurns(transcriptText) {
  const transcriptEntries = parseTranscriptEntries(transcriptText);
  const entriesById = new Map(transcriptEntries.filter((transcriptEntry) => transcriptEntry.uuid).map((transcriptEntry) => [transcriptEntry.uuid, transcriptEntry]));
  const findAssistantBefore = (transcriptEntry) => {
    const visitedIds = new Set();
    let previousEntry = entriesById.get(transcriptEntry.parentUuid);
    while (previousEntry && !visitedIds.has(previousEntry.uuid)) {
      if (previousEntry.type === 'assistant' && !previousEntry.isSidechain) return previousEntry.uuid;
      visitedIds.add(previousEntry.uuid);
      previousEntry = entriesById.get(previousEntry.parentUuid);
    }
    return null;
  };
  const personTurns = [];
  for (const transcriptEntry of transcriptEntries) {
    const personText = readPersonText(transcriptEntry);
    if (personText === null) continue;
    const firstLine = personText.trim().split('\n')[0];
    personTurns.push({
      number: personTurns.length + 1,
      promptId: transcriptEntry.promptId || null,
      messageId: transcriptEntry.uuid,
      timestamp: transcriptEntry.timestamp || null,
      preview: firstLine.length > TURN_PREVIEW_CHARACTERS ? `${firstLine.slice(0, TURN_PREVIEW_CHARACTERS)}…` : firstLine,
      cutBeforeMessageId: findAssistantBefore(transcriptEntry),
    });
  }
  return personTurns;
}

export function readPersonTurns(sessionId, environment = process.env) {
  const transcriptPath = findTranscriptPath(sessionId, environment);
  if (!transcriptPath) throw new Error(`no transcript found for session ${sessionId} under ${join(environment.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')}`);
  return listPersonTurns(readFileSync(transcriptPath, 'utf8'));
}
