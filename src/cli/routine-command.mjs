// `ai1 routine`: the person's periodic tasks in this repo (.ai1/local/routines.json) and ai1's built-in
// ones for maintainers (src/maintenance/maintenance-tasks.mjs), listed, muted and recorded the same way.
// `launch` opens a routine in a new conversation through the fork brief (src/session/fork-session.mjs).

import { writeFileSync } from 'node:fs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { loadHarnessConfig } from '../core/config.mjs';
import { KNOWN_MODULE_IDS } from '../core/module-index.mjs';
import { isPersonMaintainer } from '../core/person-project.mjs';
import { detectForkHost, applyForkOpener } from '../session/fork-host.mjs';
import { resolveHandoffPath, startBriefConversation, runExternalCommand } from '../session/fork-session.mjs';
import { MAINTENANCE_TASKS, findMaintenanceTask, readTaskSetting, updateTaskSetting } from '../maintenance/maintenance-tasks.mjs';
import {
  DEFAULT_ROUTINE_SNOOZE_DAYS, addRoutine, describeRoutineAction, isRoutineDue, isRoutineMuted, readRoutineRecords, readRoutines,
  recordRoutineDone, recordRoutineRun, removeRoutine, updatePersonalRoutineSetting,
} from '../routines/routine-store.mjs';
import { describeForkResult } from './fork-command.mjs';
import { splitCommandArguments } from './command-arguments.mjs';

export const ROUTINE_USAGE = 'ai1 routine list [--due] [--json] | ai1 routine add <id> --every <12h|7d|mon..sun> (--skill "/name args" | --prompt "<what to do>") [--title "<t>"] [--replace] | ai1 routine done <id> ["<result>"] | ai1 routine snooze <id> [days] | ai1 routine off|on|remove <id> | ai1 routine launch <id> [--opener <auto|vscode|desktop|terminal>] [--open-command "<cmd>"]';
const VALUE_OPTIONS = new Set(['--every', '--skill', '--prompt', '--title', '--opener', '--open-command']);
const PERIODIC_BUILT_INS = MAINTENANCE_TASKS.filter((maintenanceTask) => maintenanceTask.kind === 'periodic');

function loadConfig(repoRoot) {
  const loadedConfig = loadHarnessConfig(repoRoot, KNOWN_MODULE_IDS);
  return loadedConfig.status === 'ok' ? loadedConfig.config : {};
}

// Every routine this person has here: their own, and the built-in ones when they maintain ai1 here.
export function describeRoutines(repoRoot, now = new Date()) {
  const sharedRoot = findMainCheckout(repoRoot);
  const routineRecords = readRoutineRecords(sharedRoot);
  const personalRoutines = Object.entries(readRoutines(sharedRoot)).map(([routineId, routineDefinition]) => ({
    id: routineId,
    source: 'personal',
    title: routineDefinition.title,
    every: routineDefinition.every,
    action: describeRoutineAction(routineDefinition),
    muted: isRoutineMuted(routineDefinition, now) ? (routineDefinition.mode === 'off' ? 'off' : `snoozed until ${routineDefinition.snoozedUntil.slice(0, 10)}`) : null,
    due: !isRoutineMuted(routineDefinition, now) && isRoutineDue(routineDefinition.every, routineRecords[routineId], routineDefinition.created, now),
    lastRun: routineRecords[routineId]?.lastRun || null,
    lastNote: routineRecords[routineId]?.history?.at(-1)?.note || null,
  }));
  const isMaintainer = isPersonMaintainer({ config: loadConfig(repoRoot), sharedRoot, projectRoot: repoRoot });
  const builtInRoutines = isMaintainer ? PERIODIC_BUILT_INS.map((maintenanceTask) => {
    const taskSetting = readTaskSetting(sharedRoot, maintenanceTask.id);
    return {
      id: maintenanceTask.id,
      source: 'built-in',
      title: maintenanceTask.title,
      every: `${maintenanceTask.everyDays}d`,
      action: 'a check by ai1; told at session start when it finds something',
      muted: isRoutineMuted(taskSetting, now) ? (taskSetting.mode === 'off' ? 'off' : `snoozed until ${taskSetting.snoozedUntil.slice(0, 10)}`) : null,
      due: null,
      lastRun: routineRecords[maintenanceTask.id]?.lastRun || null,
      lastNote: null,
    };
  }) : [];
  return [...personalRoutines, ...builtInRoutines];
}

function formatRoutineLine(routineDescription) {
  const stateText = routineDescription.muted || (routineDescription.due ? 'due' : routineDescription.due === false ? 'not due' : 'checked by ai1');
  return `  ${routineDescription.id} (${routineDescription.source}, every ${routineDescription.every}): ${stateText} - ${routineDescription.title}`
    + `${routineDescription.lastRun ? `; last ${routineDescription.lastRun.slice(0, 10)}` : ''}${routineDescription.lastNote ? ` (${routineDescription.lastNote})` : ''}`;
}

function writeRoutineBrief(repoRoot, routineId, routineDefinition, lastNote) {
  const briefPath = resolveHandoffPath(repoRoot, `routine-${routineId}`);
  const routineAction = routineDefinition.action.skill ? `Run \`${routineDefinition.action.skill}\`.` : routineDefinition.action.prompt;
  writeFileSync(briefPath, [
    `# Routine: ${routineDefinition.title}`,
    '',
    `A periodic task the person set in this repository (every ${routineDefinition.every}). Do it now:`,
    '',
    routineAction,
    '',
    ...(lastNote ? [`Last time: ${lastNote}`, ''] : []),
    `When done, record what you found in one line: \`ai1 routine done ${routineId} "<what you found>"\`. Tell the person the result.`,
    '',
  ].join('\n'));
  return briefPath;
}

export function runRoutineCommandLine(repoRoot, commandArguments, { now = new Date(), environment = process.env, runCommand = runExternalCommand, platformName = process.platform } = {}) {
  const { positionalArguments, optionValues } = splitCommandArguments(commandArguments, VALUE_OPTIONS);
  const [subcommandName, routineId, ...restArguments] = positionalArguments;
  const sharedRoot = findMainCheckout(repoRoot);
  if (!subcommandName || subcommandName === 'list') {
    const routineDescriptions = describeRoutines(repoRoot, now).filter((routineDescription) => !optionValues['--due'] || routineDescription.due);
    if (optionValues['--json']) return { output: JSON.stringify(routineDescriptions, null, 2), exitCode: 0 };
    if (!routineDescriptions.length) return { output: optionValues['--due'] ? 'no routine is due' : 'no routines here yet (ai1 routine add)', exitCode: 0 };
    return { output: ['your routines here (.ai1/local/routines.json, only yours):', ...routineDescriptions.map(formatRoutineLine)].join('\n'), exitCode: 0 };
  }
  if (!routineId) return { output: `usage: ${ROUTINE_USAGE}`, exitCode: 1 };
  if (subcommandName === 'add') {
    const routineDefinition = addRoutine(sharedRoot, routineId, {
      title: optionValues['--title'], every: optionValues['--every'], skill: optionValues['--skill'], prompt: optionValues['--prompt'], replace: Boolean(optionValues['--replace']), now,
    });
    return { output: `${routineId}: every ${routineDefinition.every} - ${routineDefinition.title} (.ai1/local/routines.json, only yours; reminded at session start when due)`, exitCode: 0 };
  }
  const isBuiltIn = Boolean(findMaintenanceTask(routineId));
  const routineDefinition = readRoutines(sharedRoot)[routineId];
  if (!isBuiltIn && !routineDefinition) return { output: `no routine "${routineId}" here (ai1 routine list)`, exitCode: 1 };
  if (['off', 'on', 'snooze'].includes(subcommandName)) {
    const snoozeDays = subcommandName === 'snooze' ? Number(restArguments[0] ?? DEFAULT_ROUTINE_SNOOZE_DAYS) : undefined;
    if (snoozeDays !== undefined && !(snoozeDays > 0)) return { output: 'snooze days must be a positive number', exitCode: 1 };
    const settingChange = { mode: subcommandName === 'off' ? 'off' : 'notify', snoozeDays, now };
    const routineSetting = isBuiltIn ? updateTaskSetting(sharedRoot, routineId, settingChange) : updatePersonalRoutineSetting(sharedRoot, routineId, settingChange);
    const outcomeText = { off: 'off: not offered again until you turn it on', on: 'on', snooze: `snoozed until ${routineSetting.snoozedUntil?.slice(0, 10)}` }[subcommandName];
    return { output: `${routineId}: ${outcomeText}`, exitCode: 0 };
  }
  if (isBuiltIn) return { output: `${routineId} is one of ai1's built-in routines: it only takes off, on and snooze`, exitCode: 1 };
  if (subcommandName === 'remove') return { output: removeRoutine(sharedRoot, routineId) ? `${routineId}: removed` : `${routineId}: not found`, exitCode: 0 };
  if (subcommandName === 'done') {
    const routineRecord = recordRoutineDone(sharedRoot, routineId, routineDefinition, restArguments.join(' ') || undefined, now);
    return { output: `${routineId}: done, recorded (${routineRecord.history.at(-1).how === 'launched' ? 'the launched run' : 'run here'}); next when every ${routineDefinition.every} has passed`, exitCode: 0 };
  }
  if (subcommandName === 'launch') {
    const { host, notice: openerNotice } = applyForkOpener(detectForkHost(environment, platformName), optionValues['--opener']);
    const briefPath = writeRoutineBrief(repoRoot, routineId, routineDefinition, readRoutineRecords(sharedRoot)[routineId]?.history?.at(-1)?.note);
    const forkResult = startBriefConversation({ environment, cwd: repoRoot, host, title: `Routine: ${routineDefinition.title}`, briefPath, openCommand: optionValues['--open-command'], runCommand });
    if (forkResult.opened) recordRoutineRun(sharedRoot, routineId, { how: 'launched', now });
    return {
      output: [
        ...(openerNotice ? [`note: ${openerNotice}`] : []),
        describeForkResult(forkResult),
        forkResult.opened ? `${routineId}: recorded as launched; the new conversation records the result with ai1 routine done` : `${routineId}: not recorded yet - once the person opened it, the new conversation runs ai1 routine done ${routineId}`,
      ].join('\n'),
      exitCode: 0,
    };
  }
  return { output: `usage: ${ROUTINE_USAGE}`, exitCode: 1 };
}
