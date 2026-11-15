// `ai1 delegate`: a change to another repository made by a session started there (see
// src/delegate/delegate-session.mjs).
//   ai1 delegate --cwd <repo> (--brief <file> | "<task>") [--permission-mode <mode>] [--max-turns <n>] [--timeout <minutes>] [--claude-command "<cmd>"]
//   ai1 delegate --resume <session-id> [--allow-once "<command>"] "<the person's answer>" [--timeout <minutes>]
//   ai1 delegate allow <repo> --because "<the person's words>"   edits of <repo> allowed for this session
//   ai1 delegate show <session-id>                              the saved result of a delegation
// --claude-command (or AI1_CLAUDE_COMMAND): how to start Claude Code, default `claude`; a resume reuses it.
// The result is JSON on stdout (also saved under .ai1/work/delegations/). The session that runs it is
// the caller: its launch directory (CLAUDE_PROJECT_DIR) and id (CLAUDE_CODE_SESSION_ID) key the state.

import { resolve } from 'node:path';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { readDelegationRecord, resumeDelegation, startDelegation } from '../delegate/delegate-session.mjs';
import { allowRepository } from '../delegate/delegate-state.mjs';
import { runExternalCommand } from '../session/fork-session.mjs';

export const DELEGATE_USAGE = 'usage: ai1 delegate --cwd <repo> (--brief <file> | "<task>") [--permission-mode <mode>] [--max-turns <n>] [--timeout <minutes>] [--claude-command "<cmd>"] | --resume <session-id> [--allow-once "<command>"] "<answer>" | allow <repo> --because "<the person\'s words>" | show <session-id>';

const OPTIONS_WITH_VALUE = new Set(['--cwd', '--brief', '--permission-mode', '--max-turns', '--timeout', '--resume', '--allow-once', '--because', '--claude-command']);

// The arguments that are not options or option values (the inline task or the answer).
function listPositionalArguments(commandArguments) {
  const positionalArguments = [];
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (OPTIONS_WITH_VALUE.has(commandArgument)) argumentIndex += 1;
    else if (!commandArgument.startsWith('--')) positionalArguments.push(commandArgument);
  }
  return positionalArguments;
}

export function runDelegateCommand(workingDirectory, commandArguments, { readOption, environment = process.env, runCommand = runExternalCommand, writeOutput = console.log }) {
  const launchRoot = resolve(environment.CLAUDE_PROJECT_DIR || workingDirectory);
  const callerSessionId = environment.CLAUDE_CODE_SESSION_ID || null;
  const [subcommandName, subcommandTarget] = commandArguments;
  const printJson = (resultValue) => writeOutput(JSON.stringify(resultValue, null, 2));

  if (subcommandName === 'allow') {
    const becauseText = readOption('--because');
    if (!subcommandTarget || !becauseText) {
      writeOutput(DELEGATE_USAGE);
      return 1;
    }
    if (!callerSessionId) throw new Error('CLAUDE_CODE_SESSION_ID is not set: run this from the Claude Code session that should edit the repository');
    const repoRoot = describeOwningRepository(resolve(workingDirectory, subcommandTarget), launchRoot)?.repoRoot;
    if (!repoRoot) throw new Error(`${subcommandTarget} is not inside a git repository`);
    allowRepository(callerSessionId, launchRoot, repoRoot, becauseText, environment);
    printJson({ allowed: repoRoot, because: becauseText, session_id: callerSessionId });
    return 0;
  }
  if (subcommandName === 'show') {
    const delegationRecord = readDelegationRecord(launchRoot, subcommandTarget);
    if (!delegationRecord) throw new Error(`no delegation ${subcommandTarget} recorded here`);
    printJson(delegationRecord);
    return 0;
  }
  const positionalText = listPositionalArguments(commandArguments).join(' ').trim();
  if (readOption('--resume')) {
    printJson(resumeDelegation({ sessionId: readOption('--resume'), answerText: positionalText, allowOnceSubject: readOption('--allow-once'), timeoutMinutes: readOption('--timeout'), claudeCommand: readOption('--claude-command'), launchRoot, environment, runCommand }));
    return 0;
  }
  if (readOption('--cwd')) {
    printJson(startDelegation({
      targetDirectory: resolve(workingDirectory, readOption('--cwd')),
      briefPath: readOption('--brief') ? resolve(workingDirectory, readOption('--brief')) : null,
      taskText: positionalText,
      permissionMode: readOption('--permission-mode'),
      maxTurns: readOption('--max-turns'),
      timeoutMinutes: readOption('--timeout'),
      claudeCommand: readOption('--claude-command'),
      launchRoot,
      callerSessionId,
      environment,
      runCommand,
    }));
    return 0;
  }
  writeOutput(DELEGATE_USAGE);
  return 1;
}
