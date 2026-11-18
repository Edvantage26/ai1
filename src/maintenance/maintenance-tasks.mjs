// Maintenance tasks (feature `maintenance`): work that keeps ai1 healthy in a repo, offered only to the
// people who maintain it there (src/core/person-project.mjs). Two kinds:
// - condition: shown by its own module when a check finds something (claude-md drift in okf-claude-md,
//   bundle health in okf-index); they keep their own dedupe, this file only gates who sees them.
// - periodic: run by maintenance-notice at session start, at most every `everyDays` days and only after
//   SESSIONS_BETWEEN_NOTICES session starts since the last notice (time and activity, so a repo opened
//   once a month does not get every task at once); `check` returns a one-line summary or null.
// The person mutes a task with `ai1 maintain off|snooze <id>` (profile.json `tasks`).

import { isFeatureEnabled } from '../core/features.mjs';
import { isPersonMaintainer, readPersonProfile, writePersonProfile } from '../core/person-project.mjs';
import { listLaterEntries, OPEN_LATER_STATUSES, padEntryNumber } from '../later/later-documents.mjs';

export const SESSIONS_BETWEEN_NOTICES = 3;
export const DEFAULT_SNOOZE_DAYS = 7;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;
const STALE_LATER_DAYS = 60;

function listStaleLaterEntries(projectRoot, now) {
  return listLaterEntries(projectRoot).filter((laterEntry) => OPEN_LATER_STATUSES.has(laterEntry.status)
    && /^\d{4}-\d{2}-\d{2}$/.test(laterEntry.updated || '')
    && now.getTime() - Date.parse(`${laterEntry.updated}T00:00:00Z`) > STALE_LATER_DAYS * DAY_MILLISECONDS);
}

export const MAINTENANCE_TASKS = [
  { id: 'claude-md-drift', kind: 'condition', feature: 'okf', title: 'CLAUDE.md drifts from the knowledge bundle (okf-claude-md)' },
  { id: 'bundle-health', kind: 'condition', feature: 'okf', title: 'Concepts the overview or the indexes miss (okf-index)' },
  {
    id: 'later-backlog',
    kind: 'periodic',
    feature: 'later',
    everyDays: 7,
    title: `Later entries open and untouched for over ${STALE_LATER_DAYS} days`,
    check({ projectRoot, now }) {
      const staleEntries = listStaleLaterEntries(projectRoot, now);
      if (!staleEntries.length) return null;
      return `${staleEntries.length} later entr${staleEntries.length === 1 ? 'y' : 'ies'} open and untouched for over ${STALE_LATER_DAYS} days (${staleEntries.slice(0, 3).map((laterEntry) => padEntryNumber(laterEntry.fileNumber)).join(', ')}${staleEntries.length > 3 ? ', ...' : ''}): review whether to accept, reject or update them`;
    },
  },
];

export function findMaintenanceTask(taskId) {
  return MAINTENANCE_TASKS.find((maintenanceTask) => maintenanceTask.id === taskId);
}

export function readTaskSetting(sharedRoot, taskId) {
  const taskSettings = readPersonProfile(sharedRoot).tasks;
  return taskSettings && typeof taskSettings === 'object' ? taskSettings[taskId] || {} : {};
}

export function isTaskMuted(taskSetting, now = new Date()) {
  if (taskSetting.mode === 'off') return true;
  return typeof taskSetting.snoozedUntil === 'string' && Date.parse(taskSetting.snoozedUntil) > now.getTime();
}

// Whether a task is shown to the person running this session. With the maintenance feature off, the
// condition tasks behave as before it existed (shown to everyone) and the periodic ones do not run.
export function shouldShowMaintenanceTask(taskId, { config, sharedRoot, projectRoot = sharedRoot, now = new Date() }) {
  const maintenanceTask = findMaintenanceTask(taskId);
  if (!config || !isFeatureEnabled('maintenance', config)) return maintenanceTask?.kind === 'condition';
  if (!maintenanceTask || !isFeatureEnabled(maintenanceTask.feature, config)) return false;
  if (!isPersonMaintainer({ config, sharedRoot, projectRoot })) return false;
  return !isTaskMuted(readTaskSetting(sharedRoot, taskId), now);
}

// mode: 'notify' (default) or 'off'; snoozeDays sets snoozedUntil (from now); both clear the snooze when unset.
export function updateTaskSetting(sharedRoot, taskId, { mode, snoozeDays, now = new Date() }) {
  if (!findMaintenanceTask(taskId)) throw new Error(`unknown maintenance task "${taskId}" (${MAINTENANCE_TASKS.map((maintenanceTask) => maintenanceTask.id).join(', ')})`);
  const personProfile = readPersonProfile(sharedRoot);
  const taskSettings = personProfile.tasks && typeof personProfile.tasks === 'object' ? { ...personProfile.tasks } : {};
  const taskSetting = { mode: mode || 'notify' };
  if (snoozeDays !== undefined) taskSetting.snoozedUntil = new Date(now.getTime() + snoozeDays * DAY_MILLISECONDS).toISOString();
  taskSettings[taskId] = taskSetting;
  writePersonProfile(sharedRoot, { ...personProfile, tasks: taskSettings });
  return taskSetting;
}
