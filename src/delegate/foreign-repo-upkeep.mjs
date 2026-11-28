// foreign-repo-upkeep (Stop, feature `delegate`): for the files this session changed in another
// repository (hot edits, or a repository the person allowed here; foreign-repo records them), the agent
// cannot finish while
//   1. a changed file (not of that repo's knowledge bundle) is newer than the last passing
//      `ai1 verify --cwd <that working tree>` in the transcript;
//   2. that repo's knowledge bundle was changed and its OKF validator reports ERRORS;
//   3. a changed file is described by a concept of that repo that was not changed.
// Each situation is asked once, then it lets the agent stop (fail open). Like foreign-repo, the edited
// repository decides (`decidedByTarget`): it runs where the launch folder has no ai1, verify or okf.

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { findWorkingTreeTop } from '../core/project-roots.mjs';
import { claimStopBlock, readStateJson, resolveStateDirectory, sessionStatePath, shortHash, writeStateText } from '../core/session-state.mjs';
import { baseName, splitSimpleCommands } from '../core/shell-parse.mjs';
import { readNewTranscriptEvents, eventContentBlocks, TOOL_USE_MARKER, TOOL_RESULT_MARKER } from '../core/transcript-scan.mjs';
import { buildValidationReminder, runBundleValidator } from '../okf/okf-validator.mjs';
import { didRunFail } from '../verify/verify-gate.mjs';
import { readHotEditedFiles } from './delegate-state.mjs';
import { findTargetConcepts, locateInWorkingTree } from './target-knowledge.mjs';

const MODULE_ID = 'foreign-repo-upkeep';
const MAX_VALIDATION_BLOCKS_PER_SESSION = 2;
const MAX_PENDING_CONCEPT_BLOCKS_PER_SESSION = 1;

// The working tree an `ai1 verify --cwd <dir>` of the command line verifies, or null.
export function foreignVerifyTree(commandLine, workingDirectory) {
  for (const { words } of splitSimpleCommands(String(commandLine || ''))) {
    if (baseName(words[0]) !== 'ai1' || words[1] !== 'verify') continue;
    const directoryIndex = words.indexOf('--cwd');
    if (directoryIndex > 0 && words[directoryIndex + 1]) return findWorkingTreeTop(resolve(workingDirectory, words[directoryIndex + 1]));
  }
  return null;
}

// Updates `scanState.lastRuns[tree] = { endMilliseconds, passed }`; false without a transcript.
export function scanForeignVerifyRuns(transcriptPath, scanState, defaultDirectory) {
  const newTranscript = readNewTranscriptEvents(transcriptPath, scanState, [TOOL_USE_MARKER, TOOL_RESULT_MARKER]);
  if (!newTranscript) return false;
  if (newTranscript.restarted) scanState.pendingRuns = {};
  scanState.pendingRuns ||= {};
  scanState.lastRuns ||= {};
  for (const transcriptEvent of newTranscript.events) {
    for (const toolUse of eventContentBlocks(transcriptEvent, 'tool_use')) {
      if (toolUse.name !== 'Bash') continue;
      const verifiedTree = foreignVerifyTree(toolUse.input?.command, transcriptEvent.cwd || defaultDirectory);
      if (verifiedTree) scanState.pendingRuns[toolUse.id] = verifiedTree;
    }
    for (const toolResult of eventContentBlocks(transcriptEvent, 'tool_result')) {
      const verifiedTree = scanState.pendingRuns[toolResult.tool_use_id];
      if (!verifiedTree) continue;
      delete scanState.pendingRuns[toolResult.tool_use_id];
      scanState.lastRuns[verifiedTree] = { endMilliseconds: Date.parse(transcriptEvent.timestamp) || Date.now(), passed: !didRunFail(toolResult) };
    }
  }
  return true;
}

// The changed files that still exist, each with its working tree, whether it is a bundle file and its time.
function describeChangedFiles(hotEditedFiles) {
  return [...new Set(Object.values(hotEditedFiles).flat())].flatMap((editedPath) => {
    const location = existsSync(editedPath) ? locateInWorkingTree(editedPath) : null;
    if (!location) return [];
    const isBundleFile = location.relativePath.startsWith(`${KNOWLEDGE_BUNDLE_PATH}/`);
    return [{ path: editedPath, workingTree: location.workingTree, isBundleFile, modifiedMilliseconds: statSync(editedPath).mtimeMs }];
  });
}

function checkVerify(changedCodeFiles, { hookInput, projectRoot, stateDirectory }) {
  const lastEditPerTree = new Map();
  for (const changedFile of changedCodeFiles) lastEditPerTree.set(changedFile.workingTree, Math.max(lastEditPerTree.get(changedFile.workingTree) || 0, changedFile.modifiedMilliseconds));
  if (lastEditPerTree.size === 0) return null;
  const scanStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'foreign-verify-scan');
  const scanState = readStateJson(scanStatePath);
  if (!scanForeignVerifyRuns(hookInput.transcript_path, scanState, hookInput.cwd || projectRoot)) return null;
  writeStateText(scanStatePath, JSON.stringify(scanState));
  const unverifiedTrees = [...lastEditPerTree].filter(([workingTree, lastEditMilliseconds]) => {
    const lastRun = scanState.lastRuns[workingTree];
    return !lastRun || !lastRun.passed || lastRun.endMilliseconds < lastEditMilliseconds;
  });
  if (unverifiedTrees.length === 0) return null;
  const situation = shortHash(unverifiedTrees.map(([workingTree, lastEditMilliseconds]) => `${workingTree}@${lastEditMilliseconds}`).join('\n'));
  const blocksPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'foreign-verify-blocks');
  const blockedSituations = readStateJson(blocksPath, {});
  if (blockedSituations[situation]) return null;
  writeStateText(blocksPath, JSON.stringify({ ...blockedSituations, [situation]: true }));
  const verifyCommands = unverifiedTrees.map(([workingTree]) => `\`ai1 verify --cwd ${workingTree}\``).join(', ');
  return blockDecision(MODULE_ID, `You changed files of another repository from here after its last passing verify. Run ${verifyCommands} and report the result before finishing; if it fails, fix it there or tell the person plainly; if it cannot run, say so.`);
}

function checkBundleValidity(changedFiles, { hookInput, projectRoot, stateDirectory }) {
  const bundleDirectories = [...new Set(changedFiles.filter((changedFile) => changedFile.isBundleFile).map((changedFile) => join(changedFile.workingTree, KNOWLEDGE_BUNDLE_PATH)))];
  for (const bundleDirectory of bundleDirectories) {
    const validation = runBundleValidator(bundleDirectory);
    if (!validation.ran || !validation.errors.length) continue;
    const validatedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, `foreign-okf-validated-${shortHash(bundleDirectory)}`);
    if (!claimStopBlock(validatedPath, validation.errors.join('\n'), MAX_VALIDATION_BLOCKS_PER_SESSION)) continue;
    return blockDecision(MODULE_ID, buildValidationReminder(bundleDirectory, validation.errors));
  }
  return null;
}

function checkPendingConcepts(changedFiles, { hookInput, projectRoot, stateDirectory, environment }) {
  const changedPaths = new Set(changedFiles.map((changedFile) => changedFile.path));
  const pendingLines = changedFiles.filter((changedFile) => !changedFile.isBundleFile).flatMap((changedFile) => findTargetConcepts(changedFile.path, environment)
    .filter((targetConcept) => !changedPaths.has(targetConcept.absolutePath))
    .map((targetConcept) => `  - \`${changedFile.path}\` -> \`${targetConcept.absolutePath}\` (${targetConcept.title})`));
  if (!pendingLines.length) return null;
  const pendingPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'foreign-okf-pending');
  if (!claimStopBlock(pendingPath, pendingLines.join('\n'), MAX_PENDING_CONCEPT_BLOCKS_PER_SESSION)) return null;
  return blockDecision(MODULE_ID, [
    'OKF: you changed files of another repository that concepts of its knowledge bundle describe, and did not change those concepts:',
    ...pendingLines,
    'Update each one the change affects (body and `generated`, as that repository\'s rules ask), or say in one line why it does not.',
  ].join('\n'));
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'delegate',
  decidedByTarget: true,
  description: 'For files changed in another repository from this session: asks to run `ai1 verify --cwd` there, to fix its OKF bundle if it no longer validates, and to update the concepts of it that describe them.',
  run({ hookInput, projectRoot, environment }) {
    const changedFiles = describeChangedFiles(readHotEditedFiles(hookInput.session_id, environment));
    if (changedFiles.length === 0) return allowDecision();
    const checkContext = { hookInput, projectRoot, environment, stateDirectory: resolveStateDirectory(environment) };
    return checkVerify(changedFiles.filter((changedFile) => !changedFile.isBundleFile), checkContext)
      || checkBundleValidity(changedFiles, checkContext)
      || checkPendingConcepts(changedFiles, checkContext)
      || allowDecision();
  },
};
