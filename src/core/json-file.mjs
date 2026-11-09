// JSON files ai1 reads or rewrites (configs, settings, worktree records), always written the same
// way: two-space indent and a final newline.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// null when the file is missing; throws when it is not valid JSON, so a caller about to rewrite the
// file never replaces one the person broke by hand.
export function readJsonFile(filePath) {
  return existsSync(filePath) ? JSON.parse(readFileSync(filePath, 'utf8')) : null;
}

// null when the file is missing or not valid JSON: for files only read to decide something.
export function readJsonFileIfValid(filePath) {
  try {
    return readJsonFile(filePath);
  } catch {
    return null;
  }
}

export function writeJsonFile(filePath, jsonValue) {
  writeFileSync(filePath, `${JSON.stringify(jsonValue, null, 2)}\n`);
}
