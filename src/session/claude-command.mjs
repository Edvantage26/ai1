// How ai1 starts Claude Code from a tool call (`ai1 delegate`, `ai1 fork full`): the explicit command,
// AI1_CLAUDE_COMMAND, else `claude`. A machine that needs a wrapper (one that logs in an account, say)
// passes it from the person's skill customization: host-specific tooling is not part of the plugin.

// The program and leading arguments, split on spaces (a path with spaces is not supported).
export function resolveClaudeCommand(claudeCommand, environment = process.env) {
  const commandText = String(claudeCommand || environment.AI1_CLAUDE_COMMAND || 'claude').trim();
  return commandText.split(/\s+/).filter(Boolean);
}
