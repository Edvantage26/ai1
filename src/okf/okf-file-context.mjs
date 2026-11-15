// okf-file-context (PostToolUse Read/Edit/Write/MultiEdit, feature `okf`): when the agent reads or
// edits a file that a bundle concept describes, names that concept right then, so the knowledge
// reaches the agent when it starts on the code, whatever words the person used, and it knows which
// concept to update afterwards. The map comes from okf-file-map (resource, sources, body paths).
// Feedback only: one line per concept, a read pointer once and an update reminder once per agent
// and session; a concept the agent already opened gets no read pointer.
// A file of another repository (not a submodule) that keeps its own bundle gets one line per repository
// and session: its bundle, and, when it is not in `related` of .ai1/config.json, the offer to relate it
// (see okf-related.mjs). Decided by structured config, never by text in the index.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { projectRelativePath } from '../core/project-paths.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText } from '../core/session-state.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { resolveBundleDirectory } from './okf-bundle.mjs';
import { loadFileMap, findConceptsForFile } from './okf-file-map.mjs';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { findBundleIndex, findRelatedEntry } from './okf-related.mjs';

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

// The line for a file of another repository with its own bundle, or null (same repo, submodule, no
// bundle, already told this session). Records what it told.
export function describeForeignRead(hookInput, projectRoot, relatedEntries, statePath, seenKeys) {
  const filePath = hookInput.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath) return null;
  const owningRepository = describeOwningRepository(filePath, projectRoot, hookInput.cwd || projectRoot);
  if (!owningRepository || owningRepository.relation !== 'foreign') return null;
  const mainCheckout = findMainCheckout(owningRepository.repoRoot);
  const relatedKey = `related:${mainCheckout}`;
  if (seenKeys.has(relatedKey)) return null;
  const relatedEntry = findRelatedEntry(projectRoot, relatedEntries, mainCheckout);
  const bundleIndex = findBundleIndex(mainCheckout, relatedEntry?.bundle);
  if (!bundleIndex) return null;
  writeStateText(statePath, [...seenKeys, relatedKey].join('\n'));
  if (relatedEntry) {
    const ownsText = relatedEntry.owns?.length ? ` (it owns: ${relatedEntry.owns.join('; ')})` : '';
    return `ai1/okf: \`${filePath}\` belongs to \`${relatedEntry.name}\`, a related repository${ownsText}. Its knowledge is in \`${bundleIndex}\`: read it before changing anything that depends on it.`;
  }
  return [
    `ai1/okf: \`${filePath}\` belongs to another repository, \`${mainCheckout}\`, which keeps its own knowledge in \`${bundleIndex}\`: read it before relying on that code.`,
    'If this repo depends on it, offer the person in one line to add it to `related` in .ai1/config.json, so every session is told where its knowledge is and what it owns (fields in /ai1:okf-maintain-knowledge); add it only after their yes.',
  ].join(' ');
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'],
  feature: 'okf',
  description: 'Names the bundle concept that describes each file the agent reads or edits, once per concept, so it reads it first and knows what to update.',
  run({ hookInput, projectRoot, config, environment }) {
    const statePath = seenStatePath(hookInput, projectRoot, environment);
    const seenKeys = new Set((readStateText(statePath) || '').split('\n').filter(Boolean));
    const foreignLine = describeForeignRead(hookInput, projectRoot, config?.related || [], statePath, seenKeys);
    if (foreignLine) return contextDecision(MODULE_ID, foreignLine);
    const relativePath = projectRelativePath(projectRoot, hookInput.tool_input?.file_path, hookInput.cwd || projectRoot)?.split('\\').join('/');
    if (!relativePath) return allowDecision();
    const bundleRelativePath = KNOWLEDGE_BUNDLE_PATH;
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (!existsSync(join(bundleDirectory, 'index.md'))) return allowDecision();

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
