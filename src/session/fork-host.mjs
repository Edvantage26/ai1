// Which host the current session runs in, so `ai1 fork` opens the new conversation the native way.
// Signals (code.claude.com/docs env-vars; CLAUDE_CODE_ENTRYPOINT values are observed, not a
// documented contract, so detection degrades to `terminal`):
//   paseo   PASEO_AGENT_ID (set by the Paseo daemon for its agents)
//   web     CLAUDE_CODE_REMOTE=true (claude.ai/code cloud sessions)
//   vscode  CLAUDE_CODE_ENTRYPOINT=claude-vscode, or TERM_PROGRAM=vscode
//   terminal anything else (CLI, JetBrains terminal, SDK, Desktop: Desktop has no signal)

export function detectForkHost(environment = process.env, platformName = process.platform) {
  const canOpenInDesktop = platformName === 'darwin' || platformName === 'win32';
  if (environment.PASEO_AGENT_ID) return { id: 'paseo', reason: `PASEO_AGENT_ID=${environment.PASEO_AGENT_ID}`, canOpenInDesktop };
  if (environment.CLAUDE_CODE_REMOTE === 'true') return { id: 'web', reason: 'CLAUDE_CODE_REMOTE=true', canOpenInDesktop: false };
  if (environment.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return { id: 'vscode', reason: 'CLAUDE_CODE_ENTRYPOINT=claude-vscode', canOpenInDesktop };
  if (environment.TERM_PROGRAM === 'vscode') return { id: 'vscode', reason: 'TERM_PROGRAM=vscode', canOpenInDesktop };
  return { id: 'terminal', reason: 'no Paseo, web or VS Code signal', canOpenInDesktop };
}
