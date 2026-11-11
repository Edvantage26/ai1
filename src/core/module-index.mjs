// Every ai1 module, as metadata only: { id, event, feature, toolNames?, modulePath }. The hook entry
// point imports just the modules of the event it runs (a tool call pays for one or two modules, not
// all of them); the dispatcher decides with this metadata, which is all `enabledModules` needs.
// `feature` is an id from src/core/features.mjs. `toolNames` (PreToolUse/PostToolUse) limits the
// module to those tools. `modulePath` is relative to this file; the module's default export repeats
// id, event, feature and toolNames (test/dispatcher.test.mjs checks they agree).
// Adding a module means one line here and its entry in the schema; hooks/hooks.json does not change.

export const MODULE_INDEX = [
  { id: 'brief', event: 'SessionStart', feature: 'core', modulePath: '../context/brief.mjs' },
  { id: 'issue-offer', event: 'UserPromptSubmit', feature: 'core', modulePath: './issue-offer.mjs' },
  { id: 'okf-index', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-index.mjs' },
  { id: 'okf-claude-md', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-claude-md.mjs' },
  { id: 'okf-recall', event: 'UserPromptSubmit', feature: 'okf', modulePath: '../okf/okf-recall.mjs' },
  { id: 'okf-file-context', event: 'PostToolUse', feature: 'okf', toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'], modulePath: '../okf/okf-file-context.mjs' },
  { id: 'danger', event: 'PreToolUse', feature: 'danger', toolNames: ['Bash'], modulePath: '../guards/danger.mjs' },
  { id: 'config-guard', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../guards/config-guard.mjs' },
  { id: 'repo-rules', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../guards/repo-rules.mjs' },
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
  { id: 'tool-loop', event: 'PreToolUse', feature: 'verify', toolNames: ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'], modulePath: '../verify/tool-loop.mjs' },
  { id: 'worktree-brief', event: 'SessionStart', feature: 'worktrees', modulePath: '../worktrees/worktree-brief.mjs' },
  { id: 'worktree-reminder', event: 'UserPromptSubmit', feature: 'worktrees', modulePath: '../worktrees/worktree-reminder.mjs' },
  { id: 'worktree-recipe-offer', event: 'Stop', feature: 'worktrees', modulePath: '../worktrees/worktree-recipe-offer.mjs' },
  { id: 'later-brief', event: 'SessionStart', feature: 'later', modulePath: '../later/later-brief.mjs' },
  { id: 'later-recall', event: 'UserPromptSubmit', feature: 'later', modulePath: '../later/later-recall.mjs' },
  { id: 'walkthrough-reminder', event: 'Stop', feature: 'walkthrough', modulePath: '../walkthrough/walkthrough-reminder.mjs' },
  { id: 'later-upkeep', event: 'Stop', feature: 'later', modulePath: '../later/later-upkeep.mjs' },
];

export const KNOWN_MODULE_IDS = MODULE_INDEX.map((moduleEntry) => moduleEntry.id);

export function modulesForEvent(eventName, toolName, candidateModules = MODULE_INDEX) {
  return candidateModules.filter((moduleDefinition) => moduleDefinition.event === eventName
    && (!moduleDefinition.toolNames || moduleDefinition.toolNames.includes(toolName)));
}

export async function loadModule(moduleEntry) {
  return (await import(new URL(moduleEntry.modulePath, import.meta.url))).default;
}

// The runnable modules of one hook event (filtered by tool, not yet by the repo's features).
export function loadModulesForEvent(eventName, toolName) {
  return Promise.all(modulesForEvent(eventName, toolName).map(loadModule));
}
