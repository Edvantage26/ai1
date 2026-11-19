// Reads a password for `ai1 local password|unlock` without showing it: from the terminal in raw mode
// (nothing echoed; Backspace works, Ctrl+C cancels), or the first line of stdin when it is piped.
// Node only, the same on Linux, macOS and Windows terminals.

import { readFileSync } from 'node:fs';

export function readSecretLine(promptText, { inputStream = process.stdin, outputStream = process.stderr } = {}) {
  if (!inputStream.isTTY) {
    const pipedText = readFileSync(0, 'utf8');
    return Promise.resolve(pipedText.split(/\r?\n/)[0] || '');
  }
  return new Promise((resolveSecret, rejectSecret) => {
    let typedCharacters = '';
    outputStream.write(promptText);
    inputStream.setRawMode(true);
    inputStream.resume();
    inputStream.setEncoding('utf8');
    const finish = (finishError) => {
      inputStream.setRawMode(false);
      inputStream.pause();
      inputStream.removeListener('data', onData);
      outputStream.write('\n');
      if (finishError) rejectSecret(finishError);
      else resolveSecret(typedCharacters);
    };
    function onData(receivedText) {
      for (const receivedCharacter of receivedText) {
        if (receivedCharacter === '\r' || receivedCharacter === '\n' || receivedCharacter === '\u0004') return finish();
        if (receivedCharacter === '\u0003') return finish(new Error('cancelled'));
        if (receivedCharacter === '\u007f' || receivedCharacter === '\b') typedCharacters = typedCharacters.slice(0, -1);
        else if (receivedCharacter >= ' ') typedCharacters += receivedCharacter;
      }
      return undefined;
    }
    inputStream.on('data', onData);
  });
}

// The password for a subcommand: `unlock` asks once; `password` asks twice on a terminal (empty: ai1 makes one).
export async function readPasswordFor(subcommandName, readOptions) {
  if (subcommandName === 'unlock') return readSecretLine('ai1 password: ', readOptions);
  const firstPassword = await readSecretLine('New ai1 password (empty: ai1 makes one for you): ', readOptions);
  if (!firstPassword || !(readOptions?.inputStream || process.stdin).isTTY) return firstPassword;
  const repeatedPassword = await readSecretLine('Again: ', readOptions);
  if (repeatedPassword !== firstPassword) throw new Error('the two passwords differ: nothing changed');
  return firstPassword;
}
