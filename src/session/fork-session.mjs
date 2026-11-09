// `ai1 fork`: a new conversation from the current one, opened the native way on the host.
//   full   copies the whole conversation: `claude -p --resume <id> --fork-session --session-id <new>`
//          (one short turn; the original is left untouched).
//   brief  a clean conversation that starts from a written handoff file.
// Paseo gets a real agent (same provider, model and mode, labelled ai1=fork); VS Code gets the
// extension URI opened; elsewhere the ways to open it are returned for the person.
// External programs go through `runCommand` so tests can fake `claude`, `paseo` and `code`.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { AI1_DIRECTORY } from '../core/config.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';

const SEED_TIMEOUT_MILLISECONDS = 180_000;
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

function parseJsonOutput(outputText, commandLabel) {
  try {
    return JSON.parse(outputText);
  } catch {
    throw new Error(`${commandLabel} did not return JSON: ${String(outputText).slice(0, 200)}`);
  }
}

function readAgentId(agentJson) {
  const agentRecord = Array.isArray(agentJson) ? agentJson[0] : agentJson;
  return agentRecord?.id || agentRecord?.Id || agentRecord?.agentId || agentRecord?.agent?.id || null;
}

// Provider, model and mode of the Paseo agent this session runs in.
function readCurrentPaseoAgent(runCommand, agentId) {
  const agentJson = parseJsonOutput(runOrThrow(runCommand, 'paseo', ['inspect', agentId, '--json']), 'paseo inspect');
  return {
    id: agentId,
    name: agentJson.Name || agentJson.name || '',
    provider: String(agentJson.Provider || agentJson.provider || 'claude').split('/')[0],
    model: agentJson.Model || agentJson.model || null,
    mode: agentJson.Mode || agentJson.mode || null,
  };
}

// How Paseo launches Claude for a provider (`agents.providers.<id>.command` and `env` in
// $PASEO_HOME/config.json, following `extends`): a wrapper may inject the account, and a plain
// `claude` from a tool call may not be logged in. Falls back to `claude`.
export function resolvePaseoClaudeLauncher(environment, providerId) {
  const configPath = join(environment.PASEO_HOME || join(homedir(), '.paseo'), 'config.json');
  let providerDefinitions = {};
  try {
    providerDefinitions = JSON.parse(readFileSync(configPath, 'utf8'))?.agents?.providers || {};
  } catch {
    return { command: ['claude'], environment: {} };
  }
  let launcherCommand = null;
  let launcherEnvironment = {};
  const visitedProviders = new Set();
  for (let currentProvider = providerId; currentProvider && !visitedProviders.has(currentProvider); currentProvider = providerDefinitions[currentProvider]?.extends) {
    visitedProviders.add(currentProvider);
    const providerDefinition = providerDefinitions[currentProvider] || {};
    if (!launcherCommand && Array.isArray(providerDefinition.command) && providerDefinition.command.length) launcherCommand = providerDefinition.command;
    launcherEnvironment = { ...(providerDefinition.env || {}), ...launcherEnvironment };
  }
  return { command: launcherCommand || ['claude'], environment: launcherEnvironment };
}

function writeTemporaryText(fileText) {
  const temporaryPath = join(mkdtempSync(join(tmpdir(), 'ai1-fork-')), 'message.md');
  writeFileSync(temporaryPath, fileText);
  return temporaryPath;
}

function forkLabels(forkMode, paseoAgent) {
  return ['--label', 'ai1=fork', '--label', `fork_mode=${forkMode}`, '--label', `forked_from=${paseoAgent.id}`];
}

function quoteForShell(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`;
}

// Opens the VS Code extension on a URI when the session runs in VS Code; best effort.
function openInVscode(runCommand, host, vscodeUri) {
  if (host.id !== 'vscode') return false;
  return runCommand('code', ['--open-url', vscodeUri], { timeoutMilliseconds: 15_000 }).status === 0;
}

// Where the skill writes a handoff: .ai1/work/handoffs/ when the repo uses ai1, else the temp dir.
export function resolveHandoffPath(repoRoot, handoffSlug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(handoffSlug || '')) throw new Error(`invalid handoff slug "${handoffSlug}" (lowercase letters, digits and dashes)`);
  const handoffDirectory = existsSync(join(repoRoot, AI1_DIRECTORY))
    ? join(repoRoot, WORK_DIRECTORY, 'handoffs')
    : join(tmpdir(), 'ai1-handoffs');
  mkdirSync(handoffDirectory, { recursive: true });
  return join(handoffDirectory, `${handoffSlug}.md`);
}

export function forkFullConversation({ environment = process.env, cwd, host, title, task, runCommand = runExternalCommand }) {
  if (host.id === 'web') throw new Error('a full fork is not possible on the web (claude.ai/code): use brief mode, or /branch in the session');
  const originalSessionId = environment.CLAUDE_CODE_SESSION_ID;
  if (!originalSessionId) throw new Error('CLAUDE_CODE_SESSION_ID is not set: run this from a Claude Code session (or use brief mode)');
  const paseoAgent = host.id === 'paseo' ? readCurrentPaseoAgent(runCommand, environment.PASEO_AGENT_ID) : null;
  if (paseoAgent && paseoAgent.provider !== 'claude' && !paseoAgent.provider.startsWith('claude-')) {
    throw new Error(`this Paseo agent runs on "${paseoAgent.provider}"; a full fork needs a Claude Code session: use brief mode`);
  }
  const forkSessionId = randomUUID();
  const seedPrompt = `You are a fork of session ${originalSessionId}, made with /ai1:session-fork-conversation. The conversation so far belongs to the original; from here on you are a separate session. Reply only: ready.`;
  const claudeLauncher = paseoAgent ? resolvePaseoClaudeLauncher(environment, paseoAgent.provider) : { command: ['claude'], environment: {} };
  runOrThrow(runCommand, claudeLauncher.command[0], [
    ...claudeLauncher.command.slice(1),
    '-p', '--resume', originalSessionId, '--fork-session', '--session-id', forkSessionId, '--tools', '',
    ...(paseoAgent?.model ? ['--model', paseoAgent.model] : []),
    seedPrompt,
  ], { cwd, timeoutMilliseconds: SEED_TIMEOUT_MILLISECONDS, extraEnvironment: claudeLauncher.environment });

  const forkTitle = title || `Fork: ${paseoAgent?.name || originalSessionId.slice(0, 8)}`;
  const vscodeUri = `${VSCODE_URI_PREFIX}?session=${encodeURIComponent(forkSessionId)}`;
  const openWith = [
    { label: 'terminal', command: `claude --resume ${forkSessionId}` },
    { label: 'VS Code (same folder)', command: vscodeUri },
    ...(host.canOpenInDesktop ? [{ label: 'Claude Desktop', command: `claude --desktop --resume ${forkSessionId}` }] : []),
  ];
  const forkResult = { mode: 'full', host, title: forkTitle, originalSessionId, sessionId: forkSessionId, openWith, task: task || null };

  if (paseoAgent) {
    const importedJson = parseJsonOutput(runOrThrow(runCommand, 'paseo', ['import', forkSessionId, '--provider', paseoAgent.provider, '--cwd', cwd, ...forkLabels('full', paseoAgent), '--json']), 'paseo import');
    const agentId = readAgentId(importedJson);
    if (!agentId) throw new Error(`paseo import returned no agent id: ${JSON.stringify(importedJson).slice(0, 200)}`);
    runCommand('paseo', ['agent', 'update', agentId, '--name', forkTitle, '--json']);
    if (task) runOrThrow(runCommand, 'paseo', ['send', agentId, '--no-wait', '--prompt-file', writeTemporaryText(task)]);
    forkResult.agentId = agentId;
    openWith.unshift({ label: 'Paseo', command: `paseo agent open ${agentId}` });
  }
  forkResult.opened = paseoAgent ? 'paseo' : (openInVscode(runCommand, host, vscodeUri) ? 'vscode' : null);
  return forkResult;
}

export function startBriefConversation({ environment = process.env, cwd, host, title, briefPath, runCommand = runExternalCommand }) {
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
  const briefResult = { mode: 'brief', host, title: conversationTitle, briefPath, openWith };

  if (host.id === 'paseo') {
    const paseoAgent = readCurrentPaseoAgent(runCommand, environment.PASEO_AGENT_ID);
    const startedJson = parseJsonOutput(runOrThrow(runCommand, 'paseo', [
      'run', '-d', '--json', '--title', conversationTitle, '--provider', paseoAgent.provider,
      ...(paseoAgent.model ? ['--model', paseoAgent.model] : []),
      ...(paseoAgent.mode ? ['--mode', paseoAgent.mode] : []),
      '--cwd', cwd, ...forkLabels('brief', paseoAgent), briefText,
    ]), 'paseo run');
    const agentId = readAgentId(startedJson);
    if (!agentId) throw new Error(`paseo run returned no agent id: ${JSON.stringify(startedJson).slice(0, 200)}`);
    // Started from an agent, the new one may be its child; detach it so it lives on its own.
    runCommand('paseo', ['agent', 'detach', agentId, '--json']);
    briefResult.agentId = agentId;
    openWith.unshift({ label: 'Paseo', command: `paseo agent open ${agentId}` });
  }
  briefResult.opened = briefResult.agentId ? 'paseo' : (openInVscode(runCommand, host, vscodeUri) ? 'vscode' : null);
  return briefResult;
}
