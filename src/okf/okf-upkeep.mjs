// okf-upkeep (Stop, feature `okf`): stops the agent from finishing while
//   1. this session left knowledge newer than the last bundle update (repo files changed after the
//      bundle was last touched, or project memories written in the session), asked once per set of
//      pending changes; or
//   2. the bundle was touched in this session and the OKF validator reports ERRORS. The hook runs
//      the validator itself, because asking the agent to validate proved unreliable in field tests.
//      Warnings never block; a missing python3 fails open.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allowDecision, blockDecision } from '../core/hook-io.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import { readNewTranscriptEvents, eventContentBlocks } from '../core/transcript-scan.mjs';
import {
  resolveStateDirectory, sessionStatePath, readStateText, writeStateText, shortHash,
} from '../core/session-state.mjs';
import {
  resolveBundleDirectory, normalizeBundlePath, readBundleIndex, readBundleSpecVersion, newestModificationMilliseconds, buildMaintenanceRules,
} from './okf-bundle.mjs';
import { loadFileMap, findConceptsForFile } from './okf-file-map.mjs';
import { readSessionBase, listFilesChangedSinceBase } from '../core/session-base.mjs';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { isFeatureEnabled } from '../core/features.mjs';
import { RFC_DIRECTORY } from '../rfc/rfc-documents.mjs';
import { DEFAULT_KNOWLEDGE_PATH } from '../core/config.mjs';

const MODULE_ID = 'okf-upkeep';
const BUNDLED_VALIDATOR_SCRIPT = fileURLToPath(new URL('../../skills/okf-validate-bundle/scripts/okf_validate.py', import.meta.url));
const VALIDATOR_TIMEOUT_MILLISECONDS = 10000;
const MAX_VALIDATION_BLOCKS_PER_SESSION = 3;
const MAX_LISTED_ERRORS = 15;
const MAX_LISTED_FILES = 20;
const MAX_LISTED_AFFECTED_CONCEPTS = 5;
// Harness configuration is not project knowledge: editing it never asks for a concept update.
const IGNORED_PATHS = new Set(['.claude/settings.json', '.claude/settings.local.json', '.ai1/config.json']);

// `ignoredDirectories`: folders whose changes are not system knowledge (RFC drafts, when the rfc
// feature is on: rfc-upkeep handles them, and a proposal must not be written into the bundle).
export function listSessionChangedFiles(projectRoot, baseHead, bundleRelativePath, ignoredDirectories = []) {
  const ignoredPrefixes = [bundleRelativePath, ...ignoredDirectories].map((directoryPath) => `${directoryPath.replace(/\/+$/, '')}/`);
  return listFilesChangedSinceBase(projectRoot, baseHead)
    .filter((changedPath) => !ignoredPrefixes.some((ignoredPrefix) => changedPath.startsWith(ignoredPrefix)) && !IGNORED_PATHS.has(changedPath));
}

// Claude Code stores auto-memory under ~/.claude/projects/<path with / and . as ->/memory.
export function memoryDirectoriesFor(directoryPaths, homeDirectory = homedir()) {
  return [...new Set(directoryPaths.filter(Boolean))]
    .map((directoryPath) => join(homeDirectory, '.claude', 'projects', directoryPath.replace(/[/.]/g, '-'), 'memory'));
}

const MEMORY_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const INVESTIGATION_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch']);
const INVESTIGATION_CALLS_BEFORE_REMINDER = 10;

function isInvestigationTool(toolName) {
  return INVESTIGATION_TOOLS.has(toolName) || String(toolName).startsWith('mcp__');
}

// True when a shell word names the bundle or a path inside it (relative or absolute).
function namesBundlePath(shellWord, bundleName) {
  const bundlePath = String(shellWord).replace(/^\.\//, '').replace(/\/+$/, '');
  return bundlePath === bundleName || bundlePath.startsWith(`${bundleName}/`) || bundlePath.includes(`/${bundleName}/`)
    || bundlePath.endsWith(`/${bundleName}`);
}

// Whether a Bash command writes to the bundle: an edit made with the shell (`cat >> .ai1/okf/x.md`,
// `sed -i`, `tee`, `mv`, an inline python/node script naming a bundle file) counts as updating it,
// just like Write/Edit. Reading the bundle (validator, cat, grep) never counts.
export function shellCommandWritesBundle(commandLine, bundleRelativePath = DEFAULT_KNOWLEDGE_PATH) {
  const bundleName = String(bundleRelativePath).replace(/^\.\//, '').replace(/\/+$/, '');
  const commandText = String(commandLine || '');
  if (!commandText.includes(bundleName)) return false;
  const { targetPaths, runsInlineScript } = listShellWriteTargets(commandText);
  if (targetPaths.some((targetPath) => namesBundlePath(targetPath, bundleName))) return true;
  const namesBundleFile = new RegExp(`(^|[\\s'"=/(])${bundleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\S`).test(commandText);
  return runsInlineScript && namesBundleFile;
}

// One incremental pass over the session transcript (see core/transcript-scan.mjs). It collects
//   - `paths`: memory files this session wrote (Write/Edit), and
//   - `investigationCalls`: investigation tool calls (shell, MCP, web) since the session last
//     edited the bundle, reset to 0 by any bundle edit.
// Returns null when the transcript is not available.
export function scanSessionTranscript(transcriptPath, { memoryDirectories, bundleRelativePath }, scanState = { offset: 0, paths: [], investigationCalls: 0 }) {
  const newTranscript = readNewTranscriptEvents(transcriptPath, scanState);
  if (!newTranscript) return null;
  const writtenMemoryPaths = new Set(newTranscript.restarted ? [] : scanState.paths || []);
  let investigationCalls = newTranscript.restarted ? 0 : scanState.investigationCalls || 0;
  const bundleMarker = `/${String(bundleRelativePath || DEFAULT_KNOWLEDGE_PATH).replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  for (const transcriptEvent of newTranscript.events) {
    for (const contentBlock of eventContentBlocks(transcriptEvent, 'tool_use')) {
      const toolPath = contentBlock?.input?.file_path;
      if (MEMORY_WRITING_TOOLS.has(contentBlock.name) && typeof toolPath === 'string') {
        if (memoryDirectories.some((memoryDirectory) => toolPath.startsWith(`${memoryDirectory}/`))) writtenMemoryPaths.add(toolPath);
        if (toolPath.includes(bundleMarker)) investigationCalls = 0;
      } else if (contentBlock.name === 'Bash' && shellCommandWritesBundle(contentBlock?.input?.command, bundleRelativePath)) {
        investigationCalls = 0;
      } else if (isInvestigationTool(contentBlock.name)) {
        investigationCalls += 1;
      }
    }
  }
  scanState.paths = [...writtenMemoryPaths];
  scanState.investigationCalls = investigationCalls;
  return { memoryPaths: writtenMemoryPaths, investigationCalls };
}

// Kept for callers that only need the memory files.
export function listMemoryFilesWrittenBySession(transcriptPath, memoryDirectories, scanState) {
  const transcriptScan = scanSessionTranscript(transcriptPath, { memoryDirectories, bundleRelativePath: DEFAULT_KNOWLEDGE_PATH }, scanState);
  return transcriptScan ? transcriptScan.memoryPaths : null;
}

function loadScanState(scanStatePath) {
  try {
    return { offset: 0, paths: [], investigationCalls: 0, ...JSON.parse(readStateText(scanStatePath) || '{}') };
  } catch {
    return { offset: 0, paths: [], investigationCalls: 0 };
  }
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

function readMemoryOriginSession(memoryFilePath) {
  const { frontmatterText } = splitFrontmatter(readFileSync(memoryFilePath, 'utf8'));
  const originMatch = frontmatterText && /^\s*originSessionId:\s*['"]?([\w-]+)['"]?\s*$/m.exec(frontmatterText);
  return originMatch ? originMatch[1] : null;
}

// Only memories this session wrote count: other sessions open on the same repo write to the same
// memory folder, and their knowledge is theirs to move to the bundle. The transcript says which
// files this session wrote; without it, the frontmatter's originSessionId decides.
function listRecentMemories(memoryDirectories, sessionStartMilliseconds, bundleUpdatedMilliseconds, sessionId, sessionWrittenMemoryPaths) {
  const recentMemories = [];
  for (const memoryDirectory of memoryDirectories) {
    if (!existsSync(memoryDirectory)) continue;
    for (const memoryFileName of readdirSync(memoryDirectory)) {
      if (!memoryFileName.endsWith('.md') || memoryFileName === 'MEMORY.md') continue;
      const memoryFilePath = join(memoryDirectory, memoryFileName);
      const isWrittenBySession = sessionWrittenMemoryPaths
        ? sessionWrittenMemoryPaths.has(memoryFilePath)
        : readMemoryOriginSession(memoryFilePath) === sessionId;
      if (!isWrittenBySession) continue;
      const memoryMilliseconds = statSync(memoryFilePath).mtimeMs;
      if (memoryMilliseconds >= sessionStartMilliseconds && memoryMilliseconds > bundleUpdatedMilliseconds) {
        recentMemories.push({ name: memoryFileName, modifiedMilliseconds: memoryMilliseconds });
      }
    }
  }
  return recentMemories;
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
function listAffectedConcepts({ config, projectRoot, bundleDirectory, stateDirectory, sessionStartMilliseconds }, pendingFiles) {
  try {
    const fileMap = loadFileMap(bundleDirectory, normalizeBundlePath(config), projectRoot, stateDirectory);
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

// Runs the bundled OKF validator. Returns { ran: true, errors } or { ran: false, reason }.
// AI1_PYTHON / AI1_OKF_VALIDATOR override the interpreter and the script (used by tests).
export function runBundleValidator(bundleDirectory, environment = process.env) {
  const pythonCommand = environment.AI1_PYTHON || 'python3';
  const validatorScript = environment.AI1_OKF_VALIDATOR || BUNDLED_VALIDATOR_SCRIPT;
  let validatorOutput;
  try {
    validatorOutput = execFileSync(pythonCommand, [validatorScript, bundleDirectory, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: VALIDATOR_TIMEOUT_MILLISECONDS,
    });
  } catch (validatorFailure) {
    // The validator exits non-zero when the bundle has errors; its JSON is still on stdout.
    validatorOutput = validatorFailure.stdout;
    if (!validatorOutput) return { ran: false, reason: validatorFailure.code === 'ENOENT' ? `${pythonCommand} not found` : String(validatorFailure.message).split('\n')[0] };
  }
  try {
    const validationReport = JSON.parse(validatorOutput);
    return { ran: true, errors: Array.isArray(validationReport.errors) ? validationReport.errors : [] };
  } catch {
    return { ran: false, reason: 'validator output is not JSON' };
  }
}

export function buildValidationReminder(bundleRelativePath, validationErrors) {
  return [
    `OKF: the bundle at ${bundleRelativePath}/ was changed in this session and the validator reports ${validationErrors.length} ERROR(s) (warnings are not shown and do not block):`,
    ...validationErrors.slice(0, MAX_LISTED_ERRORS).map((validationError) => `  - ${validationError}`),
    ...(validationErrors.length > MAX_LISTED_ERRORS ? [`  - ... and ${validationErrors.length - MAX_LISTED_ERRORS} more (run /ai1:okf-validate-bundle ${bundleRelativePath})`] : []),
    'Fix every error, then finish.',
  ].join('\n');
}

function checkBundleValidity({ hookInput, projectRoot, stateDirectory, bundleDirectory, bundleRelativePath, environment }) {
  const validation = runBundleValidator(bundleDirectory, environment);
  if (!validation.ran) {
    process.stderr.write(`ai1: okf-upkeep could not validate ${bundleRelativePath}: ${validation.reason}\n`);
    return allowDecision();
  }
  if (!validation.errors.length) return allowDecision();
  // Never loop: the same errors are reported once, and at most a few times per session overall.
  const validatedPath = sessionStatePath(stateDirectory, hookInput.session_id, projectRoot, 'validated');
  const [previousFingerprint, previousCountText] = (readStateText(validatedPath) || '').split(':');
  const previousCount = Number(previousCountText) || 0;
  const errorsFingerprint = shortHash(validation.errors.join('\n'));
  if (errorsFingerprint === previousFingerprint || previousCount >= MAX_VALIDATION_BLOCKS_PER_SESSION) return allowDecision();
  writeStateText(validatedPath, `${errorsFingerprint}:${previousCount + 1}`);
  return blockDecision(MODULE_ID, buildValidationReminder(bundleRelativePath, validation.errors));
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'okf',
  description: 'Asks to update the OKF bundle after file changes, new memories or a long run of investigation, and validates the bundle when the session changed it.',
  run({ hookInput, config, projectRoot, environment, homeDirectory }) {
    const bundleRelativePath = config.knowledge || DEFAULT_KNOWLEDGE_PATH;
    const bundleDirectory = resolveBundleDirectory(projectRoot, config);
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

    const pendingFiles = listSessionChangedFiles(projectRoot, baseHead, bundleRelativePath, isFeatureEnabled('rfc', config) ? [RFC_DIRECTORY] : [])
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
    const affectedConceptPaths = listAffectedConcepts({ config, projectRoot, bundleDirectory, stateDirectory, sessionStartMilliseconds }, pendingFilesToRemind);
    return blockDecision(MODULE_ID, buildUpkeepReminder(bundleRelativePath, specVersion, pendingFilesToRemind, pendingMemories, affectedConceptPaths));
  },
};
