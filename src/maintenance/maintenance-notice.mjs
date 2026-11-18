// maintenance-notice (SessionStart, feature `maintenance`): for a maintainer, counts session starts and
// says in one line which periodic maintenance tasks found something (src/maintenance/maintenance-tasks.mjs),
// each at most every `everyDays` days and SESSIONS_BETWEEN_NOTICES session starts. Records the notice
// in `.ai1/local/state.json`. Silent for developers, muted tasks and resumed sessions.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { isPersonMaintainer, readPersonState, writePersonState } from '../core/person-project.mjs';
import { MAINTENANCE_TASKS, SESSIONS_BETWEEN_NOTICES, isTaskMuted, readTaskSetting } from './maintenance-tasks.mjs';

const MODULE_ID = 'maintenance-notice';
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function isTaskDue(taskRecord, maintenanceTask, sessionStartsCount, now) {
  if (!taskRecord?.lastNotified) return true;
  const daysSinceNotice = (now.getTime() - Date.parse(taskRecord.lastNotified)) / DAY_MILLISECONDS;
  return daysSinceNotice >= maintenanceTask.everyDays && sessionStartsCount - (taskRecord.sessionStartsAtNotice || 0) >= SESSIONS_BETWEEN_NOTICES;
}

export function runMaintenanceNotice({ hookInput = {}, config, projectRoot, sharedRoot, now = new Date() }) {
  if (hookInput.source && hookInput.source !== 'startup') return allowDecision();
  if (!isPersonMaintainer({ config, sharedRoot, projectRoot })) return allowDecision();
  const personState = readPersonState(sharedRoot);
  const maintenanceState = personState.maintenance && typeof personState.maintenance === 'object' ? personState.maintenance : {};
  const sessionStartsCount = (maintenanceState.sessionStartsCount || 0) + 1;
  const taskRecords = { ...maintenanceState.tasks };
  const foundSummaries = [];
  for (const maintenanceTask of MAINTENANCE_TASKS.filter((candidateTask) => candidateTask.kind === 'periodic')) {
    if (!isFeatureEnabled(maintenanceTask.feature, config)) continue;
    if (isTaskMuted(readTaskSetting(sharedRoot, maintenanceTask.id), now)) continue;
    if (!isTaskDue(taskRecords[maintenanceTask.id], maintenanceTask, sessionStartsCount, now)) continue;
    const taskSummary = maintenanceTask.check({ projectRoot, sharedRoot, config, now });
    taskRecords[maintenanceTask.id] = { ...taskRecords[maintenanceTask.id], lastRun: now.toISOString(), lastResult: taskSummary ? 'found' : 'clean' };
    if (!taskSummary) continue;
    taskRecords[maintenanceTask.id] = { ...taskRecords[maintenanceTask.id], lastNotified: now.toISOString(), sessionStartsAtNotice: sessionStartsCount };
    foundSummaries.push(`${maintenanceTask.id}: ${taskSummary}`);
  }
  writePersonState(sharedRoot, { ...personState, maintenance: { ...maintenanceState, sessionStartsCount, tasks: taskRecords } });
  if (!foundSummaries.length) return allowDecision();
  return contextDecision(MODULE_ID, `ai1/maintenance: maintenance for you as maintainer of ai1 in this repo - ${foundSummaries.join('; ')}. `
    + 'Tell the person in one line and offer to do it now. If they say not now: `ai1 maintain snooze <task>`; if they never want it: `ai1 maintain off <task>`.');
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'maintenance',
  description: 'Tells a maintainer in one line which periodic maintenance tasks found something, at most every few days and sessions.',
  run: runMaintenanceNotice,
};
