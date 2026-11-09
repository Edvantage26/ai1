// verify-gate (Stop, feature `verify`): the agent cannot finish while a project file it changed in
// this session is newer than the last run of each `verify` command, or while that last run failed.
// "Done" means a command showed it, not that the agent said so.
// - Runs are read from the transcript: a Bash call whose simple commands include the full verify
//   command (redirects allowed, extra arguments or filters not), or `ai1 verify` / `ai1 step-done`.
//   Exit code from the tool result (`is_error`), plus common failure summaries for piped output.
// - Changes are judged by file modification time against the end of the run, so edits made by
//   subagents or shell commands count too. A session whose transcript shows no call that may write
//   (core/session-writes) is not asked: the changes belong to another session or predate it.
// - Asked at most twice for the same situation, then it lets the agent stop (fail open).

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, writeStateText, shortHash, readStateJson } from '../core/session-state.mjs';
import { baseName, commandWordsWithoutRedirects, splitSimpleCommands } from '../core/shell-parse.mjs';
import { readNewTranscriptEvents, eventContentBlocks, TOOL_USE_MARKER, TOOL_RESULT_MARKER } from '../core/transcript-scan.mjs';
import { toolUseMayWriteFiles } from '../core/session-writes.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

const MODULE_ID = 'verify-gate';
const MAX_BLOCKS_PER_SITUATION = 2;
const MAX_LISTED_FILES = 10;
export const DEFAULT_IGNORED_PATHS = ['*.md', '.claude/**', '.ai1/**'];
const FAILURE_SUMMARIES = [
  /^# fail [1-9]/m, // node:test, TAP
  /\b[1-9]\d* (?:failed|failing)\b/i, // jest, mocha, pytest, vitest
  /^FAILED\b/m, // pytest, go
  /^FAIL\b/m, // jest, go
];
const AI1_VERIFYING_SUBCOMMANDS = new Set(['verify', 'step-done']);

// Indexes of the verify commands a shell command line runs in full.
export function verifyCommandsRunBy(commandLine, verifyCommands) {
  const runCommands = splitSimpleCommands(String(commandLine || '')).map(({ words }) => words);
  if (runCommands.some((commandWords) => baseName(commandWords[0]) === 'ai1' && AI1_VERIFYING_SUBCOMMANDS.has(commandWords[1]))) {
    return verifyCommands.map((verifyCommand, verifyIndex) => verifyIndex);
  }
  const runTexts = runCommands.map(commandWordsWithoutRedirects);
  return verifyCommands.flatMap((verifyCommand, verifyIndex) => {
    const verifyTexts = splitSimpleCommands(verifyCommand).map(({ words }) => commandWordsWithoutRedirects(words));
    // Every simple command of the verify command, in order (e.g. "npm run lint && npm test").
    let searchFrom = 0;
    const runsAll = verifyTexts.every((verifyText) => {
      const foundIndex = runTexts.indexOf(verifyText, searchFrom);
      if (foundIndex < 0) return false;
      searchFrom = foundIndex + 1;
      return true;
    });
    return runsAll ? [verifyIndex] : [];
  });
}

function toolResultText(contentBlock) {
  const resultContent = contentBlock?.content;
  if (typeof resultContent === 'string') return resultContent;
  return Array.isArray(resultContent) ? resultContent.map((resultPart) => resultPart?.text || '').join('\n') : '';
}

export function didRunFail(contentBlock) {
  if (contentBlock?.is_error) return true;
  const outputText = toolResultText(contentBlock);
  return FAILURE_SUMMARIES.some((failurePattern) => failurePattern.test(outputText));
}

// Updates `scanState.lastRuns[verifyIndex] = { endMilliseconds, passed, toolUseId }` and
// `scanState.sessionMayHaveWritten` from the new part of the transcript. Returns false when the
// transcript is not available.
export function scanVerifyRuns(transcriptPath, verifyCommands, scanState) {
  const newTranscript = readNewTranscriptEvents(transcriptPath, scanState, [TOOL_USE_MARKER, TOOL_RESULT_MARKER]);
  if (!newTranscript) return false;
  if (newTranscript.restarted) {
    scanState.pendingRuns = {};
    scanState.lastRuns = {};
    scanState.sessionMayHaveWritten = false;
  }
  // State saved by a version without this flag: earlier writes are unknown, so assume them.
  scanState.sessionMayHaveWritten ??= true;
  scanState.pendingRuns ||= {};
  scanState.lastRuns ||= {};
  for (const transcriptEvent of newTranscript.events) {
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) {
      if (toolUseMayWriteFiles(toolUse, verifyCommands)) scanState.sessionMayHaveWritten = true;
      if (toolUse.name !== 'Bash') continue;
      const verifyIndexes = verifyCommandsRunBy(toolUse.input?.command, verifyCommands);
      if (verifyIndexes.length) scanState.pendingRuns[toolUse.id] = verifyIndexes;
    }
    for (const toolResult of eventContentBlocks(transcriptEvent, 'tool_result')) {
      const verifyIndexes = scanState.pendingRuns[toolResult.tool_use_id];
      if (!verifyIndexes) continue;
      delete scanState.pendingRuns[toolResult.tool_use_id];
      const endMilliseconds = Date.parse(transcriptEvent.timestamp) || Date.now();
      const passed = !didRunFail(toolResult);
      for (const verifyIndex of verifyIndexes) {
        scanState.lastRuns[verifyIndex] = { endMilliseconds, passed, toolUseId: toolResult.tool_use_id };
      }
    }
  }
  return true;
}

// Files changed in this session (after it started), with their modification time.
export function listSessionChangedCode(projectRoot, sessionBase, ignoredPaths) {
  return listFilesChangedSinceBase(projectRoot, sessionBase.baseHead)
    .filter((relativePath) => !matchesAnyGlob(relativePath, ignoredPaths))
    .map((relativePath) => {
      const absolutePath = join(projectRoot, relativePath);
      return existsSync(absolutePath) ? { relativePath, modifiedMilliseconds: statSync(absolutePath).mtimeMs } : null;
    })
    .filter((changedFile) => changedFile && changedFile.modifiedMilliseconds >= sessionBase.sessionStartMilliseconds);
}

// { kind: 'stale' | 'failed', ... } for the first verify command not satisfied, or null.
export function findUnverifiedChange(changedFiles, verifyCommands, lastRuns) {
  if (changedFiles.length === 0) return null;
  const newestChangeMilliseconds = Math.max(...changedFiles.map((changedFile) => changedFile.modifiedMilliseconds));
  for (const [verifyIndex, verifyCommand] of verifyCommands.entries()) {
    const lastRun = lastRuns[verifyIndex];
    if (!lastRun || lastRun.endMilliseconds < newestChangeMilliseconds) {
      const staleFiles = changedFiles.filter((changedFile) => !lastRun || changedFile.modifiedMilliseconds > lastRun.endMilliseconds);
      return { kind: 'stale', verifyCommand, staleFiles };
    }
    if (!lastRun.passed) return { kind: 'failed', verifyCommand, toolUseId: lastRun.toolUseId };
  }
  return null;
}

export function buildVerifyReminder(unverifiedChange) {
  if (unverifiedChange.kind === 'failed') {
    return `The last run of \`${unverifiedChange.verifyCommand}\` after your changes failed. Fix the cause and run it again; if it cannot be fixed now, tell the person plainly that it fails and why before finishing.`;
  }
  const listedFiles = unverifiedChange.staleFiles.slice(0, MAX_LISTED_FILES).map((changedFile) => `\`${changedFile.relativePath}\``).join(', ');
  const moreFiles = unverifiedChange.staleFiles.length > MAX_LISTED_FILES ? ` and ${unverifiedChange.staleFiles.length - MAX_LISTED_FILES} more` : '';
  return `Files changed after the last run of \`${unverifiedChange.verifyCommand}\`: ${listedFiles}${moreFiles}. Run \`${unverifiedChange.verifyCommand}\` as is (no filters or extra arguments) and report its result before finishing. If it cannot run here, say so plainly.`;
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'verify',
  description: 'Does not let the agent finish while code changed after the last passing run of the verify commands.',
  run({ hookInput, config, projectRoot, environment, moduleOptions }) {
    const verifyCommands = config.verify || [];
    if (verifyCommands.length === 0) return allowDecision();
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const ignoredPaths = [...DEFAULT_IGNORED_PATHS, ...(moduleOptions.ignore_paths || [])];
    ignoredPaths.push(`${KNOWLEDGE_BUNDLE_PATH}/**`);
    const changedFiles = listSessionChangedCode(projectRoot, sessionBase, ignoredPaths);
    if (changedFiles.length === 0) return allowDecision();

    const stateDirectory = resolveStateDirectory(environment);
    const scanStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'verify-scan');
    const scanState = readStateJson(scanStatePath);
    // Without a transcript there is no way to know what ran: let the agent stop.
    if (!scanVerifyRuns(hookInput.transcript_path, verifyCommands, scanState)) return allowDecision();
    writeStateText(scanStatePath, JSON.stringify(scanState));
    if (!scanState.sessionMayHaveWritten) return allowDecision();

    const unverifiedChange = findUnverifiedChange(changedFiles, verifyCommands, scanState.lastRuns);
    if (!unverifiedChange) return allowDecision();
    const situation = unverifiedChange.kind === 'failed'
      ? `failed:${unverifiedChange.toolUseId}`
      : `stale:${shortHash(unverifiedChange.staleFiles.map((changedFile) => `${changedFile.relativePath}@${changedFile.modifiedMilliseconds}`).join('\n'))}`;
    const blocksPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'verify-blocks');
    const blockCounts = readStateJson(blocksPath);
    if ((blockCounts[situation] || 0) >= MAX_BLOCKS_PER_SITUATION) return allowDecision();
    blockCounts[situation] = (blockCounts[situation] || 0) + 1;
    writeStateText(blocksPath, JSON.stringify(blockCounts));
    return blockDecision(MODULE_ID, buildVerifyReminder(unverifiedChange));
  },
};
