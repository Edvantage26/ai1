// foreign-repo (PreToolUse, feature `delegate`): an edit to a file of another repository that has ai1
// active is refused, with the way to delegate it to a session started there (/ai1:session-delegate-change,
// `ai1 delegate`), where that repository's own config, hooks, CLAUDE.md and skills apply. The edited
// repository decides with its own `features.delegate` (the launch repository does not override it), so
// the dispatcher runs this module even where the launch directory has no ai1 (`decidedByTarget`).
// A repository without ai1 only gets one line of context per session; submodules of the launch
// repository are part of the project. Reading is never refused. Edits through the shell count as far as
// their command line tells (redirections, sed -i, cp/mv/rm targets); inline scripts are not read.

import { allowDecision, contextDecision, denyDecision } from '../core/hook-io.mjs';
import { isModuleEnabled, loadHarnessConfig } from '../core/config.mjs';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { listToolCallChanges } from '../core/tool-call-paths.mjs';
import { noteRepositoryOnce, readAllowedRepositories, rememberPermissionMode } from './delegate-state.mjs';

const MODULE_ID = 'foreign-repo';
const MODULE_FEATURE = 'delegate';

// The repository's own decision: its config (or its main checkout's) enables this module.
function delegateEnabledIn(repoRoot) {
  for (const candidateRoot of [repoRoot, findMainCheckout(repoRoot)]) {
    const loadedConfig = loadHarnessConfig(candidateRoot);
    if (loadedConfig.status === 'ok') return isModuleEnabled({ id: MODULE_ID, feature: MODULE_FEATURE }, loadedConfig.config);
  }
  return false;
}

function quotePath(pathText) {
  return `\`${pathText}\``;
}

export function describeForeignEdits(hookInput, projectRoot, launchHasAi1, environment) {
  const workingDirectory = hookInput.cwd || projectRoot;
  const { changes } = listToolCallChanges(hookInput, workingDirectory);
  const delegatedRepositories = new Map();
  const plainRepositories = new Map();
  for (const toolCallChange of changes) {
    const owningRepository = describeOwningRepository(toolCallChange.path, projectRoot, workingDirectory);
    if (!owningRepository || owningRepository.relation === 'launch') continue;
    // A submodule is part of the launch project, unless there is no launch project (no ai1 there).
    if (owningRepository.relation === 'submodule' && launchHasAi1) continue;
    const targetMap = owningRepository.hasAi1 && delegateEnabledIn(owningRepository.repoRoot) ? delegatedRepositories : plainRepositories;
    if (!targetMap.has(owningRepository.repoRoot)) targetMap.set(owningRepository.repoRoot, toolCallChange.rawPath);
  }
  const allowedRepositories = readAllowedRepositories(hookInput.session_id, projectRoot, environment);
  for (const allowedRoot of Object.keys(allowedRepositories)) delegatedRepositories.delete(allowedRoot);
  return { delegatedRepositories, plainRepositories };
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'],
  feature: MODULE_FEATURE,
  decidedByTarget: true,
  description: 'Refuses edits to files of another repository with ai1 active and says how to delegate them to a session started there; one line of context for a repository without ai1.',
  run({ hookInput, projectRoot, config, environment }) {
    const { delegatedRepositories, plainRepositories } = describeForeignEdits(hookInput, projectRoot, Boolean(config), environment);
    if (delegatedRepositories.size) {
      rememberPermissionMode(hookInput.session_id, projectRoot, hookInput.permission_mode, environment);
      const [repoRoot, rawPath] = [...delegatedRepositories][0];
      return denyDecision(MODULE_ID, [
        `${quotePath(rawPath)} belongs to another repository, ${quotePath(repoRoot)}, which has ai1 active and its own rules (config, hooks, CLAUDE.md, knowledge).`,
        'Do not edit it from this session, by any other route either: delegate the change to a session started there.',
        `Load /ai1:session-delegate-change: it writes the brief and runs \`ai1 delegate --cwd ${repoRoot} --brief <file>\`. Reading its files is fine.`,
        `Only if the person explicitly says this edit must be made here: \`ai1 delegate allow ${repoRoot} --because "<their words>"\`, then retry.`,
      ].join(' '), [MODULE_ID]);
    }
    const newlyNoted = [...plainRepositories].filter(([repoRoot]) => noteRepositoryOnce(hookInput.session_id, projectRoot, repoRoot, environment));
    if (newlyNoted.length) {
      return contextDecision(MODULE_ID, newlyNoted.map(([repoRoot, rawPath]) => `${quotePath(rawPath)} belongs to another repository, ${quotePath(repoRoot)} (without ai1): read its CLAUDE.md, and its knowledge bundle if it has one, before changing it; its own rules apply.`).join('\n'));
    }
    return allowDecision();
  },
};
