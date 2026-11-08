import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Creates a throwaway project directory, optionally with a .ai1/config.json.
export function createTemporaryProject(ai1Config) {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ai1-test-'));
  if (ai1Config !== undefined) {
    mkdirSync(join(projectRoot, '.ai1'), { recursive: true });
    const configText = typeof ai1Config === 'string' ? ai1Config : JSON.stringify(ai1Config);
    writeFileSync(join(projectRoot, '.ai1', 'config.json'), configText);
  }
  return projectRoot;
}

export function bashPayload(projectRoot, commandLine) {
  return {
    session_id: 'test-session',
    hook_event_name: 'PreToolUse',
    cwd: projectRoot,
    tool_name: 'Bash',
    tool_input: { command: commandLine },
  };
}
