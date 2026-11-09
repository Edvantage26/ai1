// `ai1 log [--session <id>] [--since <hours>] [--json]`: what ai1's modules decided in this repo, from
// the local decision log (core/decision-log) - per module: runs, decisions, time and characters added
// to the agent's context; then the latest asks, refusals, blocks and errors.

import { readDecisionLog } from '../core/decision-log.mjs';

const NOTEWORTHY_DECISIONS = new Set(['ask', 'deny', 'block', 'error']);
const RECENT_ENTRY_COUNT = 10;

export function summarizeDecisionLog(logEntries, { sessionId, sinceHours, now = Date.now() } = {}) {
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
    outputLines.push(`  ${moduleSummary.module}: ${moduleSummary.runs} runs (${decisionCounts}); ${moduleSummary.totalMs} ms total, ${moduleSummary.avgMs} avg, ${moduleSummary.maxMs} max; ${moduleSummary.chars} chars added`);
  }
  if (decisionSummary.recent.length) {
    outputLines.push('latest asks, refusals, blocks and errors:');
    for (const logEntry of decisionSummary.recent) outputLines.push(`  ${logEntry.at} ${logEntry.event}${logEntry.tool ? `/${logEntry.tool}` : ''} ${logEntry.module}: ${logEntry.decision}`);
  }
  return outputLines.join('\n');
}

export function runLogCommand(sharedRoot, { sessionId, sinceHours, wantsJson, environment = process.env } = {}) {
  const decisionSummary = summarizeDecisionLog(readDecisionLog(sharedRoot, environment), { sessionId, sinceHours });
  return wantsJson ? JSON.stringify(decisionSummary, null, 2) : formatDecisionSummary(decisionSummary);
}
