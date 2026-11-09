// Every ai1 module, as metadata only: { id, event, feature, toolNames?, modulePath }. The hook entry
// point imports just the modules of the event it runs (a tool call pays for one or two modules, not
// all of them); the dispatcher decides with this metadata, which is all `enabledModules` needs.
// `feature` is an id from src/core/features.mjs. `toolNames` (PreToolUse/PostToolUse) limits the
// module to those tools. `modulePath` is relative to this file; the module's default export repeats
// id, event, feature and toolNames (test/dispatcher.test.mjs checks they agree).
// Adding a module means one line here and its entry in the schema; hooks/hooks.json does not change.

export const MODULE_INDEX = [
  { id: 'brief', event: 'SessionStart', feature: 'core', modulePath: '../context/brief.mjs' },
  { id: 'okf-index', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-index.mjs' },
  { id: 'okf-claude-md', event: 'SessionStart', feature: 'okf', modulePath: '../okf/okf-claude-md.mjs' },
  { id: 'okf-recall', event: 'UserPromptSubmit', feature: 'okf', modulePath: '../okf/okf-recall.mjs' },
  { id: 'okf-file-context', event: 'PostToolUse', feature: 'okf', toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'], modulePath: '../okf/okf-file-context.mjs' },
  { id: 'danger', event: 'PreToolUse', feature: 'danger', toolNames: ['Bash'], modulePath: '../guards/danger.mjs' },
  { id: 'config-guard', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../guards/config-guard.mjs' },
  { id: 'repo-rules', event: 'PreToolUse', feature: 'danger', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../guards/repo-rules.mjs' },
  { id: 'okf-upkeep', event: 'Stop', feature: 'okf', modulePath: '../okf/okf-upkeep.mjs' },
  { id: 'craft-brief', event: 'SessionStart', feature: 'craft', modulePath: '../craft/craft-brief.mjs' },
  { id: 'lanes-brief', event: 'SessionStart', feature: 'lanes', modulePath: '../lanes/lanes-brief.mjs' },
  { id: 'lanes-approval', event: 'UserPromptSubmit', feature: 'lanes', modulePath: '../lanes/lanes-approval.mjs' },
  { id: 'lanes-gate', event: 'PreToolUse', feature: 'lanes', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../lanes/lanes-gate.mjs' },
  { id: 'lanes-escalate', event: 'PreToolUse', feature: 'lanes', toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'], modulePath: '../lanes/lanes-escalate.mjs' },
  { id: 'design-brief', event: 'SessionStart', feature: 'design', modulePath: '../design/design-brief.mjs' },
  { id: 'design-detect', event: 'PostToolUse', feature: 'design', toolNames: ['Edit', 'Write', 'MultiEdit'], modulePath: '../design/design-detect.mjs' },
  { id: 'verify-gate', event: 'Stop', feature: 'verify', modulePath: '../verify/verify-gate.mjs' },
  { id: 'test-guard', event: 'PreToolUse', feature: 'verify', toolNames: ['Edit', 'Write', 'MultiEdit', 'Bash'], modulePath: '../verify/test-guard.mjs' },
  { id: 'worktree-brief', event: 'SessionStart', feature: 'worktrees', modulePath: '../worktrees/worktree-brief.mjs' },
  { id: 'worktree-reminder', event: 'UserPromptSubmit', feature: 'worktrees', modulePath: '../worktrees/worktree-reminder.mjs' },
  { id: 'proposals-brief', event: 'SessionStart', feature: 'proposals', modulePath: '../proposals/proposals-brief.mjs' },
  { id: 'proposals-recall', event: 'UserPromptSubmit', feature: 'proposals', modulePath: '../proposals/proposals-recall.mjs' },
  { id: 'proposals-upkeep', event: 'Stop', feature: 'proposals', modulePath: '../proposals/proposals-upkeep.mjs' },
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
