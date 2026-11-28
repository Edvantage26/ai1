// The guards of another repository with ai1, applied from this session to the calls that change it or
// run in it, when that repository is edited from here (the person's "do it here", or a hot edit): its
// own `repo-rules`, `config-guard` and, when this session does not run `danger` already, its `danger`
// with its `ignore_rules`. The repository is read from its main checkout, so a branch cannot loosen its
// own rules. Asks are kept in unattended permission modes (`keptUnattended`), like danger's and
// repo-rules' in the launch repository: they are what keeps the other repository's guards on.

import { resolve } from 'node:path';
import { askDecision, denyDecision } from '../core/hook-io.mjs';
import { getModuleOptions, isModuleEnabled, loadHarnessConfig } from '../core/config.mjs';
import { describeOwningRepository } from '../core/owning-repo.mjs';
import { findMainCheckout } from '../core/project-roots.mjs';
import { baseName, splitSimpleCommands } from '../core/shell-parse.mjs';
import { findRepoRuleMatches } from '../guards/repo-rules.mjs';
import { listHarnessConfigChanges } from '../guards/config-guard.mjs';
import { findDangerousCommands } from '../guards/danger.mjs';

const MODULE_ID = 'foreign-repo';

// The config of a repository as its main checkout has it (null when missing or invalid).
export function loadMainCheckoutConfig(repoRoot) {
  const loadedConfig = loadHarnessConfig(findMainCheckout(repoRoot));
  return loadedConfig.status === 'ok' ? loadedConfig.config : null;
}

// The folders a shell call runs in: its working directory, every `cd <dir>` and `git -C <dir>` of the
// line (a `cd` to `~`, `-` or a variable is unknown and skipped).
export function listCommandDirectories(hookInput, workingDirectory) {
  if (hookInput.tool_name !== 'Bash') return [];
  const commandDirectories = [workingDirectory];
  let currentDirectory = workingDirectory;
  for (const { words } of splitSimpleCommands(String(hookInput.tool_input?.command || ''))) {
    const commandName = baseName(words[0]);
    if (commandName === 'cd') {
      const directoryArgument = words.slice(1).find((commandWord) => !commandWord.startsWith('-'));
      if (directoryArgument && !/^[~$-]/.test(directoryArgument)) {
        currentDirectory = resolve(currentDirectory, directoryArgument);
        commandDirectories.push(currentDirectory);
      }
    } else if (commandName === 'git') {
      const directoryIndex = words.indexOf('-C');
      if (directoryIndex > 0 && words[directoryIndex + 1]) commandDirectories.push(resolve(currentDirectory, words[directoryIndex + 1]));
    }
  }
  return [...new Set(commandDirectories)];
}

function belongsTo(candidatePath, targetMainCheckout, launchRoot, workingDirectory) {
  const owningRepository = describeOwningRepository(candidatePath, launchRoot, workingDirectory);
  return Boolean(owningRepository) && findMainCheckout(owningRepository.repoRoot) === targetMainCheckout;
}

// The decision of the target repository's guards for this call, or null when none of them matches.
// `targetRoot`: the working tree of the target the call touches (its main checkout or a worktree).
export function checkTargetGuards({ hookInput, targetRoot, launchRoot, launchRunsDanger, workingDirectory }) {
  const targetConfig = loadMainCheckoutConfig(targetRoot);
  if (!targetConfig) return null;
  const targetMainCheckout = findMainCheckout(targetRoot);
  const denyReasons = [];
  const askReasons = [];
  const ruleIds = [];
  const repoLabel = `\`${targetMainCheckout}\``;

  if (isModuleEnabled({ id: 'repo-rules', feature: 'danger' }, targetConfig)) {
    for (const matchedRule of findRepoRuleMatches(hookInput, targetRoot, targetConfig.rules)) {
      (matchedRule.action === 'deny' ? denyReasons : askReasons).push(`[${matchedRule.id}] ${matchedRule.message} (a rule of ${repoLabel})`);
      ruleIds.push(matchedRule.id);
    }
  }
  if (isModuleEnabled({ id: 'config-guard', feature: 'danger' }, targetConfig)) {
    const changedConfigPaths = listHarnessConfigChanges(hookInput, workingDirectory)
      .filter((configPath) => belongsTo(configPath, targetMainCheckout, launchRoot, workingDirectory));
    if (changedConfigPaths.length) {
      askReasons.push(`changes ${changedConfigPaths.map((configPath) => `\`${configPath}\``).join(', ')}: the ai1 and Claude Code configuration of ${repoLabel}`);
      ruleIds.push('config-guard');
    }
  }
  if (!launchRunsDanger && hookInput.tool_name === 'Bash' && isModuleEnabled({ id: 'danger', feature: 'danger' }, targetConfig)) {
    const ignoredRuleIds = getModuleOptions('danger', targetConfig).ignore_rules ?? [];
    for (const dangerFinding of findDangerousCommands(String(hookInput.tool_input?.command || ''), ignoredRuleIds, { workingDirectory })) {
      (dangerFinding.action === 'deny' ? denyReasons : askReasons).push(`[${dangerFinding.ruleId}] \`${dangerFinding.command}\`: ${dangerFinding.why}`);
      ruleIds.push(dangerFinding.ruleId);
    }
  }

  if (denyReasons.length) {
    return denyDecision(MODULE_ID, `${denyReasons.join(' ')} Do not reach the same result another way; if it seems wrong, tell the person.`, ruleIds);
  }
  if (askReasons.length) {
    return { ...askDecision(MODULE_ID, `${askReasons.join(' ')} The person confirms.`, ruleIds), keptUnattended: true };
  }
  return null;
}
