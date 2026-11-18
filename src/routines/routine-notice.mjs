// routine-notice (SessionStart, feature `routines`): one line with the routines that are due for the
// person - their own (.ai1/local/routines.json; offered at most once per local day) and, for a
// maintainer, ai1's built-in ones (src/maintenance/maintenance-tasks.mjs `periodic`: a check run here,
// told only when it finds something, at most every `everyDays` days and SESSIONS_BETWEEN_NOTICES
// session starts). Replaces maintenance-notice (v0.49.0). Records offers and notices in
// .ai1/local/state.json; never runs a routine.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { isPersonMaintainer, readPersonState, writePersonState } from '../core/person-project.mjs';
import { MAINTENANCE_TASKS, SESSIONS_BETWEEN_NOTICES, readTaskSetting } from '../maintenance/maintenance-tasks.mjs';
import { describeRoutineAction, isRoutineDue, isRoutineMuted, localDayKey, readRoutines } from './routine-store.mjs';

const MODULE_ID = 'routine-notice';
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

function isBuiltInDue(routineRecord, maintenanceTask, sessionStartsCount, now) {
  if (!routineRecord?.lastRun) return true;
  const daysSinceNotice = (now.getTime() - Date.parse(routineRecord.lastRun)) / DAY_MILLISECONDS;
  return daysSinceNotice >= maintenanceTask.everyDays && sessionStartsCount - (routineRecord.sessionStartsAtNotice || 0) >= SESSIONS_BETWEEN_NOTICES;
}

// What ai1 itself checks for maintainers: [{ id, summary }] found now, recorded as told.
function collectBuiltInRoutines({ config, projectRoot, sharedRoot, routineRecords, sessionStartsCount, now }) {
  const foundRoutines = [];
  for (const maintenanceTask of MAINTENANCE_TASKS.filter((candidateTask) => candidateTask.kind === 'periodic')) {
    if (!isFeatureEnabled(maintenanceTask.feature, config) || isRoutineMuted(readTaskSetting(sharedRoot, maintenanceTask.id), now)) continue;
    if (!isBuiltInDue(routineRecords[maintenanceTask.id], maintenanceTask, sessionStartsCount, now)) continue;
    const taskSummary = maintenanceTask.check({ projectRoot, sharedRoot, config, now });
    if (!taskSummary) continue;
    routineRecords[maintenanceTask.id] = { ...routineRecords[maintenanceTask.id], lastRun: now.toISOString(), sessionStartsAtNotice: sessionStartsCount };
    foundRoutines.push({ id: maintenanceTask.id, summary: taskSummary });
  }
  return foundRoutines;
}

export function runRoutineNotice({ hookInput = {}, config = {}, projectRoot, sharedRoot = projectRoot, now = new Date() }) {
  if (hookInput.source && !['startup', 'clear'].includes(hookInput.source)) return allowDecision();
  const personalRoutines = Object.entries(readRoutines(sharedRoot));
  const personState = readPersonState(sharedRoot);
  const routineRecords = { ...personState.routines };
  const sessionStartsCount = (personState.routineSessionStarts || 0) + 1;
  // Built-in routines need session starts counted for maintainers, even when nothing is found.
  const runsBuiltIns = isFeatureEnabled('maintenance', config) && isPersonMaintainer({ config, sharedRoot, projectRoot });
  const builtInRoutines = runsBuiltIns ? collectBuiltInRoutines({ config, projectRoot, sharedRoot, routineRecords, sessionStartsCount, now }) : [];
  const todayKey = localDayKey(now);
  const dueRoutines = personalRoutines.filter(([routineId, routineDefinition]) => !isRoutineMuted(routineDefinition, now)
    && isRoutineDue(routineDefinition.every, routineRecords[routineId], routineDefinition.created, now)
    && routineRecords[routineId]?.lastOffered !== todayKey);
  for (const [routineId] of dueRoutines) routineRecords[routineId] = { ...routineRecords[routineId], lastOffered: todayKey };
  if (runsBuiltIns || personalRoutines.length) {
    writePersonState(sharedRoot, { ...personState, routines: routineRecords, routineSessionStarts: sessionStartsCount });
  }
  const noticeParts = [];
  if (dueRoutines.length) {
    noticeParts.push(`ai1/routines: due for the person - ${dueRoutines.map(([routineId, routineDefinition]) => `${routineId}: ${routineDefinition.title} (\`${describeRoutineAction(routineDefinition)}\`)`).join('; ')}. `
      + 'Offer each in one line: do it here (then `ai1 routine done <id> "<result>"`), launch it in a new conversation the person sees (follow /ai1:routines-set-routine), '
      + '`ai1 routine snooze <id>` if not now, `ai1 routine off <id>` if never again.');
  }
  if (builtInRoutines.length) {
    noticeParts.push(`ai1/routines: maintenance for the person as maintainer of ai1 in this repo - ${builtInRoutines.map((builtInRoutine) => `${builtInRoutine.id}: ${builtInRoutine.summary}`).join('; ')}. `
      + 'Tell the person in one line and offer to do it now. Not now: `ai1 routine snooze <id>`; never: `ai1 routine off <id>`.');
  }
  return noticeParts.length ? contextDecision(MODULE_ID, noticeParts.join('\n')) : allowDecision();
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'routines',
  description: 'Says in one line which of the person\'s routines are due (offered once a day) and, for maintainers, what ai1\'s built-in routines found.',
  run: runRoutineNotice,
};
