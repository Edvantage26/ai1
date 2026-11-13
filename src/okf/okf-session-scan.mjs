// What a session did, for okf-upkeep: memory files it wrote, its investigation calls since the
// last bundle edit, whether it may have written any file (one incremental pass over the
// transcript), and whether a shell command edited the bundle.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { splitFrontmatter } from '../core/frontmatter.mjs';
import { readStateJson } from '../core/session-state.mjs';
import { claudeProjectFolderName } from '../core/project-paths.mjs';
import { listShellWriteTargets } from '../core/shell-writes.mjs';
import { readNewTranscriptEvents, eventContentBlocks, TOOL_USE_MARKER, TOOL_RESULT_MARKER } from '../core/transcript-scan.mjs';
import { updateWriteWindows } from '../core/session-writes.mjs';

// Claude Code stores auto-memory under ~/.claude/projects/<path with / and . as ->/memory.
export function memoryDirectoriesFor(directoryPaths, homeDirectory = homedir()) {
  return [...new Set(directoryPaths.filter(Boolean))]
    .map((directoryPath) => join(homeDirectory, '.claude', 'projects', claudeProjectFolderName(directoryPath), 'memory'));
}

const MEMORY_WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const INVESTIGATION_TOOLS = new Set(['Bash', 'WebFetch', 'WebSearch']);

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
export function shellCommandWritesBundle(commandLine, bundleRelativePath = KNOWLEDGE_BUNDLE_PATH) {
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
//     edited the bundle, reset to 0 by any bundle edit, and
//   - `editedFilePaths`: other files (not memory, not the bundle) this session edited with
//     Write/Edit since it last edited the bundle, and
//   - `writeWindows`: when a call that may change files was running (core/session-writes; the
//     repo's verify commands count as read-only).
// Returns null when the transcript is not available.
// `sinceMilliseconds`: events stamped before it are skipped - the session base, so a session where ai1
// became active midway (installed or set up while it ran) is not judged on edits committed before.
export function scanSessionTranscript(transcriptPath, { memoryDirectories, bundleRelativePath, verifyCommands = [], projectRoot, sinceMilliseconds = 0 }, scanState = { offset: 0, paths: [], investigationCalls: 0 }) {
  const newTranscript = readNewTranscriptEvents(transcriptPath, scanState, [TOOL_USE_MARKER, TOOL_RESULT_MARKER]);
  if (!newTranscript) return null;
  newTranscript.events = newTranscript.events.filter((transcriptEvent) => !(Date.parse(transcriptEvent?.timestamp) < sinceMilliseconds));
  const writtenMemoryPaths = new Set(newTranscript.restarted ? [] : scanState.paths || []);
  const editedFilePaths = new Set(newTranscript.restarted ? [] : scanState.editedPaths || []);
  let investigationCalls = newTranscript.restarted ? 0 : scanState.investigationCalls || 0;
  updateWriteWindows(scanState, newTranscript.events, { restarted: newTranscript.restarted, verifyCommands, projectRoot });
  const bundleMarker = `/${String(bundleRelativePath || KNOWLEDGE_BUNDLE_PATH).replace(/^\.\//, '').replace(/\/+$/, '')}/`;
  for (const transcriptEvent of newTranscript.events) {
    for (const contentBlock of eventContentBlocks(transcriptEvent, 'tool_use')) {
      const toolPath = contentBlock?.input?.file_path;
      if (MEMORY_WRITING_TOOLS.has(contentBlock.name) && typeof toolPath === 'string') {
        const isMemoryPath = memoryDirectories.some((memoryDirectory) => toolPath.startsWith(`${memoryDirectory}/`));
        if (isMemoryPath) writtenMemoryPaths.add(toolPath);
        if (toolPath.includes(bundleMarker)) {
          investigationCalls = 0;
          editedFilePaths.clear();
        } else if (!isMemoryPath) {
          editedFilePaths.add(toolPath);
        }
      } else if (contentBlock.name === 'Bash' && shellCommandWritesBundle(contentBlock?.input?.command, bundleRelativePath)) {
        investigationCalls = 0;
        editedFilePaths.clear();
      } else if (isInvestigationTool(contentBlock.name)) {
        investigationCalls += 1;
      }
    }
  }
  scanState.paths = [...writtenMemoryPaths];
  scanState.editedPaths = [...editedFilePaths];
  scanState.investigationCalls = investigationCalls;
  return { memoryPaths: writtenMemoryPaths, editedFilePaths, investigationCalls, writeWindows: scanState.writeWindows };
}

// Kept for callers that only need the memory files.
export function listMemoryFilesWrittenBySession(transcriptPath, memoryDirectories, scanState) {
  const transcriptScan = scanSessionTranscript(transcriptPath, { memoryDirectories, bundleRelativePath: KNOWLEDGE_BUNDLE_PATH }, scanState);
  return transcriptScan ? transcriptScan.memoryPaths : null;
}

export function loadScanState(scanStatePath) {
  return { offset: 0, paths: [], investigationCalls: 0, ...readStateJson(scanStatePath) };
}

function readMemoryOriginSession(memoryFilePath) {
  const { frontmatterText } = splitFrontmatter(readFileSync(memoryFilePath, 'utf8'));
  const originMatch = frontmatterText && /^\s*originSessionId:\s*['"]?([\w-]+)['"]?\s*$/m.exec(frontmatterText);
  return originMatch ? originMatch[1] : null;
}

// Only memories this session wrote count: other sessions open on the same repo write to the same
// memory folder, and their knowledge is theirs to move to the bundle. The transcript says which
// files this session wrote; without it, the frontmatter's originSessionId decides.
export function listRecentMemories(memoryDirectories, sessionStartMilliseconds, bundleUpdatedMilliseconds, sessionId, sessionWrittenMemoryPaths) {
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
