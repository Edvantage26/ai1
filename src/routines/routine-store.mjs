// Routines (feature `routines`): periodic tasks. The person's own live in `.ai1/local/routines.json`
// (a skill to run or a prompt, every <n>h, <n>d or on a weekday; sealed with their other local files);
// what happened to each - last run, offers, a short history - lives in `.ai1/local/state.json`
// `routines` (never sealed, so runs do not make sealed copies conflict). ai1's own periodic maintenance
// tasks (src/maintenance/maintenance-tasks.mjs) are built-in routines run by the same notice.

import { readLocalJson, writeLocalJson, readPersonState, writePersonState } from '../core/person-project.mjs';

export const ROUTINES_FILE_NAME = 'routines.json';
export const MAX_ROUTINE_HISTORY = 10;
export const DEFAULT_ROUTINE_SNOOZE_DAYS = 1;
const ROUTINE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

// '12h' / '7d' -> { periodMilliseconds }; 'mon'..'sun' -> { weekdayIndex }; anything else null.
export function parseRoutineEvery(everyText) {
  const periodMatch = /^([0-9]+)([hd])$/.exec(String(everyText ?? ''));
  if (periodMatch && Number(periodMatch[1]) > 0) return { periodMilliseconds: Number(periodMatch[1]) * (periodMatch[2] === 'h' ? 3600 : 86400) * 1000 };
  const weekdayIndex = WEEKDAY_NAMES.indexOf(String(everyText ?? '').toLowerCase());
  return weekdayIndex >= 0 ? { weekdayIndex } : null;
}

// Local midnight of the most recent `weekdayIndex` at or before `now`.
function lastWeekdayStart(weekdayIndex, now) {
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  dayStart.setDate(dayStart.getDate() - ((dayStart.getDay() - weekdayIndex + 7) % 7));
  return dayStart;
}

// The person's local calendar day, for "offered at most once a day".
export function localDayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Due when its period passed since the last run (or since it was created), or its weekday came since then.
export function isRoutineDue(everyText, routineRecord, createdAt, now = new Date()) {
  const parsedEvery = parseRoutineEvery(everyText);
  if (!parsedEvery) return false;
  const lastRunMilliseconds = Date.parse(routineRecord?.lastRun || createdAt || 0) || 0;
  if (parsedEvery.periodMilliseconds) return now.getTime() - lastRunMilliseconds >= parsedEvery.periodMilliseconds;
  return lastRunMilliseconds < lastWeekdayStart(parsedEvery.weekdayIndex, now).getTime();
}

export function isRoutineMuted(routineSetting = {}, now = new Date()) {
  if (routineSetting.mode === 'off') return true;
  return typeof routineSetting.snoozedUntil === 'string' && Date.parse(routineSetting.snoozedUntil) > now.getTime();
}

export function snoozeUntil(snoozeDays, now = new Date()) {
  return new Date(now.getTime() + snoozeDays * DAY_MILLISECONDS).toISOString();
}

export function readRoutines(sharedRoot) {
  return readLocalJson(sharedRoot, ROUTINES_FILE_NAME);
}

function writeRoutines(sharedRoot, routines) {
  writeLocalJson(sharedRoot, ROUTINES_FILE_NAME, routines);
}

export function validateRoutine(routineDefinition) {
  const validationErrors = [];
  if (!parseRoutineEvery(routineDefinition.every)) validationErrors.push('every must be <n>h, <n>d or a weekday (mon, tue, wed, thu, fri, sat, sun)');
  const routineAction = routineDefinition.action || {};
  const hasSkill = typeof routineAction.skill === 'string' && routineAction.skill.trim().startsWith('/');
  const hasPrompt = typeof routineAction.prompt === 'string' && routineAction.prompt.trim();
  if (hasSkill === Boolean(hasPrompt)) validationErrors.push('give exactly one of a skill to run (starting with /) or a prompt');
  return validationErrors;
}

// The text of what the routine does: the skill line or the prompt.
export function describeRoutineAction(routineDefinition) {
  return routineDefinition.action?.skill || routineDefinition.action?.prompt || '';
}

export function addRoutine(sharedRoot, routineId, { title, every, skill, prompt, replace = false, now = new Date() }) {
  if (!ROUTINE_ID_PATTERN.test(routineId || '')) throw new Error(`routine id "${routineId}" must be lower-case letters, digits and dashes`);
  const routines = readRoutines(sharedRoot);
  if (routines[routineId] && !replace) throw new Error(`you already have a routine "${routineId}": --replace changes it`);
  const routineDefinition = { every, action: skill ? { skill } : { prompt }, created: now.toISOString() };
  const validationErrors = validateRoutine(routineDefinition);
  if (validationErrors.length) throw new Error(`routine ${routineId}: ${validationErrors.join('; ')}`);
  routineDefinition.title = title || describeRoutineAction(routineDefinition).split(/\s+/).slice(0, 8).join(' ');
  writeRoutines(sharedRoot, { ...routines, [routineId]: routineDefinition });
  return routineDefinition;
}

export function removeRoutine(sharedRoot, routineId) {
  const routines = readRoutines(sharedRoot);
  const existed = Boolean(routines[routineId]);
  delete routines[routineId];
  writeRoutines(sharedRoot, routines);
  return existed;
}

// mode 'off' or 'notify'; snoozeDays sets snoozedUntil; both clear an earlier snooze when unset.
export function updatePersonalRoutineSetting(sharedRoot, routineId, { mode, snoozeDays, now = new Date() }) {
  const routines = readRoutines(sharedRoot);
  if (!routines[routineId]) return null;
  const { mode: previousMode, snoozedUntil: previousSnooze, ...routineDefinition } = routines[routineId];
  routines[routineId] = { ...routineDefinition, ...(mode === 'off' ? { mode: 'off' } : {}), ...(snoozeDays !== undefined ? { snoozedUntil: snoozeUntil(snoozeDays, now) } : {}) };
  writeRoutines(sharedRoot, routines);
  return routines[routineId];
}

export function readRoutineRecords(sharedRoot) {
  const routineRecords = readPersonState(sharedRoot).routines;
  return routineRecords && typeof routineRecords === 'object' ? routineRecords : {};
}

export function updateRoutineRecord(sharedRoot, routineId, updateRecord) {
  const personState = readPersonState(sharedRoot);
  const routineRecords = { ...personState.routines };
  routineRecords[routineId] = updateRecord({ ...routineRecords[routineId] });
  writePersonState(sharedRoot, { ...personState, routines: routineRecords });
  return routineRecords[routineId];
}

// how: 'here' (done in this session), 'launched' (opened in a new conversation), 'told' (a built-in routine was told).
export function recordRoutineRun(sharedRoot, routineId, { how, note, now = new Date() }) {
  return updateRoutineRecord(sharedRoot, routineId, (routineRecord) => ({
    ...routineRecord,
    lastRun: now.toISOString(),
    history: [...(routineRecord.history || []), { at: now.toISOString(), how, ...(note ? { note } : {}) }].slice(-MAX_ROUTINE_HISTORY),
  }));
}

// A launched run still within its period gets the note; otherwise this is a run done now.
export function recordRoutineDone(sharedRoot, routineId, routineDefinition, note, now = new Date()) {
  const routineRecord = readRoutineRecords(sharedRoot)[routineId];
  const latestRun = routineRecord?.history?.at(-1);
  const launchStillCurrent = latestRun?.how === 'launched' && !latestRun.note && !isRoutineDue(routineDefinition.every, routineRecord, routineDefinition.created, now);
  if (!launchStillCurrent) return recordRoutineRun(sharedRoot, routineId, { how: 'here', note, now });
  return updateRoutineRecord(sharedRoot, routineId, (currentRecord) => ({
    ...currentRecord,
    history: currentRecord.history.map((historyEntry, entryIndex) => (entryIndex === currentRecord.history.length - 1 ? { ...historyEntry, ...(note ? { note } : {}), doneAt: now.toISOString() } : historyEntry)),
  }));
}
