// `ai1 fork`: a new conversation from the current one, opened the native way on the host.
//   full   copies the whole conversation: `claude -p --resume <id> --fork-session --session-id <new>`
//          (one short turn; the original is left untouched).
//   brief  a clean conversation that starts from a written handoff file.
//   split  after the fact: a copy cut before the turn where a side task started (`--resume-session-at`),
//          for the main task to go on there, while the side task goes on in this conversation.
// VS Code gets the extension URI opened; elsewhere the ways to open it are returned for the person.
// A tool ai1 does not know (an agent manager, a multiplexer) opens it through the person's own command
// (`--open-command` / AI1_FORK_COMMAND, from their skill customization): placeholders filled
// shell-quoted, run with `sh -c`. Host-specific tooling is never part of the plugin.
// External programs go through `runCommand` so tests can fake `claude`, `code` and the command.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { AI1_DIRECTORY } from '../core/config.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { ensureWorkDirectoryIgnored } from '../sizing/sizing-work.mjs';
import { resolveClaudeCommand } from './claude-command.mjs';

const SEED_TIMEOUT_MILLISECONDS = 180_000;
const OPEN_COMMAND_TIMEOUT_MILLISECONDS = 180_000;
const MAX_COMMAND_OUTPUT_CHARACTERS = 2000;
export const OPEN_COMMAND_PLACEHOLDERS = ['mode', 'cwd', 'title', 'brief_file', 'task_file', 'original_session_id', 'session_id', 'resume_at'];
const VSCODE_URI_PREFIX = 'vscode://anthropic.claude-code/open';

export function runExternalCommand(programName, programArguments, { cwd, timeoutMilliseconds = 60_000, extraEnvironment } = {}) {
  const commandResult = spawnSync(programName, programArguments, { cwd, encoding: 'utf8', timeout: timeoutMilliseconds, env: extraEnvironment ? { ...process.env, ...extraEnvironment } : process.env });
  if (commandResult.error) return { status: 1, stdout: '', stderr: commandResult.error.message };
  return { status: commandResult.status ?? 1, stdout: commandResult.stdout || '', stderr: commandResult.stderr || '' };
}

function runOrThrow(runCommand, programName, programArguments, commandOptions) {
  const commandResult = runCommand(programName, programArguments, commandOptions);
  if (commandResult.status !== 0) {
    const errorText = (commandResult.stderr || commandResult.stdout || '').trim().split('\n').slice(-3).join(' ');
    throw new Error(`\`${programName} ${programArguments[0]}\` failed (exit ${commandResult.status})${errorText ? `: ${errorText}` : ''}`);
  }
  return commandResult.stdout;
}

function writeTemporaryText(fileText) {
  const temporaryPath = join(mkdtempSync(join(tmpdir(), 'ai1-fork-')), 'message.md');
  writeFileSync(temporaryPath, fileText);
  return temporaryPath;
}

function quoteForShell(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

// The person's opener command: --open-command, else AI1_FORK_COMMAND, else none.
export function resolveOpenCommand(openCommand, environment = process.env) {
  const commandText = String(openCommand || environment.AI1_FORK_COMMAND || '').trim();
  return commandText || null;
}

// The command with every `{placeholder}` replaced by its value, shell-quoted (empty when unused).
export function fillOpenCommand(commandTemplate, placeholderValues) {
  return commandTemplate.replace(/\{([a-z_]+)\}/g, (wholeMatch, placeholderName) => (
    OPEN_COMMAND_PLACEHOLDERS.includes(placeholderName) ? quoteForShell(placeholderValues[placeholderName] ?? '') : wholeMatch));
}

// Runs the opener; its stdout is reported. A failure throws with its last lines and `fallbackText`.
function runOpenCommand(runCommand, commandTemplate, placeholderValues, cwd, fallbackText) {
  const commandResult = runCommand('sh', ['-c', fillOpenCommand(commandTemplate, placeholderValues)], { cwd, timeoutMilliseconds: OPEN_COMMAND_TIMEOUT_MILLISECONDS });
  if (commandResult.status !== 0) {
    const errorText = (commandResult.stderr || commandResult.stdout || '').trim().split('\n').slice(-5).join(' ');
    throw new Error(`the fork opener command failed (exit ${commandResult.status})${errorText ? `: ${errorText}` : ''}${fallbackText ? `\n${fallbackText}` : ''}`);
  }
  return String(commandResult.stdout || '').trim().slice(-MAX_COMMAND_OUTPUT_CHARACTERS);
}

function describeOpenWith(openWith) {
  return ['open it instead with:', ...openWith.map((openOption) => `  ${openOption.label}: ${openOption.command}`)].join('\n');
}

// Opens the VS Code extension on a URI when the session runs in VS Code; best effort.
function openInVscode(runCommand, host, vscodeUri) {
  if (host.id !== 'vscode') return false;
  return runCommand('code', ['--open-url', vscodeUri], { timeoutMilliseconds: 15_000 }).status === 0;
}

// Where the skill writes a handoff: .ai1/work/handoffs/ when the repo uses ai1, else the temp dir.
export function resolveHandoffPath(repoRoot, handoffSlug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handoffSlug || '')) throw new Error(`invalid handoff slug "${handoffSlug}" (lowercase letters, digits and dashes)`);
  const usesAi1 = existsSync(join(repoRoot, AI1_DIRECTORY));
  // without the sizing feature nothing else writes .ai1/work/.gitignore, so the handoff would show in git
  if (usesAi1) ensureWorkDirectoryIgnored(repoRoot);
  const handoffDirectory = usesAi1 ? join(repoRoot, WORK_DIRECTORY, 'handoffs') : join(tmpdir(), 'ai1-handoffs');
  mkdirSync(handoffDirectory, { recursive: true });
  return join(handoffDirectory, `${handoffSlug}.md`);
}

// `cut` ({ messageId, seedText }) makes a split: the copy ends at that assistant message and starts with
// `seedText` instead of the plain fork seed.
export function forkFullConversation({ environment = process.env, cwd, host, title, task, cut, openCommand, claudeCommand, runCommand = runExternalCommand }) {
  if (host.id === 'web') throw new Error(`a ${cut ? 'split' : 'full fork'} is not possible on the web (claude.ai/code): use brief mode, or /branch in the session`);
  const originalSessionId = environment.CLAUDE_CODE_SESSION_ID;
  if (!originalSessionId) throw new Error('CLAUDE_CODE_SESSION_ID is not set: run this from a Claude Code session (or use brief mode)');
  const forkSessionId = randomUUID();
  const forkTitle = title || `Fork: ${originalSessionId.slice(0, 8)}`;
  const vscodeUri = `${VSCODE_URI_PREFIX}?session=${encodeURIComponent(forkSessionId)}`;
  const openWith = [
    { label: 'terminal', command: `claude --resume ${forkSessionId}` },
    { label: 'VS Code (same folder)', command: vscodeUri },
    ...(host.canOpenInDesktop ? [{ label: 'Claude Desktop', command: `claude --desktop --resume ${forkSessionId}` }] : []),
  ];
  if (host.id === 'desktop') openWith.unshift(openWith.pop());
  const forkMode = cut ? 'split' : 'full';
  const forkResult = { mode: forkMode, host, title: forkTitle, originalSessionId, sessionId: forkSessionId, openWith, task: task || null, ...(cut ? { resumeAt: cut.messageId } : {}) };

  const opener = resolveOpenCommand(openCommand, environment);
  if (opener) {
    // The person's command creates the forked session itself (its launcher, its model) and opens it.
    forkResult.output = runOpenCommand(runCommand, opener, {
      mode: forkMode, cwd, title: forkTitle, original_session_id: originalSessionId, session_id: forkSessionId,
      task_file: cut ? writeTemporaryText(cut.seedText) : (task ? writeTemporaryText(task) : ''), resume_at: cut ? cut.messageId : '',
    }, cwd, null);
    forkResult.opened = 'command';
    return forkResult;
  }
  const seedPrompt = cut ? cut.seedText : `You are a fork of session ${originalSessionId}, made with /ai1:session-fork-conversation. The conversation so far belongs to the original; from here on you are a separate session. Reply only: ready.`;
  const [claudeProgram, ...claudeArguments] = resolveClaudeCommand(claudeCommand, environment);
  runOrThrow(runCommand, claudeProgram, [
    ...claudeArguments,
    // The prompt goes right after -p: `--tools` takes every value that follows it, the prompt included.
    '-p', seedPrompt, '--resume', originalSessionId, '--fork-session', '--session-id', forkSessionId,
    ...(cut ? ['--resume-session-at', cut.messageId] : []), '--tools', '',
  ], { cwd, timeoutMilliseconds: SEED_TIMEOUT_MILLISECONDS });
  forkResult.opened = openInVscode(runCommand, host, vscodeUri) ? 'vscode' : null;
  return forkResult;
}

export function startBriefConversation({ environment = process.env, cwd, host, title, briefPath, openCommand, runCommand = runExternalCommand }) {
  if (!briefPath || !existsSync(briefPath)) throw new Error(`no brief file at ${briefPath}`);
  const briefText = readFileSync(briefPath, 'utf8').trim();
  if (!briefText) throw new Error(`the brief ${briefPath} is empty`);
  const headingMatch = /^#\s+(.+)$/m.exec(briefText);
  const conversationTitle = title || (headingMatch ? headingMatch[1].trim() : basename(briefPath, '.md'));
  const vscodeUri = `${VSCODE_URI_PREFIX}?prompt=${encodeURIComponent(briefText)}`;
  const openWith = host.id === 'web'
    ? [{ label: 'new web session', command: `paste the content of ${briefPath} as the first message` }]
    : [
      { label: 'terminal', command: `claude "$(cat ${quoteForShell(briefPath)})"` },
      { label: 'VS Code', command: vscodeUri },
      ...(host.canOpenInDesktop ? [{ label: 'Claude Desktop', command: `claude://code/new?q=${encodeURIComponent(briefText)}` }] : []),
    ];
  if (host.id === 'desktop') openWith.unshift(openWith.pop());
  const briefResult = { mode: 'brief', host, title: conversationTitle, briefPath, openWith };

  const opener = resolveOpenCommand(openCommand, environment);
  if (opener && host.id === 'web') briefResult.notice = 'the fork opener command is ignored on the web';
  if (opener && host.id !== 'web') {
    briefResult.output = runOpenCommand(runCommand, opener, { mode: 'brief', cwd, title: conversationTitle, brief_file: briefPath }, cwd, describeOpenWith(openWith));
    briefResult.opened = 'command';
    return briefResult;
  }
  briefResult.opened = openInVscode(runCommand, host, vscodeUri) ? 'vscode' : null;
  return briefResult;
}

// The seed of the main line after a split: what was moved out, where its result will be, what to do on return.
export function describeSplitSeed({ originalSessionId, cutTurn, sideTitle, resultPath, mainLineNote }) {
  return [
    `You are the main line of session ${originalSessionId}, split after the fact with /ai1:session-fork-conversation: this copy ends right before the person's turn ${cutTurn.number} ("${cutTurn.preview}").`,
    `From that turn on the conversation went into a side task, "${sideTitle}", which goes on in session ${originalSessionId}; when it is done its result is written to ${resultPath}.`,
    ...(mainLineNote ? [`Main-line work that was done there after the side task started:\n${mainLineNote}`] : []),
    'When the person comes back here, read that file first if it exists (if it does not, the side task is not finished: say so), then go on with the main task taking it into account. Files changed during the side task are on disk already: check `git status` before editing.',
    'Reply only: ready.',
  ].join('\n\n');
}
