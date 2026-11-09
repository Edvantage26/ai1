// `ai1 walkthrough build --pdf`: prints index.html (its print stylesheet: one step per page) to
// walkthrough.pdf with a headless Chrome/Chromium found on this machine. An optional system tool: when
// none is found or printing fails, the caller says so and the agent prints with its own browser tool.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PDF_FILE_NAME = 'walkthrough.pdf';
export const PDF_TIMEOUT_MILLISECONDS = 60_000;
const PATH_BROWSER_NAMES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome'];
// Inside Playwright's cache folder `chromium-<build>/`, newest build first.
const PLAYWRIGHT_BROWSER_PATHS = [
  ['chrome-linux64', 'chrome'], ['chrome-linux', 'chrome'],
  ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'], ['chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ['chrome-win', 'chrome.exe'], ['chrome-win64', 'chrome.exe'],
];

function playwrightCacheDirectory(environment) {
  if (environment.PLAYWRIGHT_BROWSERS_PATH) return environment.PLAYWRIGHT_BROWSERS_PATH;
  if (process.platform === 'darwin') return join(environment.HOME || homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(environment.LOCALAPPDATA || '', 'ms-playwright');
  return join(environment.HOME || homedir(), '.cache', 'ms-playwright');
}

// The first Chrome/Chromium on PATH, else the newest one in Playwright's cache; null when none.
export function findChromeBinary(environment = process.env) {
  for (const pathDirectory of (environment.PATH || '').split(delimiter).filter(Boolean)) {
    for (const browserName of PATH_BROWSER_NAMES) {
      const candidatePath = join(pathDirectory, process.platform === 'win32' ? `${browserName}.exe` : browserName);
      if (existsSync(candidatePath)) return candidatePath;
    }
  }
  const cacheDirectory = playwrightCacheDirectory(environment);
  if (!existsSync(cacheDirectory)) return null;
  const chromiumBuilds = readdirSync(cacheDirectory)
    .filter((folderName) => /^chromium-\d+$/.test(folderName))
    .sort((firstBuild, secondBuild) => Number(secondBuild.split('-')[1]) - Number(firstBuild.split('-')[1]));
  for (const chromiumBuild of chromiumBuilds) {
    for (const browserPath of PLAYWRIGHT_BROWSER_PATHS) {
      const candidatePath = join(cacheDirectory, chromiumBuild, ...browserPath);
      if (existsSync(candidatePath)) return candidatePath;
    }
  }
  return null;
}

// { pdfPath } or { error }. `--no-sandbox`: the page is the storyboard ai1 just wrote (no remote
// content), and Chrome's sandbox fails to start inside sandboxed agent shells.
export function printStoryboardPdf(storyboardPath, htmlPath, { environment = process.env, chromeBinary = findChromeBinary(environment) } = {}) {
  if (!chromeBinary) return { error: 'no Chrome or Chromium found (PATH or Playwright cache)' };
  const pdfPath = join(storyboardPath, PDF_FILE_NAME);
  rmSync(pdfPath, { force: true });
  const printRun = spawnSync(chromeBinary, [
    '--headless', '--no-sandbox', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { encoding: 'utf8', timeout: PDF_TIMEOUT_MILLISECONDS });
  if (existsSync(pdfPath) && statSync(pdfPath).size > 0) return { pdfPath, chromeBinary };
  const failureReason = printRun.error?.code === 'ETIMEDOUT' ? `timed out after ${PDF_TIMEOUT_MILLISECONDS / 1000} s` : `exit ${printRun.status ?? printRun.error?.code}`;
  return { error: `${chromeBinary} could not print the PDF (${failureReason})` };
}
