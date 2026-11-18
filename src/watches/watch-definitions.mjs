// Watch definitions (feature `watches`): `.ai1/watches/<id>.json`, committed, say how something shipped
// to production is checked (schema/watch.schema.json). Validated by hand, like .ai1/config.json, so ai1
// keeps zero dependencies.

import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WATCHES_DIRECTORY } from '../core/config.mjs';
import { writeJsonFile } from '../core/json-file.mjs';

export const DEFAULT_WATCH_EVERY = '1d';
export const DEFAULT_WATCH_FOR = '14d';
export const DEFAULT_TIMEOUT_SECONDS = 30;
const WATCH_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DURATION_PATTERN = /^([0-9]+)([hd])$/;
const KNOWN_WATCH_FIELDS = new Set(['$schema', 'title', 'description', 'check', 'every', 'suggestedFor', 'createdBy']);

// '12h' or '14d' in milliseconds; null when it is not a duration.
export function parseDuration(durationText) {
  const durationMatch = DURATION_PATTERN.exec(String(durationText ?? ''));
  if (!durationMatch) return null;
  return Number(durationMatch[1]) * (durationMatch[2] === 'h' ? 3600 : 86400) * 1000;
}

export function isCountsWatch(watchDefinition) {
  return watchDefinition?.check?.expect === 'counts';
}

export function validateWatchDefinition(watchDefinition) {
  if (!watchDefinition || typeof watchDefinition !== 'object' || Array.isArray(watchDefinition)) return ['must be a JSON object'];
  const validationErrors = Object.keys(watchDefinition).filter((fieldName) => !KNOWN_WATCH_FIELDS.has(fieldName)).map((fieldName) => `unknown field "${fieldName}"`);
  if (typeof watchDefinition.title !== 'string' || !watchDefinition.title.trim()) validationErrors.push('"title" must be a non-empty string');
  const watchCheck = watchDefinition.check;
  if (!watchCheck || typeof watchCheck !== 'object') return [...validationErrors, '"check" must be an object with "kind"'];
  if (watchCheck.kind === 'command') {
    const isArgumentList = Array.isArray(watchCheck.run) && watchCheck.run.length > 0 && watchCheck.run.every((commandArgument) => typeof commandArgument === 'string');
    const isShellLine = typeof watchCheck.run === 'string' && watchCheck.run.trim();
    if (!isArgumentList && !isShellLine) validationErrors.push('"check.run" must be a list of arguments or a command line');
  } else if (watchCheck.kind === 'agent') {
    if (typeof watchCheck.prompt !== 'string' || !watchCheck.prompt.trim()) validationErrors.push('"check.prompt" must say what the agent checks');
  } else {
    validationErrors.push('"check.kind" must be "command" or "agent"');
  }
  if (watchCheck.timeoutSeconds !== undefined && !(typeof watchCheck.timeoutSeconds === 'number' && watchCheck.timeoutSeconds > 0)) validationErrors.push('"check.timeoutSeconds" must be a positive number');
  if (watchCheck.expect !== undefined && watchCheck.expect !== 'counts' && !Number.isInteger(watchCheck.expect?.exitCode)) validationErrors.push('"check.expect" must be { "exitCode": n } or "counts"');
  for (const durationField of ['every', 'suggestedFor']) {
    if (watchDefinition[durationField] !== undefined && parseDuration(watchDefinition[durationField]) === null) validationErrors.push(`"${durationField}" must be a duration like 12h or 14d`);
  }
  return validationErrors;
}

export function watchDefinitionPath(repoRoot, watchId) {
  return join(repoRoot, WATCHES_DIRECTORY, `${watchId}.json`);
}

// Every `.ai1/watches/*.json`: { id, definition, errors }. A file that is not valid JSON is listed with its error.
export function listWatchDefinitions(repoRoot) {
  const watchesDirectory = join(repoRoot, WATCHES_DIRECTORY);
  if (!existsSync(watchesDirectory)) return [];
  return readdirSync(watchesDirectory).filter((fileName) => fileName.endsWith('.json')).sort().map((fileName) => {
    const watchId = fileName.slice(0, -'.json'.length);
    try {
      const watchDefinition = JSON.parse(readFileSync(join(watchesDirectory, fileName), 'utf8'));
      return { id: watchId, definition: watchDefinition, errors: validateWatchDefinition(watchDefinition) };
    } catch (parseError) {
      return { id: watchId, definition: null, errors: [`not valid JSON: ${parseError.message}`] };
    }
  });
}

export function findWatchDefinition(repoRoot, watchId) {
  return listWatchDefinitions(repoRoot).find((watchEntry) => watchEntry.id === watchId) || null;
}

export function writeWatchDefinition(repoRoot, watchId, watchDefinition) {
  if (!WATCH_ID_PATTERN.test(watchId)) throw new Error(`watch id "${watchId}" must be lower-case letters, digits and dashes`);
  const validationErrors = validateWatchDefinition(watchDefinition);
  if (validationErrors.length) throw new Error(`watch ${watchId}: ${validationErrors.join('; ')}`);
  mkdirSync(join(repoRoot, WATCHES_DIRECTORY), { recursive: true });
  writeJsonFile(watchDefinitionPath(repoRoot, watchId), watchDefinition);
}
