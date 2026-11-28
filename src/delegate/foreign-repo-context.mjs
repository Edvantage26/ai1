// foreign-repo-context (PostToolUse Read/Edit/Write/MultiEdit, feature `delegate`): a file of another
// repository with ai1 that keeps an OKF bundle gets the concept of that repository that describes it,
// like okf-file-context does for the launch repo: a read pointer once per concept and session, and on an
// edit (a hot edit, or a repo the person allowed here) a reminder to update it, once per concept.
// The edited repository decides (`decidedByTarget`): it runs where the launch folder has no ai1 or okf.

import { resolve } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { readStateText, resolveStateDirectory, sessionStatePath, writeStateText } from '../core/session-state.mjs';
import { findTargetConcepts } from './target-knowledge.mjs';

const MODULE_ID = 'foreign-repo-context';

export function buildForeignConceptLine(filePath, targetConcept, isEdit) {
  const conceptReference = `\`${targetConcept.absolutePath}\` (${targetConcept.title})`;
  if (!isEdit) return `ai1/okf: \`${filePath}\`, of another repository, is described there by ${conceptReference}. Read it before relying on this code.`;
  return `ai1/okf: you changed \`${filePath}\`, of another repository, described there by ${conceptReference}. Update it if the change affects what it says (and its \`generated\`), as that repository's own rules ask.`;
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Read', 'Edit', 'Write', 'MultiEdit'],
  feature: 'delegate',
  decidedByTarget: true,
  description: 'Names the concept of another repository\'s OKF bundle that describes a file of it the agent reads or edits, once per concept.',
  run({ hookInput, projectRoot, environment }) {
    const filePath = hookInput.tool_input?.file_path;
    if (typeof filePath !== 'string' || !filePath) return allowDecision();
    const owningRepository = describeOwningRepository(filePath, projectRoot, hookInput.cwd || projectRoot);
    if (!owningRepository || owningRepository.relation !== 'foreign' || !owningRepository.hasAi1) return allowDecision();
    const targetConcepts = findTargetConcepts(resolve(hookInput.cwd || projectRoot, filePath), environment);
    if (!targetConcepts.length) return allowDecision();
    const isEdit = hookInput.tool_name !== 'Read';
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, MODULE_ID);
    const seenKeys = new Set((readStateText(statePath) || '').split('\n').filter(Boolean));
    const contextLines = [];
    for (const targetConcept of targetConcepts) {
      const conceptKey = `${isEdit ? 'edit' : 'read'}:${targetConcept.absolutePath}`;
      if (seenKeys.has(conceptKey)) continue;
      seenKeys.add(conceptKey);
      if (isEdit) seenKeys.add(`read:${targetConcept.absolutePath}`);
      contextLines.push(buildForeignConceptLine(filePath, targetConcept, isEdit));
    }
    if (!contextLines.length) return allowDecision();
    writeStateText(statePath, [...seenKeys].join('\n'));
    return contextDecision(MODULE_ID, contextLines.join('\n'));
  },
};
