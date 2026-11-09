// Starts, finds and stops the storyboard server of a slug (`ai1 walkthrough serve|stop|list`, and
// `ai1 worktree finish|drop`, which release the URL of the worktree's storyboard). The record is
// `server.json` in the storyboard folder; a record whose process is gone or no longer listens is
// stale and removed.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORK_DIRECTORY } from '../core/config.mjs';
import { readJsonFileIfValid } from '../core/json-file.mjs';
import { readGitDirectories } from '../core/project-roots.mjs';
import { listListeningPorts, pickWorktreePort, DEFAULT_PORT_RANGE } from '../worktrees/worktree-ports.mjs';
import { listWorktreeStates } from '../worktrees/worktree-state.mjs';
import { cleanResidualScreenshots, readStoryboard, storyboardDirectory } from './walkthrough-storyboard.mjs';
import { HTML_FILE_NAME } from './walkthrough-build.mjs';

export const SERVER_INFO_FILE_NAME = 'server.json';
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_TTL_HOURS = 8;
const SERVER_SCRIPT_PATH = fileURLToPath(new URL('./walkthrough-server.mjs', import.meta.url));
const SERVER_START_TIMEOUT_MILLISECONDS = 5000;
const SERVER_POLL_MILLISECONDS = 50;

const sleepMilliseconds = (waitMilliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMilliseconds);

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (signalError) {
    return signalError.code === 'EPERM';
  }
}

// The live server record of a storyboard, or null (a stale record is removed on the way).
export function readLiveServer(storyboardPath, listeningPorts = listListeningPorts()) {
  const serverInfoPath = join(storyboardPath, SERVER_INFO_FILE_NAME);
  const serverInfo = readJsonFileIfValid(serverInfoPath);
  if (!serverInfo) return null;
  const answersOnPort = listeningPorts.size === 0 || listeningPorts.has(serverInfo.port);
  if (Number.isInteger(serverInfo.pid) && isProcessAlive(serverInfo.pid) && answersOnPort) return serverInfo;
  rmSync(serverInfoPath, { force: true });
  return null;
}

function takenPorts(mainRoot, listeningPorts) {
  const commonDirectory = readGitDirectories(mainRoot)?.commonDirectory;
  const worktreePorts = commonDirectory ? listWorktreeStates(commonDirectory).map((worktreeState) => worktreeState.port).filter(Boolean) : [];
  return new Set([...listeningPorts, ...worktreePorts]);
}

// Starts the server (or returns the one already running): { serverInfo, alreadyRunning }.
export function serveStoryboard(mainRoot, slug, { host, port, ttlHours } = {}) {
  host ??= DEFAULT_SERVER_HOST;
  ttlHours ??= DEFAULT_SERVER_TTL_HOURS;
  const storyboardPath = storyboardDirectory(mainRoot, slug);
  if (!existsSync(join(storyboardPath, HTML_FILE_NAME))) throw new Error(`no storyboard built for "${slug}": run \`ai1 walkthrough build\` first`);
  const listeningPorts = listListeningPorts();
  const runningServer = readLiveServer(storyboardPath, listeningPorts);
  if (runningServer) return { serverInfo: runningServer, alreadyRunning: true };
  const chosenPort = port ? Number(port) : pickWorktreePort(`walkthrough:${slug}`, DEFAULT_PORT_RANGE, takenPorts(mainRoot, listeningPorts));
  const ttlMilliseconds = Math.round(Number(ttlHours) * 3600 * 1000);
  if (!Number.isInteger(chosenPort) || !(ttlMilliseconds > 0)) throw new Error('--port must be a number and --ttl a positive number of hours');
  const serverProcess = spawn(process.execPath, [SERVER_SCRIPT_PATH, storyboardPath, String(chosenPort), host, String(ttlMilliseconds)], { detached: true, stdio: 'ignore' });
  serverProcess.unref();
  for (let waitedMilliseconds = 0; waitedMilliseconds < SERVER_START_TIMEOUT_MILLISECONDS; waitedMilliseconds += SERVER_POLL_MILLISECONDS) {
    const serverInfo = readJsonFileIfValid(join(storyboardPath, SERVER_INFO_FILE_NAME));
    if (serverInfo?.pid === serverProcess.pid) return { serverInfo, alreadyRunning: false };
    sleepMilliseconds(SERVER_POLL_MILLISECONDS);
  }
  try { process.kill(serverProcess.pid, 'SIGTERM'); } catch { /* already gone */ }
  throw new Error(`the storyboard server did not start on ${host}:${chosenPort} (port taken?); try --port <other>`);
}

// Stops the server of a slug; returns the URL it released, or null when none was running.
export function stopStoryboardServer(mainRoot, slug) {
  const storyboardPath = storyboardDirectory(mainRoot, slug);
  const serverInfo = readLiveServer(storyboardPath);
  if (!serverInfo) return null;
  try { process.kill(serverInfo.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let waitedMilliseconds = 0; waitedMilliseconds < SERVER_START_TIMEOUT_MILLISECONDS && isProcessAlive(serverInfo.pid); waitedMilliseconds += SERVER_POLL_MILLISECONDS) {
    sleepMilliseconds(SERVER_POLL_MILLISECONDS);
  }
  rmSync(join(storyboardPath, SERVER_INFO_FILE_NAME), { force: true });
  return serverInfo.url;
}

// What closing a change does to its storyboard: stops the server and deletes the residual screenshots.
// Returns a line for the person, or null when there was nothing to do.
export function closeStoryboard(mainRoot, slug) {
  const releasedUrl = stopStoryboardServer(mainRoot, slug);
  const { deleted } = cleanResidualScreenshots(storyboardDirectory(mainRoot, slug));
  const closeParts = [
    releasedUrl ? `storyboard server stopped (${releasedUrl})` : null,
    deleted.length ? `${deleted.length} residual screenshot(s) deleted` : null,
  ].filter(Boolean);
  return closeParts.length ? `${closeParts.join(', ')}; the storyboard stays in ${WORK_DIRECTORY}/${slug}/walkthrough/` : null;
}

// Every storyboard in the repo: { slug, steps, built, url }.
export function listStoryboards(mainRoot) {
  const workDirectory = join(mainRoot, WORK_DIRECTORY);
  if (!existsSync(workDirectory)) return [];
  const listeningPorts = listListeningPorts();
  return readdirSync(workDirectory).flatMap((slug) => {
    const storyboardPath = storyboardDirectory(mainRoot, slug);
    const storyboard = readStoryboard(storyboardPath);
    if (!storyboard) return [];
    return [{ slug, steps: storyboard.steps.length, built: existsSync(join(storyboardPath, HTML_FILE_NAME)), url: readLiveServer(storyboardPath, listeningPorts)?.url ?? null }];
  });
}
