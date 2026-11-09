// Whether a session may have changed files itself, read from its transcript. The Stop checks
// (okf-upkeep, verify-gate) judge "changed in this session" by git and modification times, which
// cannot tell this session from another one working in the same folder, nor from changes left
// uncommitted before it started. So each call that may write opens a write window (from its tool_use
// to its tool_result) and only files modified inside one of the session's windows are its own.
// Errs towards "may write": any tool call or shell command not known to be read-only counts.

import { isAbsolute, resolve } from 'node:path';
import { eventContentBlocks } from './transcript-scan.mjs';
import { baseName, commandWordsWithoutRedirects, splitSimpleCommands } from './shell-parse.mjs';
import { listShellWriteTargets } from './shell-writes.mjs';

// Tools that edit files, and the ones that run other agents (their edits are not in this transcript).
const FILE_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'Workflow']);
const READ_ONLY_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'tree', 'wc', 'uniq', 'cut', 'tr', 'sed', 'awk',
  'diff', 'cmp', 'file', 'stat', 'du', 'df', 'pwd', 'cd', 'echo', 'printf', 'true', 'false', 'test', '[', 'which',
  'type', 'date', 'basename', 'dirname', 'realpath', 'readlink', 'jq', 'column', 'nl', 'od', 'xxd', 'sha256sum',
  'md5sum', 'sort', 'find',
]);
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'log', 'diff', 'show', 'blame', 'grep', 'ls-files', 'ls-tree', 'rev-parse', 'describe', 'shortlog', 'cat-file',
]);
const WRITING_FIND_ACTIONS = new Set(['-delete', '-exec', '-execdir', '-ok', '-okdir', '-fprint', '-fprint0', '-fprintf', '-fls']);
// Command substitutions run commands the simple-command split does not see.
const COMMAND_SUBSTITUTION = /\$\(|`/;

function isReadOnlyGitCommand(commandWords) {
  let wordIndex = 1;
  // Global options before the subcommand: `git -C <dir> status`, `git -c key=value log`.
  while (['-C', '-c'].includes(commandWords[wordIndex])) wordIndex += 2;
  while (commandWords[wordIndex]?.startsWith('--')) wordIndex += 1;
  return READ_ONLY_GIT_SUBCOMMANDS.has(commandWords[wordIndex]);
}

function isReadOnlySimpleCommand(commandWords, verifyCommandTexts) {
  const commandName = baseName(commandWords[0]);
  // The tokenizer splits `2>&1` at the `&`, leaving the descriptor as a command of its own.
  if (commandWords.length === 1 && /^\d+$/.test(commandName)) return true;
  if (commandName === 'git') return isReadOnlyGitCommand(commandWords);
  if (commandName === 'find') return !commandWords.some((commandWord) => WRITING_FIND_ACTIONS.has(commandWord));
  if (commandName === 'sort') return !commandWords.some((commandWord) => commandWord === '-o' || commandWord.startsWith('--output'));
  if (READ_ONLY_COMMANDS.has(commandName)) return true;
  // The repo's own verify commands check the code; running them is not changing it.
  return verifyCommandTexts.has(commandWordsWithoutRedirects(commandWords));
}

// Whether a shell command line only reads: every simple command is known to be read-only and
// nothing is redirected into a file (`sed -i`, `> file` and the like are caught by shell-writes).
export function shellCommandOnlyReads(commandLine, verifyCommands = []) {
  const commandText = String(commandLine || '');
  if (COMMAND_SUBSTITUTION.test(commandText)) return false;
  const { targetPaths, runsInlineScript } = listShellWriteTargets(commandText);
  if (targetPaths.length || runsInlineScript) return false;
  const verifyCommandTexts = new Set(verifyCommands.flatMap((verifyCommand) => splitSimpleCommands(verifyCommand).map(({ words }) => commandWordsWithoutRedirects(words))));
  return splitSimpleCommands(commandText).every(({ words }) => isReadOnlySimpleCommand(words, verifyCommandTexts));
}

// Whether one transcript tool_use block may change files. Other tools (Read, Grep, web, MCP...) do not.
export function toolUseMayWriteFiles(toolUse, verifyCommands = []) {
  if (FILE_WRITING_TOOLS.has(toolUse?.name)) return true;
  if (toolUse?.name === 'Bash') return !shellCommandOnlyReads(toolUse.input?.command, verifyCommands);
  return false;
}

// Commands whose writes listShellWriteTargets resolves completely (`mv` is left out: it also removes
// its source, which may be in the repo).
const RESOLVED_WRITING_COMMANDS = new Set(['tee', 'touch', 'rm', 'mkdir', 'truncate', 'cp', 'install', 'ln']);

function isOutsideProject(targetPath, projectRoot) {
  if (!isAbsolute(targetPath)) return false;
  const resolvedTarget = resolve(targetPath);
  const resolvedRoot = resolve(projectRoot);
  return resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}/`);
}

// Whether a shell command only writes outside the project (scratch files in /tmp and the like): every
// write target is an absolute path outside `projectRoot` and every command is read-only or one whose
// targets are known. Anything unclear counts as writing in the project.
export function shellCommandWritesOnlyOutside(commandLine, projectRoot, verifyCommands = []) {
  const commandText = String(commandLine || '');
  if (!projectRoot || COMMAND_SUBSTITUTION.test(commandText)) return false;
  const { targetPaths, runsInlineScript } = listShellWriteTargets(commandText);
  if (runsInlineScript || targetPaths.length === 0) return false;
  if (!targetPaths.every((targetPath) => isOutsideProject(targetPath, projectRoot))) return false;
  const verifyCommandTexts = new Set(verifyCommands.flatMap((verifyCommand) => splitSimpleCommands(verifyCommand).map(({ words }) => commandWordsWithoutRedirects(words))));
  return splitSimpleCommands(commandText).every(({ words }) => RESOLVED_WRITING_COMMANDS.has(baseName(words[0])) || isReadOnlySimpleCommand(words, verifyCommandTexts));
}

// Subagents and background shells go on writing after their tool_result arrives.
const OPEN_ENDED_TOOLS = new Set(['Agent', 'Task', 'Workflow']);
// Slack around a window for clock and timestamp granularity.
const WINDOW_SLACK_MILLISECONDS = 2000;

// Updates `windowState.writeWindows` ([{ startMilliseconds, endMilliseconds | null }], null = still
// open) and `windowState.openWindowIndexes` from new transcript events (tool_use and tool_result).
// A state saved by a version without windows only knew "may have written": that becomes one window
// covering the whole session.
export function updateWriteWindows(windowState, transcriptEvents, { restarted = false, verifyCommands = [], projectRoot } = {}) {
  if (restarted) {
    windowState.writeWindows = [];
    windowState.openWindowIndexes = {};
  }
  if (!Array.isArray(windowState.writeWindows)) {
    windowState.writeWindows = windowState.sessionMayHaveWritten === true ? [{ startMilliseconds: 0, endMilliseconds: null }] : [];
  }
  windowState.openWindowIndexes ||= {};
  for (const transcriptEvent of transcriptEvents) {
    const eventMilliseconds = Date.parse(transcriptEvent?.timestamp);
    const hasTimestamp = Number.isFinite(eventMilliseconds);
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) {
      if (!toolUseMayWriteFiles(toolUse, verifyCommands)) continue;
      if (toolUse.name === 'Bash' && shellCommandWritesOnlyOutside(toolUse.input?.command, projectRoot, verifyCommands)) continue;
      windowState.writeWindows.push({ startMilliseconds: hasTimestamp ? eventMilliseconds : 0, endMilliseconds: null });
      const isOpenEnded = !hasTimestamp || OPEN_ENDED_TOOLS.has(toolUse.name) || (toolUse.name === 'Bash' && toolUse.input?.run_in_background);
      if (!isOpenEnded && toolUse.id) windowState.openWindowIndexes[toolUse.id] = windowState.writeWindows.length - 1;
    }
    for (const toolResult of eventContentBlocks(transcriptEvent, 'tool_result')) {
      const windowIndex = windowState.openWindowIndexes[toolResult.tool_use_id];
      if (windowIndex === undefined) continue;
      delete windowState.openWindowIndexes[toolResult.tool_use_id];
      if (hasTimestamp) windowState.writeWindows[windowIndex].endMilliseconds = eventMilliseconds;
    }
  }
  windowState.sessionMayHaveWritten = windowState.writeWindows.length > 0;
  return windowState;
}

// Whether a file modified at `modifiedMilliseconds` may have been written by the session.
export function isInsideWriteWindow(modifiedMilliseconds, writeWindows) {
  return (writeWindows || []).some(({ startMilliseconds, endMilliseconds }) => modifiedMilliseconds >= startMilliseconds - WINDOW_SLACK_MILLISECONDS
    && (endMilliseconds === null || modifiedMilliseconds <= endMilliseconds + WINDOW_SLACK_MILLISECONDS));
}
