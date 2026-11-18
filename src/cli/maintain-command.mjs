// `ai1 maintain`: the maintenance tasks for the person in this repo - their role, each task's state, and
// muting one for themselves (`off`, `on`, `snooze <task> [days]`), written in their ignored .ai1/local/.

import { loadHarnessConfig } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/module-index.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { readPersonState, resolvePersonRole } from '../core/person-project.mjs';
import { MAINTENANCE_TASKS, DEFAULT_SNOOZE_DAYS, isTaskMuted, readTaskSetting, updateTaskSetting } from '../maintenance/maintenance-tasks.mjs';

export const MAINTAIN_USAGE = 'ai1 maintain [--json] | ai1 maintain off|on <task> | ai1 maintain snooze <task> [days]';

export function describeMaintenance(repoRoot, now = new Date()) {
  const sharedRoot = findMainCheckout(repoRoot);
  const loadedConfig = loadHarnessConfig(repoRoot, KNOWN_MODULE_IDS);
  const config = loadedConfig.status === 'ok' ? loadedConfig.config : {};
  const taskRecords = readPersonState(sharedRoot).maintenance?.tasks || {};
  return {
    personRole: resolvePersonRole({ config, sharedRoot, projectRoot: repoRoot }),
    tasks: MAINTENANCE_TASKS.map((maintenanceTask) => {
      const taskSetting = readTaskSetting(sharedRoot, maintenanceTask.id);
      return {
        id: maintenanceTask.id,
        kind: maintenanceTask.kind,
        title: maintenanceTask.title,
        mode: taskSetting.mode || 'notify',
        snoozedUntil: isTaskMuted(taskSetting, now) && taskSetting.mode !== 'off' ? taskSetting.snoozedUntil : null,
        lastRun: taskRecords[maintenanceTask.id]?.lastRun || null,
        lastNotified: taskRecords[maintenanceTask.id]?.lastNotified || null,
      };
    }),
  };
}

export function runMaintainCommand(repoRoot, commandArguments, now = new Date()) {
  const [subcommandName, taskId, daysText] = commandArguments.filter((commandArgument) => commandArgument !== '--json');
  const sharedRoot = findMainCheckout(repoRoot);
  if (!subcommandName) {
    const maintenanceDescription = describeMaintenance(repoRoot, now);
    if (commandArguments.includes('--json')) return { output: JSON.stringify(maintenanceDescription, null, 2), exitCode: 0 };
    return {
      output: [
        `your role here: ${maintenanceDescription.personRole.role}${maintenanceDescription.personRole.role === 'developer' ? ' (no maintenance tasks are shown to you)' : ''}`,
        ...maintenanceDescription.tasks.map((taskDescription) => `  ${taskDescription.id} (${taskDescription.kind}): ${taskDescription.snoozedUntil ? `snoozed until ${taskDescription.snoozedUntil.slice(0, 10)}` : taskDescription.mode}`
          + `${taskDescription.lastNotified ? `, last told ${taskDescription.lastNotified.slice(0, 10)}` : ''} - ${taskDescription.title}`),
      ].join('\n'),
      exitCode: 0,
    };
  }
  if (!['off', 'on', 'snooze'].includes(subcommandName) || !taskId) return { output: `usage: ${MAINTAIN_USAGE}`, exitCode: 1 };
  const snoozeDays = subcommandName === 'snooze' ? Number(daysText ?? DEFAULT_SNOOZE_DAYS) : undefined;
  if (snoozeDays !== undefined && !(snoozeDays > 0)) return { output: 'snooze days must be a positive number', exitCode: 1 };
  const taskSetting = updateTaskSetting(sharedRoot, taskId, { mode: subcommandName === 'off' ? 'off' : 'notify', snoozeDays, now });
  const outcomeText = { off: 'off: it will not be shown to you again in this repo', on: 'on', snooze: `snoozed until ${taskSetting.snoozedUntil?.slice(0, 10)}` }[subcommandName];
  return { output: `${taskId}: ${outcomeText} (.ai1/local/profile.json, only yours)`, exitCode: 0 };
}
