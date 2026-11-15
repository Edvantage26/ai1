// `ai1 delegate`: a change to another repository made by a `claude -p` session started there, so that
// repository's own config, hooks, CLAUDE.md, MCP servers and skills apply. The delegated session cannot
// ask the person, so it stops: it ends with an `AI1-DELEGATE:` status line (done or needs-input), and a
// guard of that repository that asked or refused shows in `permission_denials` (status blocked). The
// caller asks the person and resumes the same session (`--resume`), with a one-time allow for a
// confirmed command (danger and repo-rules honour it once in that session; a deny stays a deny).
// Every run is saved as JSON in ai1's state directory (`delegations/<session>.json`), so `--resume` and
// `show` find it from any folder. Claude Code is started with `claude`, or the command given with
// `--claude-command` / `AI1_CLAUDE_COMMAND` (a wrapper that logs in an account, for instance: what a
// machine needs belongs in a skill customization, not here). External programs go through
// `runCommand` so tests fake `claude`.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { runExternalCommand } from '../session/fork-session.mjs';
import { resolveClaudeCommand } from '../session/claude-command.mjs';
import { resolveStateDirectory } from '../core/session-state.mjs';
import { grantOneTimeAllow, readRememberedPermissionMode } from './delegate-state.mjs';

const DEFAULT_TIMEOUT_MINUTES = 60;
const STATUS_LINE_PATTERN = /^\s*AI1-DELEGATE:\s*(done|needs-input)\s*(?::\s*(.*))?$/gim;
const MAX_TAIL_CHARACTERS = 600;

export const DELEGATE_PROTOCOL = [
  '## How to finish (ai1 delegate)',
  'You were started by another Claude Code session to make this change in this repository; the person is not watching this session.',
  'Follow this repository\'s own rules (CLAUDE.md, worktrees, commits). Do not push.',
  'If you need a decision only the person can take, do not guess: stop and end your last message with the line `AI1-DELEGATE: needs-input: <the question>`.',
  'If a guard of this repository refuses or asks to confirm an action, do not reach the same result another way: stop and say what you wanted to run and why.',
  'When the change is done and checked, end your last message with a short summary and the line `AI1-DELEGATE: done`.',
].join('\n');

function git(repoRoot, gitArguments, runCommand) {
  const gitResult = runCommand('git', ['-C', repoRoot, ...gitArguments], { timeoutMilliseconds: 20_000 });
  return gitResult.status === 0 ? gitResult.stdout : '';
}

// Branch heads and worktree paths of a repository, to tell afterwards what the delegated session did.
export function snapshotRepository(repoRoot, runCommand = runExternalCommand) {
  const branchHeads = Object.fromEntries(git(repoRoot, ['for-each-ref', '--format=%(refname:short) %(objectname)', 'refs/heads'], runCommand)
    .split('\n').filter(Boolean).map((refLine) => refLine.split(' ')));
  const worktreePaths = git(repoRoot, ['worktree', 'list', '--porcelain'], runCommand)
    .split('\n').filter((worktreeLine) => worktreeLine.startsWith('worktree ')).map((worktreeLine) => worktreeLine.slice('worktree '.length));
  return { branchHeads, worktreePaths };
}

// Commits added on any branch since `startSnapshot`, and files changed by them or left uncommitted.
export function describeRepositoryChanges(repoRoot, startSnapshot, runCommand = runExternalCommand) {
  const currentSnapshot = snapshotRepository(repoRoot, runCommand);
  const startHeads = Object.values(startSnapshot.branchHeads);
  const commits = [];
  const changedFiles = new Set();
  for (const [branchName, headSha] of Object.entries(currentSnapshot.branchHeads)) {
    if (startSnapshot.branchHeads[branchName] === headSha) continue;
    const exclusions = startHeads.length ? ['--not', ...startHeads] : [];
    for (const logLine of git(repoRoot, ['log', '--format=%h %s', headSha, ...exclusions], runCommand).split('\n').filter(Boolean)) {
      const [shortSha, ...subjectWords] = logLine.split(' ');
      if (!commits.some((knownCommit) => knownCommit.sha === shortSha)) commits.push({ sha: shortSha, branch: branchName, subject: subjectWords.join(' ') });
    }
    const baseSha = startSnapshot.branchHeads[branchName] || startHeads.find(Boolean);
    if (baseSha) git(repoRoot, ['diff', '--name-only', baseSha, headSha], runCommand).split('\n').filter(Boolean).forEach((filePath) => changedFiles.add(filePath));
  }
  for (const worktreePath of currentSnapshot.worktreePaths) {
    for (const statusLine of git(worktreePath, ['status', '--porcelain'], runCommand).split('\n').filter(Boolean)) changedFiles.add(statusLine.slice(3));
  }
  return { commits, changedFiles: [...changedFiles].sort(), newWorktrees: currentSnapshot.worktreePaths.filter((worktreePath) => !startSnapshot.worktreePaths.includes(worktreePath)) };
}

function lastStatusLine(resultText) {
  let lastMatch = null;
  for (const statusMatch of String(resultText || '').matchAll(STATUS_LINE_PATTERN)) lastMatch = statusMatch;
  return lastMatch ? { status: lastMatch[1].toLowerCase(), question: lastMatch[2]?.trim() || null } : null;
}

function describeDenial(permissionDenial) {
  const toolInput = permissionDenial?.tool_input || {};
  return { tool: permissionDenial?.tool_name || null, subject: toolInput.command || toolInput.file_path || toolInput.notebook_path || null };
}

// Turns one `claude -p --output-format json` run into the delegation status.
export function interpretRun(commandResult) {
  let runJson = null;
  try {
    runJson = JSON.parse(commandResult.stdout);
  } catch {
    // handled below as a failed run
  }
  if (!runJson || typeof runJson !== 'object') {
    return { status: 'failed', question: null, summary: `claude exited ${commandResult.status} without a JSON result: ${String(commandResult.stderr || commandResult.stdout || '').trim().slice(-MAX_TAIL_CHARACTERS)}`, denied: [], exitCode: commandResult.status, sessionId: null, costUsd: null };
  }
  const resultText = String(runJson.result || '');
  const denied = (runJson.permission_denials || []).map(describeDenial);
  const statusLine = lastStatusLine(resultText);
  let status = statusLine?.status || null;
  if (runJson.is_error) status = 'failed';
  else if (status !== 'done' && denied.length) status = 'blocked';
  else if (!status) status = 'failed';
  const question = status === 'blocked' && !statusLine?.question
    ? `a guard of the repository refused or asked to confirm: ${denied.map((deniedCall) => `\`${deniedCall.subject}\``).join(', ')}`
    : statusLine?.question || null;
  const summary = resultText.replace(STATUS_LINE_PATTERN, '').trim().slice(-2000) || (status === 'failed' ? `claude exited ${commandResult.status} (${runJson.subtype || 'no subtype'})` : '');
  return { status, question, summary, denied, exitCode: commandResult.status, sessionId: runJson.session_id || null, costUsd: runJson.total_cost_usd ?? null };
}

function delegationDirectory(environment) {
  return join(resolveStateDirectory(environment), 'delegations');
}

function recordPath(sessionId, environment) {
  return join(delegationDirectory(environment), `${sessionId}.json`);
}

function saveRecord(delegationRecord, environment) {
  const savedPath = recordPath(delegationRecord.session_id, environment);
  mkdirSync(delegationDirectory(environment), { recursive: true });
  writeFileSync(savedPath, JSON.stringify(delegationRecord, null, 2) + '\n');
  return savedPath;
}

export function readDelegationRecord(sessionId, environment = process.env) {
  const savedPath = recordPath(sessionId, environment);
  return existsSync(savedPath) ? JSON.parse(readFileSync(savedPath, 'utf8')) : null;
}

function runClaude({ repoRoot, claudeArguments, claudeCommand, environment, runCommand, timeoutMinutes }) {
  const [launcherProgram, ...launcherArguments] = resolveClaudeCommand(claudeCommand, environment);
  return runCommand(launcherProgram, [...launcherArguments, ...claudeArguments], {
    cwd: repoRoot,
    timeoutMilliseconds: Math.max(1, Number(timeoutMinutes) || DEFAULT_TIMEOUT_MINUTES) * 60_000,
    // Its hooks resolve the project from CLAUDE_PROJECT_DIR: the other repository, not this session's.
    extraEnvironment: { CLAUDE_PROJECT_DIR: repoRoot },
  });
}

function permissionArguments(permissionMode) {
  return permissionMode ? ['--permission-mode', permissionMode] : [];
}

function finishRun({ baseRecord, commandResult, runCommand, environment }) {
  const runOutcome = interpretRun(commandResult);
  const repositoryChanges = describeRepositoryChanges(baseRecord.repo, baseRecord.start_snapshot, runCommand);
  const delegationRecord = {
    ...baseRecord,
    status: runOutcome.status,
    question: runOutcome.question,
    summary: runOutcome.summary,
    denied: runOutcome.denied,
    commits: repositoryChanges.commits,
    changed_files: repositoryChanges.changedFiles,
    new_worktrees: repositoryChanges.newWorktrees,
    exit_code: runOutcome.exitCode,
    cost_usd: runOutcome.costUsd,
    runs: (baseRecord.runs || 0) + 1,
    updated_at: new Date().toISOString(),
  };
  delegationRecord.record_path = saveRecord(delegationRecord, environment);
  return delegationRecord;
}

// Starts a delegated session in `targetDirectory` with the brief (a file) or an inline task.
export function startDelegation({ targetDirectory, briefPath, taskText, permissionMode, maxTurns, timeoutMinutes, claudeCommand, callerSessionId, environment = process.env, runCommand = runExternalCommand }) {
  const repoRoot = describeOwningRepository(resolve(targetDirectory), resolve(targetDirectory))?.repoRoot;
  if (!repoRoot) throw new Error(`${targetDirectory} is not inside a git repository`);
  let briefText = taskText ? String(taskText).trim() : '';
  if (briefPath) {
    if (!existsSync(briefPath)) throw new Error(`no brief file at ${briefPath}`);
    briefText = readFileSync(briefPath, 'utf8').trim();
  }
  if (!briefText) throw new Error('nothing to delegate: give --brief <file> or the task as text');
  const effectivePermissionMode = permissionMode || readRememberedPermissionMode(callerSessionId, environment) || null;
  const sessionId = randomUUID();
  const startSnapshot = snapshotRepository(repoRoot, runCommand);
  const commandResult = runClaude({
    repoRoot,
    claudeArguments: ['-p', '--output-format', 'json', '--session-id', sessionId, ...permissionArguments(effectivePermissionMode), ...(maxTurns ? ['--max-turns', String(maxTurns)] : []), `${briefText}\n\n${DELEGATE_PROTOCOL}`],
    claudeCommand,
    environment,
    runCommand,
    timeoutMinutes,
  });
  const baseRecord = { session_id: sessionId, repo: repoRoot, brief_path: briefPath || null, permission_mode: effectivePermissionMode, claude_command: claudeCommand || null, start_snapshot: startSnapshot, started_at: new Date().toISOString() };
  return finishRun({ baseRecord, commandResult, runCommand, environment });
}

// Resumes a delegated session with the person's answer; `allowOnceSubject` is a command (or file) a
// guard asked about that the person confirmed, allowed once in that session.
export function resumeDelegation({ sessionId, answerText, allowOnceSubject, timeoutMinutes, claudeCommand, environment = process.env, runCommand = runExternalCommand }) {
  const baseRecord = readDelegationRecord(sessionId, environment);
  if (!baseRecord) throw new Error(`no delegation ${sessionId} recorded on this machine`);
  if (!answerText || !String(answerText).trim()) throw new Error('give the person\'s answer to resume with');
  if (allowOnceSubject) grantOneTimeAllow(sessionId, baseRecord.repo, allowOnceSubject, environment);
  const resumeText = [
    `The person answered: ${String(answerText).trim()}`,
    ...(allowOnceSubject ? [`They confirmed this action once; run it exactly as written: ${allowOnceSubject}`] : []),
    'Carry on and finish as described before (`AI1-DELEGATE: done` or `AI1-DELEGATE: needs-input: ...`).',
  ].join('\n');
  const commandResult = runClaude({
    repoRoot: baseRecord.repo,
    claudeArguments: ['-p', '--output-format', 'json', '--resume', sessionId, ...permissionArguments(baseRecord.permission_mode), resumeText],
    claudeCommand: claudeCommand || baseRecord.claude_command,
    environment,
    runCommand,
    timeoutMinutes,
  });
  return finishRun({ baseRecord, commandResult, runCommand, environment });
}
