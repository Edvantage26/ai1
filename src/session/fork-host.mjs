// Which host the current session runs in, so `ai1 fork` opens the new conversation the native way.
// Signals (code.claude.com/docs env-vars; CLAUDE_CODE_ENTRYPOINT values are observed, not a
// documented contract, so detection degrades to `terminal`):
//   paseo   PASEO_AGENT_ID (set by the Paseo daemon for its agents)
//   web     CLAUDE_CODE_REMOTE=true (claude.ai/code cloud sessions)
//   vscode  CLAUDE_CODE_ENTRYPOINT=claude-vscode, or TERM_PROGRAM=vscode
//   terminal anything else (CLI, JetBrains terminal, SDK, Desktop: Desktop has no signal)
// The person can choose instead (`fork_opener` in /config, passed by the skill as --opener): where the
// new conversation opens is theirs, not the repo's, and Desktop leaves no signal to detect.

export function detectForkHost(environment = process.env, platformName = process.platform) {
  const canOpenInDesktop = platformName === 'darwin' || platformName === 'win32';
  if (environment.PASEO_AGENT_ID) return { id: 'paseo', reason: `PASEO_AGENT_ID=${environment.PASEO_AGENT_ID}`, canOpenInDesktop };
  if (environment.CLAUDE_CODE_REMOTE === 'true') return { id: 'web', reason: 'CLAUDE_CODE_REMOTE=true', canOpenInDesktop: false };
  if (environment.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return { id: 'vscode', reason: 'CLAUDE_CODE_ENTRYPOINT=claude-vscode', canOpenInDesktop };
  if (environment.TERM_PROGRAM === 'vscode') return { id: 'vscode', reason: 'TERM_PROGRAM=vscode', canOpenInDesktop };
  return { id: 'terminal', reason: 'no Paseo, web or VS Code signal', canOpenInDesktop };
}

export const FORK_OPENERS = ['auto', 'paseo', 'vscode', 'desktop', 'terminal'];

// The detected host, replaced by the person's opener when it applies. An unset option reaches the
// skill as the literal `${user_config.fork_opener}`, so anything starting with `${` means auto.
export function applyForkOpener(detectedHost, openerValue) {
  const opener = String(openerValue ?? '').trim().toLowerCase();
  if (!opener || opener.startsWith('${') || opener === 'auto') return { host: detectedHost, notice: null };
  if (!FORK_OPENERS.includes(opener)) return { host: detectedHost, notice: `unknown fork opener "${openerValue}" (use ${FORK_OPENERS.join(', ')}); using the detected host` };
  if (detectedHost.id === 'web') return { host: detectedHost, notice: `fork opener "${opener}" ignored: this session runs on the web` };
  if (opener === 'desktop' && !detectedHost.canOpenInDesktop) return { host: detectedHost, notice: 'fork opener "desktop" ignored: Claude Desktop does not open sessions on this system' };
  return { host: { ...detectedHost, id: opener, reason: `fork opener "${opener}" (detected: ${detectedHost.id})`, detectedId: detectedHost.id }, notice: null };
}
