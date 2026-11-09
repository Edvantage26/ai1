// Which files a tool call may change, for guards that protect certain paths (config-guard,
// test-guard). File tools give their path; a shell command gives what its command line tells
// (shell-writes), with removals and moves told apart because a guard may treat them differently.
// Paths are absolute, resolved against the hook's working directory, `/`-separated.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { baseName, splitSimpleCommands } from './shell-parse.mjs';
import { listShellWriteTargets } from './shell-writes.mjs';

const FILE_TOOL_PATH_FIELDS = ['file_path', 'notebook_path'];
// git subcommands that overwrite or remove tracked files named on the command line.
const GIT_FILE_CHANGING_SUBCOMMANDS = new Set(['rm', 'checkout', 'restore', 'mv']);

function toSlashPath(fileSystemPath) {
  return fileSystemPath.split('\\').join('/');
}

// The path as written and, when it exists, where its symlinks lead: a guard checks both.
export function pathSpellings(candidatePath, workingDirectory) {
  const absolutePath = resolve(workingDirectory, candidatePath);
  const spellings = [toSlashPath(absolutePath)];
  try {
    const realPath = toSlashPath(realpathSync(absolutePath));
    if (realPath !== spellings[0]) spellings.push(realPath);
  } catch {
    // A file that does not exist yet has no other spelling.
  }
  return spellings;
}

// Index of the git subcommand, past global options and their values (`git -C dir rm x`).
function gitSubcommandIndex(commandWords) {
  let wordIndex = 1;
  while (commandWords[wordIndex]?.startsWith('-')) wordIndex += ['-C', '-c'].includes(commandWords[wordIndex]) ? 2 : 1;
  return wordIndex;
}

function nonOptionArguments(commandWords) {
  return commandWords.filter((commandWord) => !commandWord.startsWith('-'));
}

// Returns { changes: [{ path, change }], runsInlineScript }, with `change` one of:
// 'edit' (file tool), 'shell-write' (redirect, tee, sed -i, cp target, git checkout/restore),
// 'remove' (rm, git rm), 'move' (mv/git mv source; `movedTo` holds the destination), 'move-target'
// (the destination itself, which a move may overwrite).
export function listToolCallChanges(hookInput, workingDirectory) {
  const toolInput = hookInput.tool_input || {};
  const changes = [];
  const addChange = (rawPath, change, extraFields = {}) => {
    if (typeof rawPath === 'string' && rawPath) changes.push({ path: toSlashPath(resolve(workingDirectory, rawPath)), rawPath, change, ...extraFields });
  };
  if (hookInput.tool_name !== 'Bash') {
    for (const pathField of FILE_TOOL_PATH_FIELDS) addChange(toolInput[pathField], 'edit');
    return { changes, runsInlineScript: false };
  }
  let runsInlineScript = false;
  for (const { words, text } of splitSimpleCommands(String(toolInput.command || ''))) {
    const commandName = baseName(words[0]);
    const isGit = commandName === 'git';
    const subcommandIndex = isGit ? gitSubcommandIndex(words) : 0;
    const gitSubcommand = isGit ? words[subcommandIndex] : null;
    const commandArguments = words.slice(subcommandIndex + 1);
    if (commandName === 'rm' || (isGit && gitSubcommand === 'rm')) {
      for (const removedPath of nonOptionArguments(commandArguments)) addChange(removedPath, 'remove');
    } else if (commandName === 'mv' || (isGit && gitSubcommand === 'mv')) {
      const movedPaths = nonOptionArguments(commandArguments);
      const destinationPath = movedPaths.pop();
      for (const sourcePath of movedPaths) addChange(sourcePath, 'move', { movedTo: toSlashPath(resolve(workingDirectory, destinationPath)) });
      addChange(destinationPath, 'move-target');
    } else if (isGit && GIT_FILE_CHANGING_SUBCOMMANDS.has(gitSubcommand)) {
      for (const restoredPath of nonOptionArguments(commandArguments).filter((gitArgument) => gitArgument !== '.')) addChange(restoredPath, 'shell-write');
    } else {
      const { targetPaths, runsInlineScript: commandRunsInlineScript } = listShellWriteTargets(text);
      for (const targetPath of targetPaths) addChange(targetPath, 'shell-write');
      runsInlineScript ||= commandRunsInlineScript;
    }
  }
  return { changes, runsInlineScript };
}
