// `ai1 fork`: a new conversation from this one (see src/session/fork-session.mjs).
//   full  [--title "<t>"] [--task "<first instruction>"]   copy of the whole conversation
//   brief --file <brief.md> [--title "<t>"] [--cwd <dir>]    clean conversation from a handoff, started in <dir> (default: repo root)
//   brief-path <slug>                                         where to write the handoff
//   host                                                      what host was detected and why
// Every command takes --opener <auto|paseo|vscode|desktop|terminal> (the person's fork_opener option).
// Every command takes --json.

import { applyForkOpener, detectForkHost } from '../session/fork-host.mjs';
import { forkFullConversation, startBriefConversation, resolveHandoffPath, runExternalCommand } from '../session/fork-session.mjs';

export const FORK_USAGE = 'usage: ai1 fork full [--title "<t>"] [--task "<first instruction>"] | brief --file <brief.md> [--title "<t>"] [--cwd <dir>] | brief-path <slug> | host  (all take --opener <auto|paseo|vscode|desktop|terminal> and --json)';

function describeForkResult(forkResult) {
  return [
    `${forkResult.mode === 'full' ? 'forked the whole conversation' : 'started a conversation from the brief'}: "${forkResult.title}" (host ${forkResult.host.id}: ${forkResult.host.reason})`,
    ...(forkResult.sessionId ? [`session ${forkResult.sessionId} (from ${forkResult.originalSessionId})`] : []),
    ...(forkResult.agentId ? [`Paseo agent ${forkResult.agentId}`] : []),
    ...(forkResult.briefPath ? [`brief: ${forkResult.briefPath}`] : []),
    ...(forkResult.opened === 'vscode' ? ['opened in VS Code'] : []),
    'open it with:',
    ...forkResult.openWith.map((openOption) => `  ${openOption.label}: ${openOption.command}`),
    ...(forkResult.task && !forkResult.agentId ? [`then send it: ${forkResult.task}`] : []),
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
    const forkResult = forkFullConversation({ environment, cwd: repoRoot, host, title: readOption('--title'), task: readOption('--task'), runCommand });
    printResult(forkResult, describeForkResult(forkResult));
    return 0;
  }
  if (subcommandName === 'brief') {
    const forkResult = startBriefConversation({ environment, cwd: readOption('--cwd') || repoRoot, host, title: readOption('--title'), briefPath: readOption('--file'), runCommand });
    printResult(forkResult, describeForkResult(forkResult));
    return 0;
  }
  writeOutput(FORK_USAGE);
  return 1;
}
