// storyboard-reminder (Stop, feature `storyboard`): when this session changed UI files (the same
// classification as design-detect) and no storyboard in .ai1/storyboards/ was built after the newest
// of them, reminds the agent once to record the user flow (/ai1:storyboard-record-flow) or say why
// not. Never more than twice per session, and the same set of files only once.
//
// Options (modules.storyboard-reminder): ignore: globs of UI files that never need a storyboard.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { STORYBOARDS_DIRECTORY } from '../core/config.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, claimStopBlock } from '../core/session-state.mjs';
import { classifyUiFile } from '../design/design-rules.mjs';
import { HTML_FILE_NAME } from './storyboard-build.mjs';

const MODULE_ID = 'storyboard-reminder';
const MAX_BLOCKS_PER_SESSION = 2;
const MAX_LISTED_FILES = 5;

// Newest build time of any storyboard in the repo (0 when none).
export function newestStoryboardBuildMilliseconds(sharedRoot) {
  const storyboardsDirectory = join(sharedRoot, STORYBOARDS_DIRECTORY);
  if (!existsSync(storyboardsDirectory)) return 0;
  return Math.max(0, ...readdirSync(storyboardsDirectory)
    .map((slug) => join(storyboardsDirectory, slug, HTML_FILE_NAME))
    .filter((htmlPath) => existsSync(htmlPath))
    .map((htmlPath) => statSync(htmlPath).mtimeMs));
}

export function buildStoryboardReminder(changedUiFiles) {
  const listedFiles = changedUiFiles.slice(0, MAX_LISTED_FILES).map((uiFile) => `\`${uiFile}\``).join(', ')
    + (changedUiFiles.length > MAX_LISTED_FILES ? ` and ${changedUiFiles.length - MAX_LISTED_FILES} more` : '');
  return `Storyboard: this session changed UI files (${listedFiles}) and no storyboard was built after them. `
    + 'Record the user flow for the person with /ai1:storyboard-record-flow (steps, screenshots, before/after, local URL), '
    + 'or say in one line why not (no visible change, the app cannot run here) and finish.';
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'storyboard',
  description: 'Reminds once, at stop, to record the user flow as a storyboard when the session changed UI files and built none after them.',
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment, moduleOptions }) {
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const ignoredGlobs = moduleOptions.ignore ?? [];
    const changedUiFiles = listFilesChangedSinceBase(projectRoot, sessionBase.baseHead)
      .filter((changedPath) => classifyUiFile(changedPath) && !matchesAnyGlob(changedPath, ignoredGlobs))
      .filter((changedPath) => existsSync(join(projectRoot, changedPath)))
      .map((changedPath) => ({ changedPath, modifiedMilliseconds: statSync(join(projectRoot, changedPath)).mtimeMs }))
      .filter((uiFile) => uiFile.modifiedMilliseconds >= sessionBase.sessionStartMilliseconds);
    if (!changedUiFiles.length) return allowDecision();
    const newestUiChange = Math.max(...changedUiFiles.map((uiFile) => uiFile.modifiedMilliseconds));
    if (newestStoryboardBuildMilliseconds(sharedRoot) >= newestUiChange) return allowDecision();
    const changedPaths = changedUiFiles.map((uiFile) => uiFile.changedPath).sort();
    const blockStatePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'storyboard-reminded');
    if (!claimStopBlock(blockStatePath, changedPaths.join('\n'), MAX_BLOCKS_PER_SESSION)) return allowDecision();
    return blockDecision(MODULE_ID, buildStoryboardReminder(changedPaths));
  },
};
