// Every ai1 module, as metadata only: { id, event, feature, toolNames?, modulePath }. The hook entry
// point imports just the modules of the event it runs (a tool call pays for one or two modules, not
// all of them); the dispatcher decides with this metadata, which is all `enabledModules` needs.
// `feature` is an id from src/core/features.mjs. `toolNames` (PreToolUse/PostToolUse) limits the
// module to those tools (a name ending in `*` matches by prefix: `mcp__*`). `decidedByTarget`: the repository a call edits decides whether the module
// applies (its own features), so it runs whatever the launch repo enables. `personScoped`: the person's own setup decides (their
// config repo), so it runs in any folder, with or without ai1 set up there. `modulePath` is relative to this file; the module's default export repeats
// id, event, feature and toolNames (test/dispatcher.test.mjs checks they agree).
// `personOnly`: a nudge for the person watching the session (offers, reminders, notices); silent in a
// session started by `ai1 delegate` (AI1_DELEGATION set), where nobody is watching.
// Adding a module means one line here and its entry in the schema; hooks/hooks.json does not change.

export const MODULE_INDEX = [
  { id: 'brief', event: 'SessionStart', feature: 'core', modulePath: '../context/brief.mjs' },
  { id: 'issue-offer', personOnly: true, event: 'UserPromptSubmit', feature: 'core', modulePath: './issue-offer.mjs' },
  { id: 'issue-guard', event: 'PreToolUse', feature: 'core', toolNames: ['Bash'], modulePath: './issue-guard.mjs' },
  { id: 'customization-check', personOnly: true, event: 'Stop', feature: 'core', modulePath: './customization-check.mjs' },
  { id: 'local-sync-start', event: 'SessionStart', feature: 'core', modulePath: './local-sync-start.mjs' },
  { id: 'local-sync-stop', event: 'Stop', feature: 'core', modulePath: './local-sync-stop.mjs' },
  { id: 'config-sync-start', personOnly: true, event: 'SessionStart', feature: 'core', personScoped: true, modulePath: '../config/config-sync-start.mjs' },
  { id: 'config-sync-stop', event: 'Stop', feature: 'core', personScoped: true, modulePath: '../config/config-sync-stop.mjs' },
  { id: 'config-skill-hint', event: 'PostToolUse', feature: 'core', personScoped: true, toolNames: ['Write'], modulePath: '../config/config-skill-hint.mjs' },
  { id: 'okf-index', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-index.mjs' },
  { id: 'okf-claude-md', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-claude-md.mjs' },
  { id: 'okf-catch-up-start', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-catch-up-start.mjs' },
  { id: 'okf-project', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-project-brief.mjs' },
  { id: 'okf-catch-up-prompt', event: 'UserPromptSubmit', feature: 'okf', modulePath: '../okf/okf-catch-up-prompt.mjs' },
  { id: 'okf-recall', event: 'UserPromptSubmit', feature: 'okf', modulePath: '../okf/okf-recall.mjs' },
  { id: 'okf-file-context', event: 'PostToolUse', feature: 'okf', toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'], modulePath: '../okf/okf-file-context.mjs' },
  { id: 'danger', event: 'PreToolUse', feature: 'danger', toolNames: ['Bash'], modulePath: '../guards/danger.mjs' },
  { id: 'config-guard', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../guards/config-guard.mjs' },
  { id: 'rule-offer', personOnly: true, event: 'UserPromptSubmit', feature: 'danger', modulePath: '../guards/rule-offer.mjs' },
  { id: 'repo-rules', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'mcp__*'], modulePath: '../guards/repo-rules.mjs' },
  { id: 'okf-upkeep', event: 'Stop', feature: 'okf', modulePath: '../okf/okf-upkeep.mjs' },
  { id: 'craft-brief', event: 'SessionStart', feature: 'craft', modulePath: '../craft/craft-brief.mjs' },
  { id: 'sizing-brief', event: 'SessionStart', feature: 'sizing', modulePath: '../sizing/sizing-brief.mjs' },
  { id: 'sizing-approval', event: 'UserPromptSubmit', feature: 'sizing', modulePath: '../sizing/sizing-approval.mjs' },
  { id: 'sizing-gate', event: 'PreToolUse', feature: 'sizing', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../sizing/sizing-gate.mjs' },
  { id: 'sizing-escalate', event: 'PreToolUse', feature: 'sizing', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../sizing/sizing-escalate.mjs' },
  { id: 'design-brief', event: 'SessionStart', feature: 'design', modulePath: '../design/design-brief.mjs' },
  { id: 'design-detect', event: 'PostToolUse', feature: 'design', toolNames: ['Edit', 'Write', 'MultiEdit'], modulePath: '../design/design-detect.mjs' },
  { id: 'verify-gate', event: 'Stop', feature: 'verify', modulePath: '../verify/verify-gate.mjs' },
  { id: 'test-guard', event: 'PreToolUse', feature: 'verify', toolNames: ['Edit', 'Write', 'MultiEdit', 'Bash'], modulePath: '../verify/test-guard.mjs' },
  { id: 'fix-loop', event: 'PostToolUse', feature: 'verify', toolNames: ['Edit', 'Write', 'MultiEdit'], modulePath: '../verify/fix-loop.mjs' },
  { id: 'llm-brief', event: 'SessionStart', feature: 'verify', modulePath: '../verify/llm-brief.mjs' },
  { id: 'tool-loop', event: 'PreToolUse', feature: 'verify', toolNames: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'], modulePath: '../verify/tool-loop.mjs' },
  { id: 'worktree-brief', event: 'SessionStart', feature: 'worktrees', modulePath: '../worktrees/worktree-brief.mjs' },
  { id: 'worktree-reminder', event: 'UserPromptSubmit', feature: 'worktrees', modulePath: '../worktrees/worktree-reminder.mjs' },
  { id: 'later-brief', event: 'SessionStart', feature: 'later', modulePath: '../later/later-brief.mjs' },
  { id: 'later-recall', event: 'UserPromptSubmit', feature: 'later', modulePath: '../later/later-recall.mjs' },
  { id: 'storyboard-reminder', personOnly: true, event: 'Stop', feature: 'storyboard', modulePath: '../storyboard/storyboard-reminder.mjs' },
  { id: 'later-upkeep', event: 'Stop', feature: 'later', modulePath: '../later/later-upkeep.mjs' },
  { id: 'routine-notice', personOnly: true, event: 'SessionStart', feature: 'routines', modulePath: '../routines/routine-notice.mjs' },
  { id: 'watch-notice', personOnly: true, event: 'SessionStart', feature: 'watches', modulePath: '../watches/watch-notice.mjs' },
  { id: 'watch-release-detect', event: 'PostToolUse', feature: 'watches', toolNames: ['Bash'], modulePath: '../watches/watch-release-detect.mjs' },
  { id: 'reuse-brief', event: 'SessionStart', feature: 'reuse', modulePath: '../reuse/reuse-brief.mjs' },
  { id: 'reuse-check', personOnly: true, event: 'Stop', feature: 'reuse', modulePath: '../reuse/reuse-check.mjs' },
  { id: 'foreign-repo', event: 'PreToolUse', feature: 'delegate', decidedByTarget: true, toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../delegate/foreign-repo.mjs' },
  { id: 'delegate-report', event: 'Stop', feature: 'delegate', modulePath: '../delegate/delegate-report.mjs' },
  { id: 'foreign-repo-verify', event: 'Stop', feature: 'delegate', decidedByTarget: true, modulePath: '../delegate/foreign-repo-verify.mjs' },
];

export const KNOWN_MODULE_IDS = MODULE_INDEX.map((moduleEntry) => moduleEntry.id);

// A tool name in `toolNames` ending in `*` matches by prefix (`mcp__*`: every MCP tool).
function moduleHandlesTool(moduleDefinition, toolName) {
  if (!moduleDefinition.toolNames) return true;
  return moduleDefinition.toolNames.some((handledTool) => (handledTool.endsWith('*') ? String(toolName || '').startsWith(handledTool.slice(0, -1)) : handledTool === toolName));
}

export function modulesForEvent(eventName, toolName, candidateModules = MODULE_INDEX) {
  return candidateModules.filter((moduleDefinition) => moduleDefinition.event === eventName && moduleHandlesTool(moduleDefinition, toolName));
}

export async function loadModule(moduleEntry) {
  return (await import(new URL(moduleEntry.modulePath, import.meta.url))).default;
}

// The runnable modules of one hook event (filtered by tool, not yet by the repo's features).
export function loadModulesForEvent(eventName, toolName) {
  return Promise.all(modulesForEvent(eventName, toolName).map(loadModule));
}
