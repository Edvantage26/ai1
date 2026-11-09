// okf-file-context (PostToolUse Read/Edit/Write/MultiEdit, feature `okf`): when the agent reads or
// edits a file that a bundle concept describes, names that concept right then, so the knowledge
// reaches the agent when it starts on the code, whatever words the person used, and it knows which
// concept to update afterwards. The map comes from okf-file-map (resource, sources, body paths).
// Feedback only: one line per concept, a read pointer once and an update reminder once per agent
// and session; a concept the agent already opened gets no read pointer.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText } from '../core/session-state.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { resolveBundleDirectory } from './okf-bundle.mjs';
import { loadFileMap, findConceptsForFile } from './okf-file-map.mjs';

const MODULE_ID = 'okf-file-context';
// Harness files, never described by a concept.
const SKIPPED_PREFIXES = ['.ai1/', '.claude/'];

// A subagent gets its own pointers: its context does not hold what the main agent was told.
function seenStatePath(hookInput, projectRoot, environment) {
  const agentKey = hookInput.agent_id ? `${hookInput.session_id}-${hookInput.agent_id}` : hookInput.session_id;
  return sessionStatePath(resolveStateDirectory(environment), agentKey, projectRoot, 'okf-file-context');
}

function wasEditedInSession(projectRoot, conceptMatch, hookInput, environment) {
  const sessionBase = readSessionBase(hookInput, projectRoot, environment);
  const conceptAbsolutePath = join(projectRoot, conceptMatch.repoPath);
  return Boolean(sessionBase && existsSync(conceptAbsolutePath) && statSync(conceptAbsolutePath).mtimeMs >= sessionBase.sessionStartMilliseconds);
}

export function buildFileContextLine(relativePath, conceptMatch, { isEdit, wasPointedBefore }) {
  const conceptReference = `\`${conceptMatch.repoPath}\` (${conceptMatch.title})`;
  if (!isEdit) return `ai1/okf: \`${relativePath}\` is described by ${conceptReference}. Read it before changing this code; if your change affects it, update it.`;
  return `ai1/okf: you changed \`${relativePath}\`, described by ${conceptReference}. ${wasPointedBefore ? 'Update it' : 'Read it and update it'} if the change affects what it says.`;
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'],
  feature: 'okf',
  description: 'Names the bundle concept that describes each file the agent reads or edits, once per concept, so it reads it first and knows what to update.',
  run({ hookInput, projectRoot, environment }) {
    const relativePath = projectRelativePath(projectRoot, hookInput.tool_input?.file_path, hookInput.cwd || projectRoot)?.split('\\').join('/');
    if (!relativePath) return allowDecision();
    const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (!existsSync(join(bundleDirectory, 'index.md'))) return allowDecision();

    const statePath = seenStatePath(hookInput, projectRoot, environment);
    const seenKeys = new Set((readStateText(statePath) || '').split('\n').filter(Boolean));
    const isEdit = hookInput.tool_name !== 'Read';

    // Opening or editing a concept through the tools means the agent has it: no read pointer later.
    if (relativePath.startsWith(`${bundleRelativePath}/`)) {
      const conceptKey = `read:${relativePath.slice(bundleRelativePath.length + 1)}`;
      if (!seenKeys.has(conceptKey)) writeStateText(statePath, [...seenKeys, conceptKey].join('\n'));
      return allowDecision();
    }
    if (SKIPPED_PREFIXES.some((skippedPrefix) => relativePath.startsWith(skippedPrefix))) return allowDecision();

    const conceptMatches = findConceptsForFile(loadFileMap(bundleDirectory, bundleRelativePath, projectRoot, resolveStateDirectory(environment)), relativePath);
    const contextLines = [];
    const newKeys = [];
    for (const conceptMatch of conceptMatches) {
      const readKey = `read:${conceptMatch.conceptPath}`;
      const editKey = `edit:${conceptMatch.conceptPath}`;
      const wasPointedBefore = seenKeys.has(readKey);
      if (!isEdit) {
        if (wasPointedBefore) continue;
        newKeys.push(readKey);
      } else {
        if (seenKeys.has(editKey) || wasEditedInSession(projectRoot, conceptMatch, hookInput, environment)) continue;
        newKeys.push(editKey, readKey);
      }
      contextLines.push(buildFileContextLine(relativePath, conceptMatch, { isEdit, wasPointedBefore }));
    }
    if (!contextLines.length) return allowDecision();
    writeStateText(statePath, [...new Set([...seenKeys, ...newKeys])].join('\n'));
    return contextDecision(MODULE_ID, contextLines.join('\n'));
  },
};
