// `ai1 fork`: a new conversation from this one (see src/session/fork-session.mjs).
//   full  [--title "<t>"] [--task "<first instruction>"]   copy of the whole conversation
//   brief --file <brief.md> [--title "<t>"] [--cwd <dir>]    clean conversation from a handoff, started in <dir> (default: repo root)
//   brief-path <slug>                                         where to write the handoff
//   host                                                      what host was detected and why
// Every command takes --opener <auto|vscode|desktop|terminal> (the person's fork_opener option).
// full and brief take --open-command "<cmd>" (or AI1_FORK_COMMAND): the person's own command that opens
// the fork in another tool, with {mode} {cwd} {title} {brief_file} {task_file} {original_session_id}
// {session_id} filled shell-quoted; full also takes --claude-command (how to start Claude Code).
// Every command takes --json.

import { applyForkOpener, detectForkHost } from '../session/fork-host.mjs';
import { forkFullConversation, startBriefConversation, resolveHandoffPath, runExternalCommand } from '../session/fork-session.mjs';

export const FORK_USAGE = 'usage: ai1 fork full [--title "<t>"] [--task "<first instruction>"] [--claude-command "<cmd>"] | brief --file <brief.md> [--title "<t>"] [--cwd <dir>] | brief-path <slug> | host  (full and brief take --open-command "<cmd>"; all take --opener <auto|vscode|desktop|terminal> and --json)';

function describeForkResult(forkResult) {
  return [
    `${forkResult.mode === 'full' ? 'forked the whole conversation' : 'started a conversation from the brief'}: "${forkResult.title}" (host ${forkResult.host.id}: ${forkResult.host.reason})`,
    ...(forkResult.sessionId ? [`session ${forkResult.sessionId} (from ${forkResult.originalSessionId})`] : []),
    ...(forkResult.briefPath ? [`brief: ${forkResult.briefPath}`] : []),
    ...(forkResult.notice ? [`note: ${forkResult.notice}`] : []),
    ...(forkResult.opened === 'command' ? ['opened with your fork opener command', ...(forkResult.output ? [forkResult.output] : [])] : []),
    ...(forkResult.opened === 'vscode' ? ['opened in VS Code'] : []),
    ...(forkResult.opened === 'command' ? [] : ['open it with:', ...forkResult.openWith.map((openOption) => `  ${openOption.label}: ${openOption.command}`)]),
    ...(forkResult.task && forkResult.opened !== 'command' ? [`then send it: ${forkResult.task}`] : []),
    ...(!forkResult.opened && forkResult.host.id !== 'web' ? ['note: to have forks open in another tool, see "Open forks in another tool" in /ai1:session-fork-conversation'] : []),
  ].join('\n');
}

export function runForkCommand(repoRoot, commandArguments, { readOption, environment = process.env, runCommand = runExternalCommand, platformName = process.platform, writeOutput = console.log }) {
  const [subcommandName, firstArgument] = commandArguments;
  const wantsJson = commandArguments.includes('--json');
  const { host, notice: openerNotice } = applyForkOpener(detectForkHost(environment, platformName), readOption('--opener'));
  if (openerNotice && !wantsJson) writeOutput(`note: ${openerNotice}`);
  const printResult = (commandResult, describedText) => writeOutput(wantsJson ? JSON.stringify(commandResult, null, 2) : describedText);

  if (subcommandName === 'host') {
    printResult(host, `host: ${host.id} (${host.reason})${host.canOpenInDesktop ? '; Claude Desktop available' : ''}`);
    return 0;
  }
  if (subcommandName === 'brief-path') {
    const handoffPath = resolveHandoffPath(repoRoot, firstArgument);
    printResult({ path: handoffPath }, handoffPath);
    return 0;
  }
  if (subcommandName === 'full') {
    const forkResult = forkFullConversation({ environment, cwd: repoRoot, host, title: readOption('--title'), task: readOption('--task'), openCommand: readOption('--open-command'), claudeCommand: readOption('--claude-command'), runCommand });
    printResult(forkResult, describeForkResult(forkResult));
    return 0;
  }
  if (subcommandName === 'brief') {
    const forkResult = startBriefConversation({ environment, cwd: readOption('--cwd') || repoRoot, host, title: readOption('--title'), briefPath: readOption('--file'), openCommand: readOption('--open-command'), runCommand });
    printResult(forkResult, describeForkResult(forkResult));
    return 0;
  }
  writeOutput(FORK_USAGE);
  return 1;
}
