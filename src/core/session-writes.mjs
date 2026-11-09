// Whether a session may have changed files itself, read from its transcript. The Stop checks
// (okf-upkeep, verify-gate) judge "changed in this session" by git and modification times, which
// cannot tell this session from another one working in the same folder, nor from changes left
// uncommitted before it started; a session that never wrote anything is not asked about them.
// Errs towards "may write": any tool call or shell command not known to be read-only counts.

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
