// config-guard (PreToolUse, feature `danger`): changing the files that configure the harness -
// .ai1/config.json, .claude/settings.json, .claude/settings.local.json, .claude/hooks/ - asks the
// person first, so the agent cannot switch its own guards off unseen (`danger` reads `ignore_rules`
// from .ai1/config.json). `ask`, not `deny`: setup and the person change these files on purpose.
// Claude Code protects `.claude/` itself, but not in bypassPermissions mode, and never `.ai1/`.
// Matched by path ending, so the copies in other worktrees (`.claude/worktrees/*/`) count too.

import { allowDecision, askDecision } from '../core/hook-io.mjs';
import { listToolCallChanges, pathSpellings } from '../core/tool-call-paths.mjs';

const MODULE_ID = 'config-guard';
const PROTECTED_FILE_ENDINGS = ['/.ai1/config.json', '/.claude/settings.json', '/.claude/settings.local.json'];
const PROTECTED_DIRECTORY_SEGMENT = '/.claude/hooks/';
// An inline script (`python3 - <<EOF`, `node -e`) may write anywhere: it counts when its text names one of these.
const PROTECTED_PATH_MARKERS = ['.ai1/config.json', '.claude/settings', '.claude/hooks'];

export function isHarnessConfigPath(candidatePath, workingDirectory) {
  return pathSpellings(candidatePath, workingDirectory).some((pathSpelling) => PROTECTED_FILE_ENDINGS.some((protectedEnding) => pathSpelling.endsWith(protectedEnding))
    || pathSpelling.includes(PROTECTED_DIRECTORY_SEGMENT));
}

// The protected paths a tool call changes, as written in the call.
export function listHarnessConfigChanges(hookInput, workingDirectory) {
  const { changes, runsInlineScript } = listToolCallChanges(hookInput, workingDirectory);
  const changedConfigPaths = changes.filter((toolCallChange) => isHarnessConfigPath(toolCallChange.path, workingDirectory)).map((toolCallChange) => toolCallChange.rawPath);
  const commandText = String(hookInput.tool_input?.command || '');
  if (runsInlineScript) changedConfigPaths.push(...PROTECTED_PATH_MARKERS.filter((pathMarker) => commandText.includes(pathMarker)));
  return [...new Set(changedConfigPaths)];
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'],
  feature: 'danger',
  description: 'Asks the person before the agent changes the harness configuration (.ai1/config.json, .claude/settings*.json, .claude/hooks/).',
  run({ hookInput, projectRoot }) {
    const changedConfigPaths = listHarnessConfigChanges(hookInput, hookInput.cwd || projectRoot);
    if (changedConfigPaths.length === 0) return allowDecision();
    return askDecision(MODULE_ID, `changes ${changedConfigPaths.map((configPath) => `\`${configPath}\``).join(', ')}: the harness configuration that ai1's guards and Claude Code's permissions read. The person confirms; if they did not ask for this change, do not make it another way.`);
  },
};
