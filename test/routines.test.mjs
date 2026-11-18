import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRoutineEvery, isRoutineDue, addRoutine, readRoutines, removeRoutine, updatePersonalRoutineSetting, isRoutineMuted,
  recordRoutineRun, recordRoutineDone, readRoutineRecords, localDayKey,
} from '../src/routines/routine-store.mjs';
import { SEALED_FILE_NAMES } from '../src/core/person-seal.mjs';
import { createTemporaryProject } from './helpers.mjs';

test('routine every: hours, days or a weekday; nothing else', () => {
  assert.deepEqual(parseRoutineEvery('12h'), { periodMilliseconds: 12 * 3600 * 1000 });
  assert.deepEqual(parseRoutineEvery('7d'), { periodMilliseconds: 7 * 86400 * 1000 });
  assert.deepEqual(parseRoutineEvery('Mon'), { weekdayIndex: 1 });
  assert.equal(parseRoutineEvery('0d'), null);
  assert.equal(parseRoutineEvery('weekly'), null);
});

test('routine due: a period since the last run or creation; a weekday since its last local midnight', () => {
  const created = '2026-11-10T09:00:00';
  assert.equal(isRoutineDue('7d', {}, new Date(created).toISOString(), new Date('2026-11-16T09:00:00')), false);
  assert.equal(isRoutineDue('7d', {}, new Date(created).toISOString(), new Date('2026-11-17T09:00:00')), true);
  assert.equal(isRoutineDue('7d', { lastRun: new Date('2026-11-17T08:00:00').toISOString() }, created, new Date('2026-11-18T09:00:00')), false);
  // 2026-11-16 is a Monday (local time).
  const createdSunday = new Date('2026-11-15T10:00:00').toISOString();
  assert.equal(isRoutineDue('mon', {}, createdSunday, new Date('2026-11-15T23:00:00')), false);
  assert.equal(isRoutineDue('mon', {}, createdSunday, new Date('2026-11-16T00:30:00')), true);
  assert.equal(isRoutineDue('mon', { lastRun: new Date('2026-11-16T10:00:00').toISOString() }, createdSunday, new Date('2026-11-20T10:00:00')), false);
  assert.equal(localDayKey(new Date(2026, 10, 8)), '2026-11-08');
});

test('routine add: in .ai1/local/routines.json only, sealed with the rest; ids, actions and repeats checked [routines:S1]', () => {
  const projectRoot = createTemporaryProject({});
  addRoutine(projectRoot, 'validate-bundle', { every: '7d', skill: '/ai1:okf-validate-bundle .ai1/okf', now: new Date('2026-11-18T10:00:00Z') });
  assert.deepEqual(readRoutines(projectRoot)['validate-bundle'], {
    every: '7d', action: { skill: '/ai1:okf-validate-bundle .ai1/okf' }, created: '2026-11-18T10:00:00.000Z', title: '/ai1:okf-validate-bundle .ai1/okf',
  });
  assert.equal(readFileSync(join(projectRoot, '.ai1', 'local', '.gitignore'), 'utf8'), '*\n');
  assert.ok(SEALED_FILE_NAMES.includes('routines.json'));
  assert.throws(() => addRoutine(projectRoot, 'validate-bundle', { every: '7d', prompt: 'x' }), /already have a routine "validate-bundle": --replace/);
  assert.throws(() => addRoutine(projectRoot, 'Bad', { every: '7d', prompt: 'x' }), /lower-case letters/);
  assert.throws(() => addRoutine(projectRoot, 'both', { every: '7d', skill: 'no-slash' }), /exactly one of a skill/);
  assert.throws(() => addRoutine(projectRoot, 'when', { every: 'weekly', prompt: 'x' }), /every must be/);
  addRoutine(projectRoot, 'validate-bundle', { every: 'mon', prompt: 'Check the bundle', title: 'Bundle check', replace: true });
  assert.equal(readRoutines(projectRoot)['validate-bundle'].title, 'Bundle check');
  assert.equal(removeRoutine(projectRoot, 'validate-bundle'), true);
  assert.equal(existsSync(join(projectRoot, '.ai1', 'local', 'state.json')), false, 'adding a routine writes no state');
});

test('routine settings and runs: snooze, off, a launch completed later by done, a done here [routines:S4]', () => {
  const projectRoot = createTemporaryProject({});
  const created = new Date('2026-11-01T10:00:00Z');
  const routineDefinition = addRoutine(projectRoot, 'deps', { every: '7d', prompt: 'Check outdated dependencies', now: created });
  const snoozed = updatePersonalRoutineSetting(projectRoot, 'deps', { snoozeDays: 1, now: new Date('2026-11-18T10:00:00Z') });
  assert.equal(snoozed.snoozedUntil, '2026-11-19T10:00:00.000Z');
  assert.equal(isRoutineMuted(snoozed, new Date('2026-11-18T20:00:00Z')), true);
  assert.equal(isRoutineMuted(snoozed, new Date('2026-11-19T11:00:00Z')), false);
  assert.equal(isRoutineMuted(updatePersonalRoutineSetting(projectRoot, 'deps', { mode: 'off' })), true);
  assert.deepEqual(updatePersonalRoutineSetting(projectRoot, 'deps', { mode: 'notify' }).mode, undefined);
  assert.equal(updatePersonalRoutineSetting(projectRoot, 'missing', { mode: 'off' }), null);

  recordRoutineRun(projectRoot, 'deps', { how: 'launched', now: new Date('2026-11-18T10:00:00Z') });
  recordRoutineDone(projectRoot, 'deps', routineDefinition, '2 outdated', new Date('2026-11-18T11:00:00Z'));
  assert.deepEqual(readRoutineRecords(projectRoot).deps.history, [{ at: '2026-11-18T10:00:00.000Z', how: 'launched', note: '2 outdated', doneAt: '2026-11-18T11:00:00.000Z' }]);
  recordRoutineDone(projectRoot, 'deps', routineDefinition, 'all fine', new Date('2026-11-26T11:00:00Z'));
  const routineRecord = readRoutineRecords(projectRoot).deps;
  assert.deepEqual(routineRecord.history.at(-1), { at: '2026-11-26T11:00:00.000Z', how: 'here', note: 'all fine' });
  assert.equal(routineRecord.lastRun, '2026-11-26T11:00:00.000Z');
});
