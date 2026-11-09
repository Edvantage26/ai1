// Hook input/output for Claude Code.
// Input: one JSON object on stdin. Output: one JSON object on stdout, exit code 0.
// Modules never write to stdout themselves: they return decisions, and this file turns the
// combined decision into the shape each event expects.

export const DECISION_KINDS = ['allow', 'ask', 'deny', 'block', 'context', 'notice'];

// Higher rank wins when several modules decide on the same event.
const DECISION_RANK = { allow: 0, context: 0, notice: 0, ask: 1, block: 2, deny: 2 };

export function allowDecision() {
  return { kind: 'allow' };
}

// `ruleIds`: the rules behind the decision, recorded in the decision log (not shown to anyone).
export function askDecision(moduleId, reason, ruleIds) {
  return { kind: 'ask', moduleId, reason, ...(ruleIds?.length ? { ruleIds } : {}) };
}

export function denyDecision(moduleId, reason, ruleIds) {
  return { kind: 'deny', moduleId, reason, ...(ruleIds?.length ? { ruleIds } : {}) };
}

// Stop / SubagentStop only: keeps the agent working until the reason is resolved.
export function blockDecision(moduleId, reason) {
  return { kind: 'block', moduleId, reason };
}

// SessionStart / UserPromptSubmit / PostToolUse only: text added to the agent's context.
export function contextDecision(moduleId, text) {
  return { kind: 'context', moduleId, text };
}

// Any event: a message shown to the person (`systemMessage`), not to the agent; it never blocks
// and rides along whatever the other modules decided.
export function noticeDecision(moduleId, text) {
  return { kind: 'notice', moduleId, text };
}

export async function readHookInput(inputStream = process.stdin) {
  let rawInput = '';
  for await (const inputChunk of inputStream) rawInput += inputChunk;
  if (!rawInput.trim()) return {};
  return JSON.parse(rawInput);
}

export function combineDecisions(moduleDecisions) {
  const meaningfulDecisions = moduleDecisions.filter((decision) => decision && decision.kind !== 'allow');
  const noticeTexts = meaningfulDecisions.filter((decision) => decision.kind === 'notice').map((decision) => `ai1/${decision.moduleId}: ${decision.text}`);
  const withNotice = (combinedDecision) => (noticeTexts.length ? { ...combinedDecision, notice: noticeTexts.join('\n') } : combinedDecision);
  const contextTexts = meaningfulDecisions.filter((decision) => decision.kind === 'context').map((decision) => decision.text);
  const blockingDecisions = meaningfulDecisions.filter((decision) => !['context', 'notice'].includes(decision.kind));
  if (blockingDecisions.length === 0) {
    return withNotice(contextTexts.length ? { kind: 'context', text: contextTexts.join('\n\n') } : allowDecision());
  }
  const highestRank = Math.max(...blockingDecisions.map((decision) => DECISION_RANK[decision.kind]));
  const winningDecisions = blockingDecisions.filter((decision) => DECISION_RANK[decision.kind] === highestRank);
  return withNotice({
    kind: winningDecisions[0].kind,
    reason: winningDecisions.map((decision) => `ai1/${decision.moduleId}: ${decision.reason}`).join('\n'),
  });
}

// Returns the object to print, or null when there is nothing to say (plain exit 0 = allow).
export function buildHookOutput(eventName, combinedDecision) {
  const decisionOutput = buildDecisionOutput(eventName, combinedDecision);
  if (!combinedDecision.notice) return decisionOutput;
  return { ...decisionOutput, systemMessage: combinedDecision.notice };
}

function buildDecisionOutput(eventName, combinedDecision) {
  if (combinedDecision.kind === 'allow') return null;
  if (eventName === 'PreToolUse' && ['ask', 'deny'].includes(combinedDecision.kind)) {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: combinedDecision.kind,
        permissionDecisionReason: combinedDecision.reason,
      },
    };
  }
  if (['Stop', 'SubagentStop', 'PostToolUse'].includes(eventName) && ['block', 'deny'].includes(combinedDecision.kind)) {
    return { decision: 'block', reason: combinedDecision.reason };
  }
  if (['SessionStart', 'UserPromptSubmit', 'PostToolUse'].includes(eventName) && combinedDecision.kind === 'context') {
    return { hookSpecificOutput: { hookEventName: eventName, additionalContext: combinedDecision.text } };
  }
  return null;
}
