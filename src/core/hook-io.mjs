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

// Claude Code caps `additionalContext` and `systemMessage` at 10,000 characters per field and hook
// command; over it the agent only gets a 2,000-character preview and a file path. ai1 sends one hook
// per event, so the texts of all its modules share this budget (kept under the cap with a margin).
export const MAX_FIELD_CHARACTERS = 9500;

const CONTEXT_SEPARATOR = '\n\n';
const NOTICE_SEPARATOR = '\n';

function buildTrimMarker(moduleId, removedCharacters) {
  return `\n[ai1/${moduleId}: ${removedCharacters} more characters left out to stay under Claude Code's 10,000-character hook limit]`;
}

// Cuts one text to at most `maxCharacters`, marker included, at a line end when one is near.
function trimTextToLength(moduleId, text, maxCharacters) {
  if (text.length <= maxCharacters) return { text, removedCharacters: 0 };
  const reservedForMarker = buildTrimMarker(moduleId, text.length).length;
  const keptLength = Math.max(0, maxCharacters - reservedForMarker);
  const lastLineEnd = text.lastIndexOf('\n', keptLength);
  const cutPosition = lastLineEnd >= keptLength / 2 ? lastLineEnd : keptLength;
  const removedCharacters = text.length - cutPosition;
  return { text: `${text.slice(0, cutPosition)}${buildTrimMarker(moduleId, removedCharacters)}`, removedCharacters };
}

// Fits the texts of several modules, joined by `separator`, into `budgetCharacters`. The longest
// texts are cut first, all to the same length, so short ones (often dynamic state) stay whole.
// `textEntries`: [{ moduleId, text }]. Returns { texts, trimmedModules: [{ moduleId, removedCharacters }] }.
export function fitTextsToBudget(textEntries, separator, budgetCharacters = MAX_FIELD_CHARACTERS) {
  const fittedSize = (entries) => entries.reduce((totalLength, entry) => totalLength + entry.text.length, 0)
    + separator.length * Math.max(0, entries.length - 1);
  const untrimmed = { texts: textEntries.map((entry) => entry.text), trimmedModules: [] };
  if (fittedSize(textEntries) <= budgetCharacters) return untrimmed;
  const trimAll = (lengthCap) => textEntries.map((entry) => ({ moduleId: entry.moduleId, ...trimTextToLength(entry.moduleId, entry.text, lengthCap) }));
  let lowestCap = 0;
  let highestCap = Math.max(...textEntries.map((entry) => entry.text.length));
  while (lowestCap < highestCap) {
    const middleCap = Math.ceil((lowestCap + highestCap) / 2);
    if (fittedSize(trimAll(middleCap)) <= budgetCharacters) lowestCap = middleCap;
    else highestCap = middleCap - 1;
  }
  const trimmedEntries = trimAll(lowestCap);
  return {
    texts: trimmedEntries.map((entry) => entry.text),
    trimmedModules: trimmedEntries.filter((entry) => entry.removedCharacters > 0)
      .map((entry) => ({ moduleId: entry.moduleId, removedCharacters: entry.removedCharacters })),
  };
}

export function combineDecisions(moduleDecisions) {
  const meaningfulDecisions = moduleDecisions.filter((decision) => decision && decision.kind !== 'allow');
  const noticeEntries = meaningfulDecisions.filter((decision) => decision.kind === 'notice')
    .map((decision) => ({ moduleId: decision.moduleId, text: `ai1/${decision.moduleId}: ${decision.text}` }));
  const fittedNotices = fitTextsToBudget(noticeEntries, NOTICE_SEPARATOR);
  const contextEntries = meaningfulDecisions.filter((decision) => decision.kind === 'context')
    .map((decision) => ({ moduleId: decision.moduleId, text: decision.text }));
  const fittedContext = fitTextsToBudget(contextEntries, CONTEXT_SEPARATOR);
  const trimmedModules = [...fittedContext.trimmedModules, ...fittedNotices.trimmedModules];
  const withNotice = (combinedDecision) => ({
    ...combinedDecision,
    ...(fittedNotices.texts.length ? { notice: fittedNotices.texts.join(NOTICE_SEPARATOR) } : {}),
    ...(trimmedModules.length ? { trimmedModules } : {}),
  });
  const blockingDecisions = meaningfulDecisions.filter((decision) => !['context', 'notice'].includes(decision.kind));
  if (blockingDecisions.length === 0) {
    return withNotice(fittedContext.texts.length ? { kind: 'context', text: fittedContext.texts.join(CONTEXT_SEPARATOR) } : allowDecision());
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
  if (['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse'].includes(eventName) && combinedDecision.kind === 'context') {
    return { hookSpecificOutput: { hookEventName: eventName, additionalContext: combinedDecision.text } };
  }
  return null;
}
