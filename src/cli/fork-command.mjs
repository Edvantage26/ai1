// `ai1 fork`: a new conversation from this one (see src/session/fork-session.mjs).
//   full  [--title "<t>"] [--task "<first instruction>"]   copy of the whole conversation
//   brief --file <brief.md> [--title "<t>"] [--cwd <dir>]    clean conversation from a handoff, started in <dir> (default: repo root)
//   turns [--last <n>]                                        the person's turns of this conversation, numbered
//   split --at <turn> --side "<side task>" --slug <slug> [--title "<t>"] [--note-file <f>]
//                                                             after the fact: the main line goes on in a copy cut
//                                                             before turn <turn>; the side task stays here and writes
//                                                             its result to the handoff <slug>-result
//   brief-path <slug>                                         where to write the handoff
//   host                                                      what host was detected and why
// Every command takes --opener <auto|vscode|desktop|terminal> (the person's fork_opener option).
// full, split and brief take --open-command "<cmd>" (or AI1_FORK_COMMAND): the person's own command that opens
// the fork in another tool, with {mode} {cwd} {title} {brief_file} {task_file} {original_session_id}
// {session_id} {resume_at} filled shell-quoted; full and split also take --claude-command (how to start Claude Code).
// Every command takes --json.

import { applyForkOpener, detectForkHost } from '../session/fork-host.mjs';
import { readFileSync } from 'node:fs';
import { readPersonTurns } from '../session/conversation-turns.mjs';
import { describeSplitSeed, forkFullConversation, startBriefConversation, resolveHandoffPath, runExternalCommand } from '../session/fork-session.mjs';

export const FORK_USAGE = 'usage: ai1 fork full [--title "<t>"] [--task "<first instruction>"] [--claude-command "<cmd>"] | brief --file <brief.md> [--title "<t>"] [--cwd <dir>] | turns [--last <n>] | split --at <turn> --side "<side task>" --slug <slug> [--title "<t>"] [--note-file <f>] [--claude-command "<cmd>"] | brief-path <slug> | host  (full, split and brief take --open-command "<cmd>"; all take --opener <auto|vscode|desktop|terminal> and --json)';

export function describeForkResult(forkResult) {
  return [
    `${{ full: 'forked the whole conversation', split: 'split the conversation', brief: 'started a conversation from the brief' }[forkResult.mode]}: "${forkResult.title}" (host ${forkResult.host.id}: ${forkResult.host.reason})`,
    ...(forkResult.sessionId ? [`session ${forkResult.sessionId} (from ${forkResult.originalSessionId})`] : []),
    ...(forkResult.briefPath ? [`brief: ${forkResult.briefPath}`] : []),
    ...(forkResult.resultPath ? [`the main line goes on in the new session; the side task stays here and writes its result to ${forkResult.resultPath}`] : []),
    ...(forkResult.notice ? [`note: ${forkResult.notice}`] : []),
    ...(forkResult.opened === 'command' ? ['opened with your fork opener command', ...(forkResult.output ? [forkResult.output] : [])] : []),
    ...(forkResult.opened === 'vscode' ? ['opened in VS Code'] : []),
    ...(forkResult.opened === 'command' ? [] : ['open it with:', ...forkResult.openWith.map((openOption) => `  ${openOption.label}: ${openOption.command}`)]),
    ...(forkResult.task && forkResult.opened !== 'command' ? [`then send it: ${forkResult.task}`] : []),
    ...(!forkResult.opened && forkResult.host.id !== 'web' ? ['note: to have forks open in another tool, see "Open forks in another tool" in /ai1:session-fork-conversation'] : []),
  ].join('\n');
}

function requireSessionId(environment) {
  if (!environment.CLAUDE_CODE_SESSION_ID) throw new Error('CLAUDE_CODE_SESSION_ID is not set: run this from a Claude Code session');
  return environment.CLAUDE_CODE_SESSION_ID;
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
  if (subcommandName === 'turns') {
    const personTurns = readPersonTurns(requireSessionId(environment), environment);
    const lastCount = Number(readOption('--last')) || personTurns.length;
    const shownTurns = personTurns.slice(-lastCount);
    printResult(shownTurns, shownTurns.map((personTurn) => `${personTurn.number}. ${personTurn.timestamp ? `[${personTurn.timestamp.slice(0, 16).replace('T', ' ')}] ` : ''}${personTurn.preview}`).join('\n') || 'no turns of the person in this conversation');
    return 0;
  }
  if (subcommandName === 'split') {
    const originalSessionId = requireSessionId(environment);
    const personTurns = readPersonTurns(originalSessionId, environment);
    const cutTurn = personTurns.find((personTurn) => String(personTurn.number) === String(readOption('--at')));
    if (!cutTurn) throw new Error(`--at must be the number of one of the person's turns (1-${personTurns.length}; see \`ai1 fork turns\`)`);
    if (!cutTurn.cutBeforeMessageId) throw new Error(`turn ${cutTurn.number} has no answer before it to cut at: the side task started the conversation, so use a brief fork for the main task instead`);
    const sideTitle = readOption('--side');
    if (!sideTitle) throw new Error('--side "<side task>" is required: what goes on in this conversation');
    if (!readOption('--slug')) throw new Error('--slug <slug> is required: the side task writes its result to the handoff <slug>-result');
    const resultPath = resolveHandoffPath(repoRoot, `${readOption('--slug')}-result`);
    const noteFile = readOption('--note-file');
    const seedText = describeSplitSeed({ originalSessionId, cutTurn, sideTitle, resultPath, mainLineNote: noteFile ? readFileSync(noteFile, 'utf8').trim() : '' });
    const forkResult = forkFullConversation({ environment, cwd: repoRoot, host, title: readOption('--title') || `Main line (before: ${sideTitle})`, cut: { messageId: cutTurn.cutBeforeMessageId, seedText }, openCommand: readOption('--open-command'), claudeCommand: readOption('--claude-command'), runCommand });
    Object.assign(forkResult, { cutTurn, sideTitle, resultPath });
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
