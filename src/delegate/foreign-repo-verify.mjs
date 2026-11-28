// foreign-repo-verify (Stop, feature `delegate`): the agent cannot finish while a file it hot-edited in
// another repository (foreign-repo, `hot_max_files`) is newer than the last passing
// `ai1 verify --cwd <that working tree>`. Asked once per situation, then it lets the agent stop (fail
// open). Like foreign-repo, the edited repository decides (`decidedByTarget`): it runs where the launch
// folder has no ai1 or has `verify` off. Runs are read from the transcript; edits by file time.

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { findWorkingTreeTop } from '../core/project-roots.mjs';
import { readStateJson, resolveStateDirectory, sessionStatePath, shortHash, writeStateText } from '../core/session-state.mjs';
import { baseName, splitSimpleCommands } from '../core/shell-parse.mjs';
import { readNewTranscriptEvents, eventContentBlocks, TOOL_USE_MARKER, TOOL_RESULT_MARKER } from '../core/transcript-scan.mjs';
import { didRunFail } from '../verify/verify-gate.mjs';
import { readHotEditedFiles } from './delegate-state.mjs';

const MODULE_ID = 'foreign-repo-verify';

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

// Latest modification time of the hot-edited files, per working tree.
function readLastEditPerTree(hotEditedFiles) {
  const lastEditPerTree = new Map();
  for (const editedPath of Object.values(hotEditedFiles).flat()) {
    if (!existsSync(editedPath)) continue;
    const workingTree = findWorkingTreeTop(dirname(editedPath));
    if (!workingTree) continue;
    lastEditPerTree.set(workingTree, Math.max(lastEditPerTree.get(workingTree) || 0, statSync(editedPath).mtimeMs));
  }
  return lastEditPerTree;
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'delegate',
  decidedByTarget: true,
  description: 'Does not let the agent finish while files it hot-edited in another repository changed after the last passing `ai1 verify --cwd` there.',
  run({ hookInput, projectRoot, environment }) {
    const hotEditedFiles = readHotEditedFiles(hookInput.session_id, environment);
    const lastEditPerTree = readLastEditPerTree(hotEditedFiles);
    if (lastEditPerTree.size === 0) return allowDecision();
    const stateDirectory = resolveStateDirectory(environment);
    const scanStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'foreign-verify-scan');
    const scanState = readStateJson(scanStatePath);
    if (!scanForeignVerifyRuns(hookInput.transcript_path, scanState, hookInput.cwd || projectRoot)) return allowDecision();
    writeStateText(scanStatePath, JSON.stringify(scanState));
    const unverifiedTrees = [...lastEditPerTree].filter(([workingTree, lastEditMilliseconds]) => {
      const lastRun = scanState.lastRuns[workingTree];
      return !lastRun || !lastRun.passed || lastRun.endMilliseconds < lastEditMilliseconds;
    });
    if (unverifiedTrees.length === 0) return allowDecision();
    const situation = shortHash(unverifiedTrees.map(([workingTree, lastEditMilliseconds]) => `${workingTree}@${lastEditMilliseconds}`).join('\n'));
    const blocksPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'foreign-verify-blocks');
    const blockedSituations = readStateJson(blocksPath, {});
    if (blockedSituations[situation]) return allowDecision();
    writeStateText(blocksPath, JSON.stringify({ ...blockedSituations, [situation]: true }));
    const verifyCommands = unverifiedTrees.map(([workingTree]) => `\`ai1 verify --cwd ${workingTree}\``).join(', ');
    return blockDecision(MODULE_ID, `You changed files of another repository from here (hot edits) after its last passing verify. Run ${verifyCommands} and report the result before finishing; if it fails, fix it there or tell the person plainly; if it cannot run, say so.`);
  },
};
