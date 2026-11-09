// `ai1 log [--session <id>] [--since <hours>] [--json]`: what ai1's modules decided in this repo, from
// the local decision log (core/decision-log) - per module: runs, decisions, time and characters added
// to the agent's context, errors by signature, rules behind its asks; then the latest asks, refusals,
// blocks and errors.
// `ai1 log --all`: the same for every repo on this machine (named by the logs' `.repo` sidecars), with
// what the person answered to each ask, read from the session transcripts: the retro of the ai1 repo.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { listStateDirectoriesToRead, readDecisionLog } from '../core/decision-log.mjs';

const NOTEWORTHY_DECISIONS = new Set(['ask', 'deny', 'block', 'error']);
const RECENT_ENTRY_COUNT = 10;
const DECISION_LOG_FILE = /^decisions-([0-9a-f]+)\.jsonl$/;
// How Claude Code records a permission the person refused (tool_result with is_error).
const REFUSAL_TEXT = /doesn't want to proceed with this tool use|tool use was rejected/;

function countInto(counts, countedKey) {
  counts[countedKey] = (counts[countedKey] || 0) + 1;
}

// `askOutcomes`: Map of tool_use_id -> 'approved' | 'refused', from findAskOutcomes.
export function summarizeDecisionLog(logEntries, { sessionId, sinceHours, now = Date.now(), askOutcomes } = {}) {
  const sinceMilliseconds = Number.isFinite(sinceHours) ? now - sinceHours * 3600 * 1000 : -Infinity;
  const selectedEntries = logEntries.filter((logEntry) => (!sessionId || logEntry.session === sessionId) && Date.parse(logEntry.at) >= sinceMilliseconds);
  const moduleSummaries = new Map();
  for (const logEntry of selectedEntries) {
    const moduleSummary = moduleSummaries.get(logEntry.module) || { module: logEntry.module, runs: 0, decisions: {}, totalMs: 0, maxMs: 0, chars: 0 };
    moduleSummary.runs += 1;
    moduleSummary.decisions[logEntry.decision] = (moduleSummary.decisions[logEntry.decision] || 0) + 1;
    moduleSummary.totalMs += logEntry.ms || 0;
    moduleSummary.maxMs = Math.max(moduleSummary.maxMs, logEntry.ms || 0);
    moduleSummary.chars += logEntry.chars || 0;
    if (logEntry.error) countInto(moduleSummary.errors ||= {}, logEntry.error);
    for (const ruleId of logEntry.rules || []) countInto(moduleSummary.rules ||= {}, ruleId);
    if (askOutcomes && logEntry.decision === 'ask') countInto(moduleSummary.asks ||= {}, askOutcomes.get(logEntry.toolUse) || 'unknown');
    moduleSummaries.set(logEntry.module, moduleSummary);
  }
  const roundMilliseconds = (milliseconds) => Math.round(milliseconds * 100) / 100;
  return {
    entries: selectedEntries.length,
    sessions: new Set(selectedEntries.map((logEntry) => logEntry.session)).size,
    modules: [...moduleSummaries.values()]
      .map((moduleSummary) => ({ ...moduleSummary, totalMs: roundMilliseconds(moduleSummary.totalMs), avgMs: roundMilliseconds(moduleSummary.totalMs / moduleSummary.runs) }))
      .sort((firstSummary, secondSummary) => secondSummary.totalMs - firstSummary.totalMs),
    recent: selectedEntries.filter((logEntry) => NOTEWORTHY_DECISIONS.has(logEntry.decision)).slice(-RECENT_ENTRY_COUNT),
  };
}

export function formatDecisionSummary(decisionSummary) {
  if (decisionSummary.entries === 0) return 'ai1 log: no decisions recorded for this selection (the log is off with AI1_DECISION_LOG=0).';
  const outputLines = [`${decisionSummary.entries} module runs in ${decisionSummary.sessions} session(s), slowest first:`];
  for (const moduleSummary of decisionSummary.modules) {
    const decisionCounts = Object.entries(moduleSummary.decisions).map(([decisionKind, decisionCount]) => `${decisionKind} ${decisionCount}`).join(', ');
    const listCounts = (counts) => Object.entries(counts).map(([countedKey, countValue]) => `${countedKey} ${countValue}`).join(', ');
    outputLines.push(`  ${moduleSummary.module}: ${moduleSummary.runs} runs (${decisionCounts}); ${moduleSummary.totalMs} ms total, ${moduleSummary.avgMs} avg, ${moduleSummary.maxMs} max; ${moduleSummary.chars} chars added`
      + (moduleSummary.asks ? `; asks answered: ${listCounts(moduleSummary.asks)}` : '')
      + (moduleSummary.rules ? `; rules: ${listCounts(moduleSummary.rules)}` : '')
      + (moduleSummary.errors ? `; errors: ${listCounts(moduleSummary.errors)}` : ''));
  }
  if (decisionSummary.recent.length) {
    outputLines.push('latest asks, refusals, blocks and errors:');
    for (const logEntry of decisionSummary.recent) outputLines.push(`  ${logEntry.at} ${logEntry.event}${logEntry.tool ? `/${logEntry.tool}` : ''} ${logEntry.module}: ${logEntry.decision}`);
  }
  return outputLines.join('\n');
}

// Every repo's log in every state dir: [{ hash, name, path, entries }], named by its `.repo` sidecar.
export function readAllDecisionLogs(environment = process.env, homeDirectory = homedir()) {
  const repoLogs = new Map();
  for (const stateDirectory of listStateDirectoriesToRead(environment, homeDirectory)) {
    for (const stateFileName of readdirSync(stateDirectory)) {
      const logHash = stateFileName.match(DECISION_LOG_FILE)?.[1];
      if (!logHash) continue;
      const sidecarPath = join(stateDirectory, `decisions-${logHash}.repo`);
      const repoLog = repoLogs.get(logHash) || { hash: logHash, name: logHash, path: null };
      try {
        if (existsSync(sidecarPath)) Object.assign(repoLog, JSON.parse(readFileSync(sidecarPath, 'utf8')));
      } catch {
        // A broken sidecar only loses the name.
      }
      repoLogs.set(logHash, repoLog);
    }
  }
  return [...repoLogs.values()].map((repoLog) => ({ ...repoLog, entries: repoLog.path ? readDecisionLog(repoLog.path, environment, homeDirectory) : [] }))
    .filter((repoLog) => repoLog.entries.length);
}

// What the person answered to each ask: the tool_result of that tool call in the session transcript
// (`~/.claude/projects/*/<session>.jsonl`, and its subagents'), refused when Claude Code says so,
// approved when the tool ran (even if it then failed). Calls with no transcript stay unknown.
export function findAskOutcomes(logEntries, homeDirectory = homedir()) {
  const askedToolUses = new Map();
  for (const logEntry of logEntries) {
    if (logEntry.decision !== 'ask' || !logEntry.toolUse || !logEntry.session) continue;
    if (!askedToolUses.has(logEntry.session)) askedToolUses.set(logEntry.session, new Set());
    askedToolUses.get(logEntry.session).add(logEntry.toolUse);
  }
  const askOutcomes = new Map();
  const projectsDirectory = join(homeDirectory, '.claude', 'projects');
  if (!askedToolUses.size || !existsSync(projectsDirectory)) return askOutcomes;
  for (const projectFolderName of readdirSync(projectsDirectory)) {
    const projectFolder = join(projectsDirectory, projectFolderName);
    for (const [sessionId, toolUseIds] of askedToolUses) {
      const subagentsFolder = join(projectFolder, sessionId, 'subagents');
      const transcriptPaths = [join(projectFolder, `${sessionId}.jsonl`),
        ...(existsSync(subagentsFolder) ? readdirSync(subagentsFolder).filter((fileName) => fileName.endsWith('.jsonl')).map((fileName) => join(subagentsFolder, fileName)) : [])];
      for (const transcriptPath of transcriptPaths.filter((candidatePath) => existsSync(candidatePath))) {
        for (const transcriptLine of readFileSync(transcriptPath, 'utf8').split('\n')) {
          if (!transcriptLine.includes('"tool_result"')) continue;
          let transcriptEvent;
          try {
            transcriptEvent = JSON.parse(transcriptLine);
          } catch {
            continue;
          }
          for (const contentBlock of Array.isArray(transcriptEvent.message?.content) ? transcriptEvent.message.content : []) {
            if (contentBlock?.type !== 'tool_result' || !toolUseIds.has(contentBlock.tool_use_id)) continue;
            const resultText = typeof contentBlock.content === 'string' ? contentBlock.content : JSON.stringify(contentBlock.content || '');
            askOutcomes.set(contentBlock.tool_use_id, contentBlock.is_error && REFUSAL_TEXT.test(resultText) ? 'refused' : 'approved');
          }
        }
      }
    }
  }
  return askOutcomes;
}

export function summarizeAllRepos({ sinceHours, environment = process.env, homeDirectory = homedir(), now = Date.now() } = {}) {
  return readAllDecisionLogs(environment, homeDirectory).map((repoLog) => ({
    repo: repoLog.name,
    path: repoLog.path,
    ...summarizeDecisionLog(repoLog.entries, { sinceHours, now, askOutcomes: findAskOutcomes(repoLog.entries, homeDirectory) }),
  })).filter((repoSummary) => repoSummary.entries > 0);
}

export function formatAllReposSummary(repoSummaries) {
  if (!repoSummaries.length) return 'ai1 log --all: no decisions recorded on this machine for this selection.';
  return repoSummaries.map((repoSummary) => `== ${repoSummary.repo} (${repoSummary.path || 'unknown path'})\n${formatDecisionSummary(repoSummary)}`).join('\n\n');
}

export function runLogCommand(sharedRoot, { sessionId, sinceHours, wantsJson, allRepos = false, environment = process.env, homeDirectory } = {}) {
  if (allRepos) {
    const repoSummaries = summarizeAllRepos({ sinceHours, environment, homeDirectory });
    return wantsJson ? JSON.stringify(repoSummaries, null, 2) : formatAllReposSummary(repoSummaries);
  }
  const decisionSummary = summarizeDecisionLog(readDecisionLog(sharedRoot, environment, homeDirectory), { sessionId, sinceHours });
  return wantsJson ? JSON.stringify(decisionSummary, null, 2) : formatDecisionSummary(decisionSummary);
}
