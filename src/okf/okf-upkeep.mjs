// okf-upkeep (Stop, feature `okf`): stops the agent from finishing while
//   1. this session left knowledge newer than the last bundle update (repo files changed after the
//      bundle was last touched, or project memories written in the session), asked once per set of
//      pending changes; or
//   2. the bundle was touched in this session and the OKF validator reports ERRORS. The hook runs
//      the validator itself, because asking the agent to validate proved unreliable in field tests.
//      Warnings never block; without Python it fails open and tells the person once per session.
//   3. once the bundle validates, this session changed concepts without a look at the overview
//      (overview.md or the root index.md), or changed concepts no index.md links to; asked once per
//      set of findings, never right after another hook stop.
//   4. no file or memory reminder is due but this session edited files and undid the change (an
//      attempt tried and dropped leaves no diff): asks to record why it was dropped, once per set.

import { existsSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { allowDecision, blockDecision, noticeDecision } from '../core/hook-io.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText, shortHash, claimStopBlock } from '../core/session-state.mjs';
import {
  resolveBundleDirectory, readBundleIndex, readBundleSpecVersion, newestModificationMilliseconds, buildMaintenanceRules,
  isConceptPath, listConceptsMissingFromIndex, overviewFileName,
} from './okf-bundle.mjs';
import { loadFileMap, findConceptsForFile } from './okf-file-map.mjs';
import { memoryDirectoriesFor, scanSessionTranscript, loadScanState, listRecentMemories } from './okf-session-scan.mjs';
import { runBundleValidator, buildValidationReminder } from './okf-validator.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { tryGit } from '../core/git.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { PROPOSALS_DIRECTORY } from '../proposals/proposals-documents.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { integratedFileMatcher } from '../worktrees/worktree-integrations.mjs';

const MODULE_ID = 'okf-upkeep';
const MAX_VALIDATION_BLOCKS_PER_SESSION = 3;
const MAX_STRUCTURE_BLOCKS_PER_SESSION = 3;
const MAX_DISCARDED_BLOCKS_PER_SESSION = 3;
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

// Files this session edited (Write/Edit, from the transcript) that show no change against the base
// HEAD now: something tried and undone. Files outside the repo, under `.ai1/` or `.claude/`, and
// files git ignores (their changes never show in a diff) are left out.
export function listDiscardedEdits(projectRoot, baseHead, editedFilePaths) {
  const changedPaths = new Set(listFilesChangedSinceBase(projectRoot, baseHead));
  const candidatePaths = [...editedFilePaths]
    .map((editedPath) => relative(projectRoot, editedPath))
    .filter((repoPath) => repoPath && !repoPath.startsWith('..') && !isAbsolute(repoPath)
      && !repoPath.startsWith('.ai1/') && !repoPath.startsWith('.claude/') && !changedPaths.has(repoPath));
  if (!candidatePaths.length) return [];
  const ignoredPaths = new Set((tryGit(projectRoot, ['check-ignore', '--', ...candidatePaths]) || '').split('\n'));
  return candidatePaths.filter((repoPath) => !ignoredPaths.has(repoPath)).sort();
}

export function buildDiscardedAttemptReminder(bundleRelativePath, discardedPaths, affectedConceptPaths = []) {
  const reminderLines = ['OKF: this session edited these files and then undid the change (no diff is left):'];
  reminderLines.push(...discardedPaths.slice(0, MAX_LISTED_FILES).map((discardedPath) => `  - ${discardedPath}`));
  if (affectedConceptPaths.length) {
    reminderLines.push(`Concepts that describe those files: ${affectedConceptPaths.slice(0, MAX_LISTED_AFFECTED_CONCEPTS).map((conceptPath) => `\`${conceptPath}\``).join(', ')}.`);
  }
  reminderLines.push(
    `If it was an approach tried and dropped, record in the matching concept of \`${bundleRelativePath}/\` what was tried and why it was dropped (what failed, what it would break), so nobody tries it again blind.`,
    'If it was an accidental or trivial edit, say so in one line and finish; you will not be asked again for these same files.',
  );
  return reminderLines.join('\n');
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

export function buildStructureReminder(bundleRelativePath, overviewPath, conceptsWithoutOverviewReview, conceptsMissingFromIndex) {
  const reminderLines = ['OKF: this session changed concepts of the bundle; check that the bundle still reads as a whole.'];
  if (conceptsWithoutOverviewReview.length) {
    const rootIndexPath = `${bundleRelativePath}/index.md`;
    const overviewPages = overviewPath === rootIndexPath ? `\`${rootIndexPath}\`` : `\`${overviewPath}\` nor \`${rootIndexPath}\``;
    reminderLines.push('', `Concepts changed without touching ${overviewPages}:`);
    reminderLines.push(...conceptsWithoutOverviewReview.slice(0, MAX_LISTED_FILES).map((conceptPath) => `  - ${bundleRelativePath}/${conceptPath}`));
    reminderLines.push('Check that the overview (what the project is, its scope, the map of its pieces) and the description in the root index.md still hold. If not, update them; if they do, say so in one line.');
  }
  if (conceptsMissingFromIndex.length) {
    reminderLines.push('', 'Concepts no index.md links to (add each one to the index.md of its folder with a one-line description):');
    reminderLines.push(...conceptsMissingFromIndex.map((conceptPath) => `  - ${bundleRelativePath}/${conceptPath}`));
  }
  return reminderLines.join('\n');
}

// After a clean validation: concepts this session changed (or deleted) without a look at the
// overview, and concepts it changed that no index.md links to. Asked once per set of findings.
function checkBundleStructure({ hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, baseHead, sessionStartMilliseconds }) {
  const bundlePrefix = `${bundleRelativePath}/`;
  const bundleFilesChangedInSession = listFilesChangedSinceBase(projectRoot, baseHead)
    .filter((changedPath) => changedPath.startsWith(bundlePrefix))
    .map((changedPath) => changedPath.slice(bundlePrefix.length))
    .filter((bundleFilePath) => {
      const absolutePath = join(bundleDirectory, bundleFilePath);
      return !existsSync(absolutePath) || statSync(absolutePath).mtimeMs >= sessionStartMilliseconds;
    });
  const conceptsChangedInSession = bundleFilesChangedInSession.filter(isConceptPath).sort();
  if (!conceptsChangedInSession.length) return allowDecision();
  const overviewReviewed = bundleFilesChangedInSession.some((bundleFilePath) => ['overview.md', 'index.md'].includes(bundleFilePath));
  const conceptsWithoutOverviewReview = overviewReviewed ? [] : conceptsChangedInSession;
  const conceptsMissingFromIndex = listConceptsMissingFromIndex(bundleDirectory)
    .filter((conceptPath) => conceptsChangedInSession.includes(conceptPath));
  if (!conceptsWithoutOverviewReview.length && !conceptsMissingFromIndex.length) return allowDecision();
  const structurePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'structure');
  const findingsText = [...conceptsWithoutOverviewReview, '--', ...conceptsMissingFromIndex].join('\n');
  if (!claimStopBlock(structurePath, findingsText, MAX_STRUCTURE_BLOCKS_PER_SESSION)) return allowDecision();
  const overviewPath = `${bundleRelativePath}/${overviewFileName(bundleDirectory)}`;
  return blockDecision(MODULE_ID, buildStructureReminder(bundleRelativePath, overviewPath, conceptsWithoutOverviewReview, conceptsMissingFromIndex));
}

// `checkStructure`: once the bundle validates (or cannot be validated), go on with checkBundleStructure.
function checkBundleValidity(validityContext, { checkStructure = false } = {}) {
  const { hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, environment } = validityContext;
  const continueAfterValidation = () => (checkStructure ? checkBundleStructure(validityContext) : allowDecision());
  const validation = runBundleValidator(bundleDirectory, environment);
  if (!validation.ran) {
    process.stderr.write(`ai1: okf-upkeep could not validate ${bundleRelativePath}: ${validation.reason}\n`);
    const noticedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'validator-missing');
    if (readStateText(noticedPath) !== null) return continueAfterValidation();
    writeStateText(noticedPath, validation.reason);
    return noticeDecision(MODULE_ID, `the OKF bundle was not validated: ${validation.reason}. Install Python 3.9+ to turn the check on.`);
  }
  if (!validation.errors.length) return continueAfterValidation();
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
    const validityContext = {
      hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, environment, baseHead, sessionStartMilliseconds,
    };
    const bundleChangedInSession = bundleUpdatedMilliseconds >= sessionStartMilliseconds;

    // Already stopped once by a hook: no new upkeep reminder (loop guard), but the bundle the agent
    // just edited is still validated.
    if (hookInput.stop_hook_active) return bundleChangedInSession ? checkBundleValidity(validityContext) : allowDecision();

    const memoryDirectories = memoryDirectoriesFor([hookInput.cwd, projectRoot], homeDirectory);
    const scanStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'memory-scan');
    const scanState = loadScanState(scanStatePath);
    const transcriptScan = scanSessionTranscript(hookInput.transcript_path, { memoryDirectories, bundleRelativePath, verifyCommands: config.verify || [] }, scanState);
    if (transcriptScan) writeStateText(scanStatePath, JSON.stringify(scanState));

    // Only files changed after the session started, and only when the transcript shows the session
    // may have written: uncommitted changes from before it, or another session's in the same folder,
    // are not this session's knowledge. Without a transcript the dates alone decide.
    const sessionMayHaveWritten = !transcriptScan || transcriptScan.sessionMayHaveWritten;
    const isKnowledgeCheckedIntegration = integratedFileMatcher(projectRoot, 'knowledge_checked');
    const pendingFiles = (sessionMayHaveWritten ? listSessionChangedFiles(projectRoot, baseHead, bundleRelativePath, isFeatureEnabled('proposals', config) ? [PROPOSALS_DIRECTORY] : []) : [])
      .map((changedPath) => {
        const absolutePath = join(projectRoot, changedPath);
        // A deleted file has no mtime: it is pending, with a fixed signature so it is asked only once.
        if (!existsSync(absolutePath)) return { path: changedPath, isDeleted: true, signature: `${changedPath}:deleted` };
        const modifiedMilliseconds = statSync(absolutePath).mtimeMs;
        return { path: changedPath, isDeleted: false, modifiedMilliseconds, signature: `${changedPath}:${Math.floor(modifiedMilliseconds)}` };
      })
      .filter((pendingFile) => pendingFile.isDeleted
        || (pendingFile.modifiedMilliseconds >= sessionStartMilliseconds && pendingFile.modifiedMilliseconds > bundleUpdatedMilliseconds))
      // Brought in by `ai1 worktree finish` after its OKF checks, and untouched since.
      .filter((pendingFile) => !isKnowledgeCheckedIntegration(pendingFile.path, pendingFile.isDeleted ? null : pendingFile.modifiedMilliseconds));
    // A deletion has no date to compare with the bundle, so it would stay pending forever and ride
    // along every later reminder: it is mentioned once per session and then dropped.
    const deletionsRemindedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'deletions');
    const deletionsAlreadyReminded = new Set((readStateText(deletionsRemindedPath) || '').split('\n').filter(Boolean));
    const pendingFilesToRemind = pendingFiles.filter((pendingFile) => !(pendingFile.isDeleted && deletionsAlreadyReminded.has(pendingFile.path)));
    const pendingMemories = listRecentMemories(
      memoryDirectories,
      sessionStartMilliseconds,
      bundleUpdatedMilliseconds,
      hookInput.session_id,
      transcriptScan ? transcriptScan.memoryPaths : null,
    );

    // No file or memory reminder due: knowledge found by investigating (queries, commands) leaves no
    // file behind, so a long run of investigation without touching the bundle asks for it too.
    // An attempt undone before the stop leaves no diff, so the file reminder misses it.
    const finishWithoutUpkeepReminder = () => {
      const discardedPaths = transcriptScan ? listDiscardedEdits(projectRoot, baseHead, transcriptScan.editedFilePaths) : [];
      const discardedStatePath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'discarded');
      if (discardedPaths.length && claimStopBlock(discardedStatePath, discardedPaths.join('\n'), MAX_DISCARDED_BLOCKS_PER_SESSION)) {
        scanState.investigationCalls = 0;
        writeStateText(scanStatePath, JSON.stringify(scanState));
        const affectedConceptPaths = listAffectedConcepts(
          { projectRoot, bundleDirectory, stateDirectory, sessionStartMilliseconds },
          discardedPaths.map((discardedPath) => ({ path: discardedPath })),
        );
        return blockDecision(MODULE_ID, buildDiscardedAttemptReminder(bundleRelativePath, discardedPaths, affectedConceptPaths));
      }
      if (transcriptScan && transcriptScan.investigationCalls >= INVESTIGATION_CALLS_BEFORE_REMINDER) {
        scanState.investigationCalls = 0;
        writeStateText(scanStatePath, JSON.stringify(scanState));
        return blockDecision(MODULE_ID, buildInvestigationReminder(bundleRelativePath, transcriptScan.investigationCalls));
      }
      return bundleChangedInSession ? checkBundleValidity(validityContext, { checkStructure: true }) : allowDecision();
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
