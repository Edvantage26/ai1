// A port per worktree: stable for a name (a hash into the recipe's range), skipping ports that
// other worktrees hold or that something already listens on. All synchronous, no network: the
// listening ports come from /proc/net/tcp{,6} where it exists.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { shortHash } from '../core/session-state.mjs';

export const DEFAULT_PORT_RANGE = [10000, 19999];
const TCP_LISTEN_STATE = '0A';

export function listListeningPorts(procFiles = ['/proc/net/tcp', '/proc/net/tcp6']) {
  const listeningPorts = new Set();
  for (const procFile of procFiles) {
    if (!existsSync(procFile)) continue;
    for (const socketLine of readFileSync(procFile, 'utf8').split('\n').slice(1)) {
      const socketFields = socketLine.trim().split(/\s+/);
      if (socketFields.length < 4 || socketFields[3] !== TCP_LISTEN_STATE) continue;
      listeningPorts.add(Number.parseInt(socketFields[1].split(':').pop(), 16));
    }
  }
  return listeningPorts;
}

export function pickWorktreePort(worktreeName, portRange = DEFAULT_PORT_RANGE, takenPorts = new Set()) {
  const [lowestPort, highestPort] = portRange;
  const rangeSize = highestPort - lowestPort + 1;
  const startOffset = Number.parseInt(shortHash(worktreeName).slice(0, 8), 16) % rangeSize;
  for (let probeOffset = 0; probeOffset < rangeSize; probeOffset += 1) {
    const candidatePort = lowestPort + ((startOffset + probeOffset) % rangeSize);
    if (!takenPorts.has(candidatePort)) return candidatePort;
  }
  throw new Error(`no free port in ${lowestPort}-${highestPort}`);
}

// Sets `variables` in a dotenv file, replacing their lines and keeping every other line.
export function writeEnvVariables(envFilePath, variables) {
  const envText = existsSync(envFilePath) ? readFileSync(envFilePath, 'utf8').replace(/\n+$/, '') : '';
  const envLines = envText ? envText.split('\n') : [];
  const pendingVariables = new Map(Object.entries(variables));
  const updatedLines = envLines.map((envLine) => {
    const variableMatch = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(envLine);
    if (!variableMatch || !pendingVariables.has(variableMatch[1])) return envLine;
    const replacedLine = `${variableMatch[1]}=${pendingVariables.get(variableMatch[1])}`;
    pendingVariables.delete(variableMatch[1]);
    return replacedLine;
  });
  for (const [variableName, variableValue] of pendingVariables) updatedLines.push(`${variableName}=${variableValue}`);
  writeFileSync(envFilePath, `${updatedLines.join('\n')}\n`);
}
