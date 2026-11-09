// Splits a shell command line into the simple commands it actually runs, so guards can reason
// about `git push --force` whether it arrives alone, chained with `&&`, behind `sudo`, with env
// assignments in front, or wrapped in `bash -c "..."`.
// It is a guard helper, not a shell: it aims to never miss an obvious dangerous command, and
// accepts that an exotic construction may slip through.

const COMMAND_SEPARATORS = new Set(['&&', '||', ';', '|', '&', '\n']);
const WRAPPER_COMMANDS = new Set(['sudo', 'doas', 'nohup', 'time', 'nice', 'exec', 'command', 'builtin']);
const SHELL_COMMANDS = new Set(['bash', 'sh', 'zsh', 'dash']);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const MAX_UNWRAP_DEPTH = 3;
const REDIRECT_WORD = /^(?:\d|&)?(?:>>?|<<?)/;

// Tokenizes respecting single quotes, double quotes and backslash escapes.
// Separators become their own tokens; quoted text never does.
export function tokenizeShell(commandLine) {
  const shellTokens = [];
  let currentToken = '';
  let hasCurrentToken = false;
  let activeQuote = null;
  const pushCurrentToken = () => {
    if (hasCurrentToken) shellTokens.push(currentToken);
    currentToken = '';
    hasCurrentToken = false;
  };
  for (let characterIndex = 0; characterIndex < commandLine.length; characterIndex += 1) {
    const character = commandLine[characterIndex];
    const nextCharacter = commandLine[characterIndex + 1];
    if (activeQuote) {
      if (character === activeQuote) activeQuote = null;
      else if (character === '\\' && activeQuote === '"' && nextCharacter !== undefined) {
        currentToken += nextCharacter;
        characterIndex += 1;
      } else currentToken += character;
      continue;
    }
    if (character === "'" || character === '"') {
      activeQuote = character;
      hasCurrentToken = true;
      continue;
    }
    if (character === '\\' && nextCharacter !== undefined) {
      if (nextCharacter !== '\n') currentToken += nextCharacter;
      hasCurrentToken = hasCurrentToken || nextCharacter !== '\n';
      characterIndex += 1;
      continue;
    }
    if (character === ' ' || character === '\t') {
      pushCurrentToken();
      continue;
    }
    const twoCharacters = character + (nextCharacter ?? '');
    if (twoCharacters === '&&' || twoCharacters === '||') {
      pushCurrentToken();
      shellTokens.push(twoCharacters);
      characterIndex += 1;
      continue;
    }
    if (COMMAND_SEPARATORS.has(character)) {
      pushCurrentToken();
      shellTokens.push(character);
      continue;
    }
    currentToken += character;
    hasCurrentToken = true;
  }
  pushCurrentToken();
  return shellTokens;
}

function stripCommandPrefixes(commandWords) {
  let firstWordIndex = 0;
  while (firstWordIndex < commandWords.length) {
    const commandWord = commandWords[firstWordIndex];
    if (ENV_ASSIGNMENT.test(commandWord)) firstWordIndex += 1;
    else if (commandWord === 'env') firstWordIndex += 1;
    else if (WRAPPER_COMMANDS.has(commandWord)) {
      firstWordIndex += 1;
      // Skip wrapper options such as `sudo -u user` or `nice -n 10`.
      while (commandWords[firstWordIndex]?.startsWith('-')) {
        const wrapperOption = commandWords[firstWordIndex];
        firstWordIndex += ['-u', '-g', '-n'].includes(wrapperOption) ? 2 : 1;
      }
    } else break;
  }
  return commandWords.slice(firstWordIndex);
}

// Returns [{ words: [...], text: 'simple command' }] for every simple command, including the ones
// inside `bash -c "..."`. Command substitutions (`$(...)`, backticks) are not expanded.
export function splitSimpleCommands(commandLine, unwrapDepth = 0) {
  const simpleCommands = [];
  let commandWords = [];
  const closeCommand = () => {
    const meaningfulWords = stripCommandPrefixes(commandWords);
    commandWords = [];
    if (meaningfulWords.length === 0) return;
    // `-c` may come bundled with other options: `bash -lc "..."`, `sh -ec "..."`.
    const shellScriptIndex = meaningfulWords.findIndex((commandWord, wordIndex) => wordIndex > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(commandWord));
    const isShellWrapper = SHELL_COMMANDS.has(baseName(meaningfulWords[0])) && shellScriptIndex > 0;
    if (isShellWrapper && meaningfulWords[shellScriptIndex + 1] !== undefined && unwrapDepth < MAX_UNWRAP_DEPTH) {
      simpleCommands.push(...splitSimpleCommands(meaningfulWords[shellScriptIndex + 1], unwrapDepth + 1));
      return;
    }
    simpleCommands.push({ words: meaningfulWords, text: meaningfulWords.join(' ') });
  };
  for (const shellToken of tokenizeShell(commandLine)) {
    if (COMMAND_SEPARATORS.has(shellToken)) closeCommand();
    else commandWords.push(shellToken);
  }
  closeCommand();
  return simpleCommands;
}

export function baseName(executablePath = '') {
  return executablePath.split('/').pop();
}

// Short flags can be bundled (`-rf`), so `-r` is present in `-fr`, `-rf` or `-r -f`.
export function hasShortFlag(commandWords, flagLetter) {
  return commandWords.some((commandWord) => /^-[A-Za-z]+$/.test(commandWord) && commandWord.includes(flagLetter));
}

export function hasLongFlag(commandWords, flagName) {
  return commandWords.some((commandWord) => commandWord === flagName || commandWord.startsWith(`${flagName}=`));
}

// The words of a simple command without its redirects, e.g. `npm test 2>&1` -> `npm test`.
export function commandWordsWithoutRedirects(commandWords) {
  const keptWords = [];
  for (let wordIndex = 0; wordIndex < commandWords.length; wordIndex += 1) {
    const redirectMatch = commandWords[wordIndex].match(REDIRECT_WORD);
    if (!redirectMatch) keptWords.push(commandWords[wordIndex]);
    else if (commandWords[wordIndex].length === redirectMatch[0].length) wordIndex += 1;
  }
  return keptWords.join(' ');
}
