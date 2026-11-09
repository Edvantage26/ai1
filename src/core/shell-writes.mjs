// Which files a shell command writes, as far as the command line tells: redirects, `tee`,
// in-place editors, copy/move targets and file-changing commands. Inline interpreter scripts
// (`python3 - <<EOF`, `node -e`) may write anywhere, so they are flagged instead of resolved.
// A heuristic for hooks, like shell-parse: reading commands (cat, grep, validators) never count.
// A `cd <dir>` earlier in the line moves the relative targets after it (`cd /repo && sed -i ... a.md`
// writes /repo/a.md, not a.md of the session's folder); a `cd` to `~`, `-` or a variable is unknown,
// so the targets after it stay as written.

import { posix } from 'node:path';
import { baseName, hasLongFlag, hasShortFlag, splitSimpleCommands } from './shell-parse.mjs';

const OUTPUT_REDIRECT = /^(?:\d|&)?>>?\|?/;
const FILE_CHANGING_COMMANDS = new Set(['tee', 'touch', 'rm', 'mkdir', 'truncate']);
const COPYING_COMMANDS = new Set(['mv', 'cp', 'install', 'rsync', 'ln']);
const IN_PLACE_EDITORS = new Set(['sed', 'perl']);
const SCRIPT_INTERPRETERS = new Set(['python', 'python3', 'node', 'ruby', 'perl']);
const NON_FILE_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

// Returns { targetPaths: [...], runsInlineScript: boolean }.
export function listShellWriteTargets(commandLine) {
  const targetPaths = [];
  let runsInlineScript = false;
  let changedDirectory = null;
  for (const { words } of splitSimpleCommands(String(commandLine || ''))) {
    const commandName = baseName(words[0]);
    if (commandName === 'cd') {
      const directoryArgument = words.slice(1).find((commandWord) => !commandWord.startsWith('-'));
      const isKnownDirectory = directoryArgument && !/^[~$]/.test(directoryArgument);
      changedDirectory = isKnownDirectory ? resolveAfterCd(changedDirectory, directoryArgument) : null;
      continue;
    }
    const targetCountBefore = targetPaths.length;
    words.forEach((commandWord, wordIndex) => {
      const redirect = commandWord.match(OUTPUT_REDIRECT);
      if (!redirect) return;
      const redirectTarget = commandWord.slice(redirect[0].length) || words[wordIndex + 1];
      if (redirectTarget !== undefined && !redirectTarget.startsWith('&')) targetPaths.push(redirectTarget);
    });
    const commandArguments = words.slice(1).filter((commandWord) => !commandWord.startsWith('-') && !OUTPUT_REDIRECT.test(commandWord));
    if (FILE_CHANGING_COMMANDS.has(commandName)) targetPaths.push(...commandArguments);
    else if (COPYING_COMMANDS.has(commandName) && commandArguments.length > 1) targetPaths.push(commandArguments.at(-1));
    else if (IN_PLACE_EDITORS.has(commandName) && (hasShortFlag(words, 'i') || hasLongFlag(words, '--in-place'))) {
      // The first non-option argument is the edit script, the rest are the files.
      targetPaths.push(...commandArguments.slice(1));
    }
    const hasInlineScriptFlag = words.some((commandWord) => commandWord === '-' || /^-[A-Za-z]*[ce]$/.test(commandWord) || commandWord.startsWith('<<'));
    if (SCRIPT_INTERPRETERS.has(commandName) && hasInlineScriptFlag) runsInlineScript = true;
    if (changedDirectory) {
      for (let targetIndex = targetCountBefore; targetIndex < targetPaths.length; targetIndex += 1) {
        targetPaths[targetIndex] = resolveAfterCd(changedDirectory, targetPaths[targetIndex]);
      }
    }
  }
  return { targetPaths: [...new Set(targetPaths.filter((targetPath) => !NON_FILE_TARGETS.has(targetPath)))], runsInlineScript };
}

// `relativePath` seen from `directory` (absolute or relative to the session's folder); absolute paths win.
function resolveAfterCd(directory, relativePath) {
  if (relativePath.startsWith('/') || relativePath.startsWith('~') || relativePath.startsWith('$') || !directory) return relativePath;
  return posix.join(directory, relativePath);
}
