// Hook input/output for Claude Code.
// Input: one JSON object on stdin. Output: one JSON object on stdout, exit code 0.
// Modules never write to stdout themselves: they return decisions, and this file turns the
// combined decision into the shape each event expects.

export const DECISION_KINDS = ['allow', 'ask', 'deny', 'block', 'context'];

// Higher rank wins when several modules decide on the same event.
const DECISION_RANK = { allow: 0, context: 0, ask: 1, block: 2, deny: 2 };

export function allowDecision() {
  return { kind: 'allow' };
}

export function askDecision(moduleId, reason) {
  return { kind: 'ask', moduleId, reason };
}

export function denyDecision(moduleId, reason) {
  return { kind: 'deny', moduleId, reason };
}

// Stop / SubagentStop only: keeps the agent working until the reason is resolved.
export function blockDecision(moduleId, reason) {
  return { kind: 'block', moduleId, reason };
}

// SessionStart / UserPromptSubmit / PostToolUse only: text added to the agent's context.
export function contextDecision(moduleId, text) {
  return { kind: 'context', moduleId, text };
}

export async function readHookInput(inputStream = process.stdin) {
  let rawInput = '';
  for await (const inputChunk of inputStream) rawInput += inputChunk;
  if (!rawInput.trim()) return {};
  return JSON.parse(rawInput);
}

export function combineDecisions(moduleDecisions) {
  const meaningfulDecisions = moduleDecisions.filter((decision) => decision && decision.kind !== 'allow');
  const contextTexts = meaningfulDecisions.filter((decision) => decision.kind === 'context').map((decision) => decision.text);
  const blockingDecisions = meaningfulDecisions.filter((decision) => decision.kind !== 'context');
  if (blockingDecisions.length === 0) {
    return contextTexts.length ? { kind: 'context', text: contextTexts.join('\n\n') } : allowDecision();
  }
  const highestRank = Math.max(...blockingDecisions.map((decision) => DECISION_RANK[decision.kind]));
  const winningDecisions = blockingDecisions.filter((decision) => DECISION_RANK[decision.kind] === highestRank);
  return {
    kind: winningDecisions[0].kind,
    reason: winningDecisions.map((decision) => `ai1/${decision.moduleId}: ${decision.reason}`).join('\n'),
  };
}

// Returns the object to print, or null when there is nothing to say (plain exit 0 = allow).
export function buildHookOutput(eventName, combinedDecision) {
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
