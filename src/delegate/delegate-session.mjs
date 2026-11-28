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
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { runExternalCommand } from '../session/fork-session.mjs';
import { resolveClaudeCommand } from '../session/claude-command.mjs';
import { resolveStateDirectory } from '../core/session-state.mjs';
import { delegationReportPath, grantOneTimeAllow, readRememberedPermissionMode } from './delegate-state.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { canonicalPlanPath, hashContractSection } from '../sizing/joint-plans.mjs';

const DEFAULT_TIMEOUT_MINUTES = 60;
const STATUS_LINE_PATTERN = /^\s*AI1-DELEGATE:\s*(done|needs-input)\s*(?::\s*(.*))?$/gim;
const MAX_TAIL_CHARACTERS = 600;
// The delegated session's report is its whole last message; a design report runs to several thousand
// characters (seen 2026-11-28: 2000 cut its first sentence). Longer than this, the start is marked cut.
const MAX_SUMMARY_CHARACTERS = 12000;

export function trimSummary(summaryText) {
  return summaryText.length > MAX_SUMMARY_CHARACTERS ? `[...] ${summaryText.slice(-MAX_SUMMARY_CHARACTERS)}` : summaryText;
}

export const DELEGATE_PROTOCOL = [
  '## How to finish (ai1 delegate)',
  'You were started by another Claude Code session to make this change in this repository; the person is not watching this session.',
  'Follow this repository\'s own rules (CLAUDE.md, worktrees, commits). Do not push.',
  'Before reading much, check that you can do what the task needs (write in this repository, run the commands it names). If a tool is denied, stop at once and say which, with the needs-input line below, instead of trying other routes.',
  '`.ai1/work/` is local scratch, ignored by git: files there are not committed. If the task asks to commit one, leave it there and say so.',
  'If you need a decision only the person can take, do not guess: stop and end your last message with the line `AI1-DELEGATE: needs-input: <the question>`.',
  'If a guard of this repository refuses or asks to confirm an action, do not reach the same result another way: stop and say what you wanted to run and why.',
  'When the change is done and checked, end your last message with the line `AI1-DELEGATE: done`.',
  'Your last message is the only thing the caller receives: make it the complete report (what changed, what was left out and why, open points), never a reference to an earlier message.',
].join('\n');

// The protocol of a design session (`ai1 delegate --design --joint <plan>`): this repository's part of a
// joint plan, written as its sub-plan in its main checkout, linked back and pinned to the contract hash.
export function buildDesignProtocol({ jointPlanPath, repoRoot }) {
  const jointCanonicalPath = canonicalPlanPath(jointPlanPath);
  const planSlug = basename(dirname(jointCanonicalPath));
  const subplanPath = join(findMainCheckout(repoRoot), WORK_DIRECTORY, planSlug, 'plan.md');
  const contractHash = hashContractSection(readFileSync(jointPlanPath, 'utf8'));
  return [
    '## How to finish (ai1 delegate, design only)',
    'You were started by another Claude Code session to design this repository\'s part of a joint plan that spans several repositories; the person is not watching this session.',
    'Design only: read this repository\'s CLAUDE.md, its knowledge bundle (`.ai1/okf/index.md` and the concepts the change touches) and the code you need; change no code and do not commit.',
    `The joint plan is \`${jointCanonicalPath}\`: read its goal, its \`# Contract\`, its scenarios and the part asked of this repository.`,
    `Write this repository's part at \`${subplanPath}\` (the main checkout, not a worktree). If that folder already exists, stop with the needs-input line naming it.`,
    `Its frontmatter, exactly: \`title: <this repository's part in one line>\`, \`size: plan\`, \`status: ready\`, \`parent: ${jointCanonicalPath}\`, \`contract: ${contractHash}\`.`,
    'Its body: `# Steps` (each with how it is checked), `# Behaviour` with the joint scenarios this repository owns copied with the same ids (S1, S2...) plus any of its own numbered after them, and `# Constraints` with the rules of this repository that shape the part, each with its source.',
    'Follow this repository\'s rules: anything they forbid in the contract is an objection to report, never something to work around.',
    'End your last message with the complete report: the sub-plan path; `Objections to the contract:` (each with the rule or concept behind it, or "none"); `Impacts on other repositories:` (or "none"); then the line `AI1-DELEGATE: done`, or `AI1-DELEGATE: needs-input: <the question>` for a decision only the person can take.',
    'Your last message is the only thing the caller receives.',
  ].join('\n');
}

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
  const summary = trimSummary(resultText.replace(STATUS_LINE_PATTERN, '').trim()) || (status === 'failed' ? `claude exited ${commandResult.status} (${runJson.subtype || 'no subtype'})` : '');
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

function runClaude({ repoRoot, sessionId, claudeArguments, claudeCommand, environment, runCommand, timeoutMinutes }) {
  const [launcherProgram, ...launcherArguments] = resolveClaudeCommand(claudeCommand, environment);
  // A report left by an earlier run must not pass for this one's.
  rmSync(delegationReportPath(sessionId, environment), { force: true });
  return runCommand(launcherProgram, [...launcherArguments, ...claudeArguments], {
    cwd: repoRoot,
    timeoutMilliseconds: Math.max(1, Number(timeoutMinutes) || DEFAULT_TIMEOUT_MINUTES) * 60_000,
    // Its hooks resolve the project from CLAUDE_PROJECT_DIR: the other repository, not this session's.
    // AI1_DELEGATION tells that repository's ai1 it runs a delegated session (delegate-report, and no
    // nudges meant for a person watching: personOnly modules).
    extraEnvironment: { CLAUDE_PROJECT_DIR: repoRoot, AI1_DELEGATION: sessionId },
  });
}

function permissionArguments(permissionMode) {
  return permissionMode ? ['--permission-mode', permissionMode] : [];
}

// What the delegated session's ai1 wrote when it stopped (delegate-report), or null.
function readSessionReport(sessionId, environment) {
  try {
    return JSON.parse(readFileSync(delegationReportPath(sessionId, environment), 'utf8'));
  } catch {
    return null;
  }
}

function finishRun({ baseRecord, commandResult, runCommand, environment }) {
  const runOutcome = interpretRun(commandResult);
  const repositoryChanges = describeRepositoryChanges(baseRecord.repo, baseRecord.start_snapshot, runCommand);
  const sessionReport = readSessionReport(baseRecord.session_id, environment);
  const delegationRecord = {
    ...baseRecord,
    status: runOutcome.status,
    question: runOutcome.question,
    summary: runOutcome.summary,
    denied: runOutcome.denied,
    commits: repositoryChanges.commits,
    changed_files: repositoryChanges.changedFiles,
    new_worktrees: repositoryChanges.newWorktrees,
    verify: sessionReport?.verify ?? 'unknown',
    open_plans: sessionReport?.open_plans ?? [],
    exit_code: runOutcome.exitCode,
    cost_usd: runOutcome.costUsd,
    runs: (baseRecord.runs || 0) + 1,
    warning: baseRecord.permission_mode ? undefined : NO_PERMISSION_MODE_WARNING,
    updated_at: new Date().toISOString(),
  };
  delegationRecord.record_path = saveRecord(delegationRecord, environment);
  return delegationRecord;
}

// Starts a delegated session in `targetDirectory` with the brief (a file) or an inline task.
export function startDelegation({ targetDirectory, briefPath, taskText, jointPlanPath, permissionMode, maxTurns, timeoutMinutes, claudeCommand, callerSessionId, environment = process.env, runCommand = runExternalCommand }) {
  const repoRoot = describeOwningRepository(resolve(targetDirectory), resolve(targetDirectory))?.repoRoot;
  if (!repoRoot) throw new Error(`${targetDirectory} is not inside a git repository`);
  let briefText = taskText ? String(taskText).trim() : '';
  if (briefPath) {
    if (!existsSync(briefPath)) throw new Error(`no brief file at ${briefPath}`);
    briefText = readFileSync(briefPath, 'utf8').trim();
  }
  if (!briefText) throw new Error('nothing to delegate: give --brief <file> or the task as text');
  if (jointPlanPath && !existsSync(jointPlanPath)) throw new Error(`no joint plan at ${jointPlanPath}`);
  const finishProtocol = jointPlanPath ? buildDesignProtocol({ jointPlanPath, repoRoot }) : DELEGATE_PROTOCOL;
  const effectivePermissionMode = permissionMode || readRememberedPermissionMode(callerSessionId, environment) || null;
  const sessionId = randomUUID();
  const startedAt = new Date().toISOString();
  const startSnapshot = snapshotRepository(repoRoot, runCommand);
  const commandResult = runClaude({
    repoRoot,
    sessionId,
    claudeArguments: ['-p', '--output-format', 'json', '--session-id', sessionId, ...permissionArguments(effectivePermissionMode), ...(maxTurns ? ['--max-turns', String(maxTurns)] : []), `${briefText}\n\n${finishProtocol}`],
    claudeCommand,
    environment,
    runCommand,
    timeoutMinutes,
  });
  const baseRecord = { session_id: sessionId, repo: repoRoot, brief_path: briefPath || null, ...(jointPlanPath ? { design_for: canonicalPlanPath(jointPlanPath) } : {}), permission_mode: effectivePermissionMode, claude_command: claudeCommand || null, start_snapshot: startSnapshot, started_at: startedAt };
  return finishRun({ baseRecord, commandResult, runCommand, environment });
}

// Said in the result when the run had no permission mode: in `claude -p` the default mode denies every
// tool the repository does not allow, so a delegated session usually stops at its first write.
export const NO_PERMISSION_MODE_WARNING = 'no permission mode: the caller\'s mode was not found and none was given, so the delegated session ran in the default mode, where tools outside the repository\'s allow list are denied. Resume (or start) with --permission-mode <the mode of this session> if it was blocked.';

// Resumes a delegated session with the person's answer; `allowOnceSubject` is a command (or file) a
// guard asked about that the person confirmed, allowed once in that session.
export function resumeDelegation({ sessionId, answerText, allowOnceSubject, permissionMode, timeoutMinutes, claudeCommand, environment = process.env, runCommand = runExternalCommand }) {
  const baseRecord = readDelegationRecord(sessionId, environment);
  if (!baseRecord) throw new Error(`no delegation ${sessionId} recorded on this machine`);
  if (!answerText || !String(answerText).trim()) throw new Error('give the person\'s answer to resume with');
  if (allowOnceSubject) grantOneTimeAllow(sessionId, baseRecord.repo, allowOnceSubject, environment);
  if (permissionMode) baseRecord.permission_mode = permissionMode;
  const resumeText = [
    `The person answered: ${String(answerText).trim()}`,
    ...(allowOnceSubject ? [`They confirmed this action once; run it exactly as written: ${allowOnceSubject}`] : []),
    'Carry on and finish as described before (`AI1-DELEGATE: done` or `AI1-DELEGATE: needs-input: ...`), with the complete report in your last message: the caller receives only that message, so repeat what an earlier one said instead of pointing to it.',
  ].join('\n');
  const commandResult = runClaude({
    repoRoot: baseRecord.repo,
    sessionId,
    claudeArguments: ['-p', '--output-format', 'json', '--resume', sessionId, ...permissionArguments(permissionMode || baseRecord.permission_mode), resumeText],
    claudeCommand: claudeCommand || baseRecord.claude_command,
    environment,
    runCommand,
    timeoutMinutes,
  });
  return finishRun({ baseRecord, commandResult, runCommand, environment });
}
