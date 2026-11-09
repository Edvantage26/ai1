// okf-upkeep (Stop, feature `okf`): stops the agent from finishing while
//   1. this session left knowledge newer than the last bundle update (repo files changed after the
//      bundle was last touched, or project memories written in the session), asked once per set of
//      pending changes; or
//   2. the bundle was touched in this session and the OKF validator reports ERRORS. The hook runs
//      the validator itself, because asking the agent to validate proved unreliable in field tests.
//      Warnings never block; a missing python3 fails open.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText, shortHash, claimStopBlock } from '../core/session-state.mjs';
import {
  resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, newestModificationMilliseconds, buildMaintenanceRules,
} from './okf-bundle.mjs';
import { loadFileMap, findConceptsForFile } from './okf-file-map.mjs';
import { memoryDirectoriesFor, scanSessionTranscript, loadScanState, listRecentMemories } from './okf-session-scan.mjs';
import { runBundleValidator, buildValidationReminder } from './okf-validator.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { PROPOSALS_DIRECTORY } from '../proposals/proposals-documents.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

const MODULE_ID = 'okf-upkeep';
const MAX_VALIDATION_BLOCKS_PER_SESSION = 3;
const MAX_LISTED_FILES = 20;
const MAX_LISTED_AFFECTED_CONCEPTS = 5;
// Harness configuration is not project knowledge: editing it never asks for a concept update.
const IGNORED_PATHS = new Set(['.claude/settings.json', '.claude/settings.local.json', '.ai1/config.json']);
const INVESTIGATION_CALLS_BEFORE_REMINDER = 10;

// `ignoredDirectories`: folders whose changes are not system knowledge (proposal drafts, when the proposals
// feature is on: proposals-upkeep handles them, and a proposal must not be written into the bundle).
export function listSessionChangedFiles(projectRoot, baseHead, bundleRelativePath, ignoredDirectories = []) {
  const ignoredPrefixes = [bundleRelativePath, ...ignoredDirectories].map((directoryPath) => `${directoryPath.replace(/\/+$/, '')}/`);
  return listFilesChangedSinceBase(projectRoot, baseHead)
    .filter((changedPath) => !ignoredPrefixes.some((ignoredPrefix) => changedPath.startsWith(ignoredPrefix)) && !IGNORED_PATHS.has(changedPath));
}

export function buildInvestigationReminder(bundleRelativePath, investigationCalls) {
  return [
    `OKF: this session has run ${investigationCalls} investigation steps (queries, commands, MCP calls) without updating ${bundleRelativePath}/.`,
    'Record what will be worth having later, in the matching concept (or a new one):',
    '  - findings: causes, figures, how something really behaves, what was ruled out;',
    '  - ways to validate: how to check that something works or is correct (queries, commands, what to compare);',
    '  - ways of working: procedures, steps or queries that worked and should be repeated.',
    'Keep it short and factual; do not copy raw output. If nothing is worth keeping, say so in one line and finish.',
  ].join('\n');
}

export function buildUpkeepReminder(bundleRelativePath, specVersion, pendingFiles, pendingMemories, affectedConceptPaths = []) {
  const reminderLines = [`OKF: this session left knowledge newer than the last update of ${bundleRelativePath}/.`];
  if (pendingFiles.length) {
    reminderLines.push('', 'Repo files changed after the last bundle update:');
    reminderLines.push(...pendingFiles.slice(0, MAX_LISTED_FILES).map((pendingFile) => `  - ${pendingFile.path}${pendingFile.isDeleted ? ' (deleted)' : ''}`));
    if (pendingFiles.length > MAX_LISTED_FILES) reminderLines.push(`  - ... and ${pendingFiles.length - MAX_LISTED_FILES} more`);
  }
  if (affectedConceptPaths.length) {
    const listedConcepts = affectedConceptPaths.slice(0, MAX_LISTED_AFFECTED_CONCEPTS).map((conceptPath) => `\`${conceptPath}\``).join(', ');
    const hiddenCount = affectedConceptPaths.length - MAX_LISTED_AFFECTED_CONCEPTS;
    reminderLines.push(`Concepts that describe those files (probably affected): ${listedConcepts}${hiddenCount > 0 ? `, and ${hiddenCount} more` : ''}.`);
  }
  if (pendingMemories.length) {
    reminderLines.push('', 'Memories saved in this session and not reflected in the bundle:');
    reminderLines.push(...pendingMemories.map((pendingMemory) => `  - ${pendingMemory.name}`));
    reminderLines.push('If they hold project knowledge (business facts, how an asset works, analysis findings, decisions), move it to the matching concept; working preferences stay in memory.');
  }
  reminderLines.push('', ...buildMaintenanceRules(bundleRelativePath, specVersion));
  reminderLines.push('If nothing documented is affected, say so in one line and finish; you will not be asked again for this same set of changes.');
  return reminderLines.join('\n');
}

// Concepts the file map says describe the pending files (deleted ones too: the map does not depend
// on disk), minus those already edited in this session. A broken map only drops this line.
function listAffectedConcepts({ projectRoot, bundleDirectory, stateDirectory, sessionStartMilliseconds }, pendingFiles) {
  try {
    const fileMap = loadFileMap(bundleDirectory, KNOWLEDGE_BUNDLE_PATH, projectRoot, stateDirectory);
    const affectedConceptPaths = new Set();
    for (const pendingFile of pendingFiles) {
      for (const conceptMatch of findConceptsForFile(fileMap, pendingFile.path)) {
        const conceptAbsolutePath = join(projectRoot, conceptMatch.repoPath);
        const wasEditedInSession = existsSync(conceptAbsolutePath) && statSync(conceptAbsolutePath).mtimeMs >= sessionStartMilliseconds;
        if (!wasEditedInSession) affectedConceptPaths.add(conceptMatch.repoPath);
      }
    }
    return [...affectedConceptPaths];
  } catch {
    return [];
  }
}

function checkBundleValidity({ hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, environment }) {
  const validation = runBundleValidator(bundleDirectory, environment);
  if (!validation.ran) {
    process.stderr.write(`ai1: okf-upkeep could not validate ${bundleRelativePath}: ${validation.reason}\n`);
    return allowDecision();
  }
  if (!validation.errors.length) return allowDecision();
  const validatedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'validated');
  if (!claimStopBlock(validatedPath, validation.errors.join('\n'), MAX_VALIDATION_BLOCKS_PER_SESSION)) return allowDecision();
  return blockDecision(MODULE_ID, buildValidationReminder(bundleRelativePath, validation.errors));
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'okf',
  description: 'Asks to update the OKF bundle after file changes, new memories or a long run of investigation, and validates the bundle when the session changed it.',
  run({ hookInput, config, projectRoot, environment, homeDirectory }) {
    const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    const indexText = readBundleIndex(bundleDirectory);
    if (indexText === null) return allowDecision();

    const stateDirectory = resolveStateDirectory(environment);
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    if (!sessionBase) return allowDecision();
    const { baseHead, sessionStartMilliseconds } = sessionBase;
    const bundleUpdatedMilliseconds = newestModificationMilliseconds(bundleDirectory);
    const validityContext = { hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, environment };
    const bundleChangedInSession = bundleUpdatedMilliseconds >= sessionStartMilliseconds;

    // Already stopped once by a hook: no new upkeep reminder (loop guard), but the bundle the agent
    // just edited is still validated.
    if (hookInput.stop_hook_active) return bundleChangedInSession ? checkBundleValidity(validityContext) : allowDecision();

    const pendingFiles = listSessionChangedFiles(projectRoot, baseHead, bundleRelativePath, isFeatureEnabled('proposals', config) ? [PROPOSALS_DIRECTORY] : [])
      .map((changedPath) => {
        const absolutePath = join(projectRoot, changedPath);
        // A deleted file has no mtime: it is pending, with a fixed signature so it is asked only once.
        if (!existsSync(absolutePath)) return { path: changedPath, isDeleted: true, signature: `${changedPath}:deleted` };
        const modifiedMilliseconds = statSync(absolutePath).mtimeMs;
        return { path: changedPath, isDeleted: false, modifiedMilliseconds, signature: `${changedPath}:${Math.floor(modifiedMilliseconds)}` };
      })
      .filter((pendingFile) => pendingFile.isDeleted || pendingFile.modifiedMilliseconds > bundleUpdatedMilliseconds);
    // A deletion has no date to compare with the bundle, so it would stay pending forever and ride
    // along every later reminder: it is mentioned once per session and then dropped.
    const deletionsRemindedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'deletions');
    const deletionsAlreadyReminded = new Set((readStateText(deletionsRemindedPath) || '').split('\n').filter(Boolean));
    const pendingFilesToRemind = pendingFiles.filter((pendingFile) => !(pendingFile.isDeleted && deletionsAlreadyReminded.has(pendingFile.path)));
    const memoryDirectories = memoryDirectoriesFor([hookInput.cwd, projectRoot], homeDirectory);
    const scanStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'memory-scan');
    const scanState = loadScanState(scanStatePath);
    const transcriptScan = scanSessionTranscript(hookInput.transcript_path, { memoryDirectories, bundleRelativePath }, scanState);
    if (transcriptScan) writeStateText(scanStatePath, JSON.stringify(scanState));
    const pendingMemories = listRecentMemories(
      memoryDirectories,
      sessionStartMilliseconds,
      bundleUpdatedMilliseconds,
      hookInput.session_id,
      transcriptScan ? transcriptScan.memoryPaths : null,
    );

    // No file or memory reminder due: knowledge found by investigating (queries, commands) leaves no
    // file behind, so a long run of investigation without touching the bundle asks for it too.
    const finishWithoutUpkeepReminder = () => {
      if (transcriptScan && transcriptScan.investigationCalls >= INVESTIGATION_CALLS_BEFORE_REMINDER) {
        scanState.investigationCalls = 0;
        writeStateText(scanStatePath, JSON.stringify(scanState));
        return blockDecision(MODULE_ID, buildInvestigationReminder(bundleRelativePath, transcriptScan.investigationCalls));
      }
      return bundleChangedInSession ? checkBundleValidity(validityContext) : allowDecision();
    };
    if (!pendingFilesToRemind.length && !pendingMemories.length) return finishWithoutUpkeepReminder();

    const pendingSignature = [...pendingFilesToRemind.map((pendingFile) => pendingFile.signature),
      ...pendingMemories.map((pendingMemory) => `${pendingMemory.name}:${Math.floor(pendingMemory.modifiedMilliseconds)}`)].sort().join('\n');
    const remindedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'reminded');
    const pendingFingerprint = shortHash(pendingSignature);
    if (readStateText(remindedPath) === pendingFingerprint) return finishWithoutUpkeepReminder();
    writeStateText(remindedPath, pendingFingerprint);
    const newlyRemindedDeletions = pendingFilesToRemind.filter((pendingFile) => pendingFile.isDeleted).map((pendingFile) => pendingFile.path);
    if (newlyRemindedDeletions.length) writeStateText(deletionsRemindedPath, [...deletionsAlreadyReminded, ...newlyRemindedDeletions].join('\n'));

    // The upkeep reminder already asks for the bundle: the investigation count starts over.
    if (transcriptScan) {
      scanState.investigationCalls = 0;
      writeStateText(scanStatePath, JSON.stringify(scanState));
    }
    const specVersion = readBundleSpecVersion(indexText);
    const affectedConceptPaths = listAffectedConcepts({ projectRoot, bundleDirectory, stateDirectory, sessionStartMilliseconds }, pendingFilesToRemind);
    return blockDecision(MODULE_ID, buildUpkeepReminder(bundleRelativePath, specVersion, pendingFilesToRemind, pendingMemories, affectedConceptPaths));
  },
};
