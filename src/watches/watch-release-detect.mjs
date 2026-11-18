// watch-release-detect (PostToolUse on Bash, feature `watches`): when the session ran something that looks
// like a release to production, tells the agent once per session to offer following it with a watch
// (/ai1:watches-follow-release). Built-in: `git push` naming the trunk, a tag or --tags; `gh release
// create`; `npm|pnpm|yarn publish`. The repo adds its own deploy commands as regexes in
// `modules.watch-release-detect.deployCommands`. Only a reminder: the watch is made with the person.

import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { getModuleOptions } from '../core/config.mjs';
import { splitSimpleCommands, baseName, hasLongFlag } from '../core/shell-parse.mjs';
import { resolveStateDirectory, sessionStatePath, readStateText, writeStateText } from '../core/session-state.mjs';

const MODULE_ID = 'watch-release-detect';
const TAG_REFERENCE_PATTERN = /^(refs\/tags\/|v?\d+\.\d+(\.\d+)?)/;

function isReleasePush(commandWords, trunkBranch) {
  if (baseName(commandWords[0]) !== 'git') return false;
  const pushIndex = commandWords.indexOf('push');
  if (pushIndex < 0) return false;
  const pushArguments = commandWords.slice(pushIndex + 1);
  if (hasLongFlag(pushArguments, '--tags')) return true;
  return pushArguments.filter((pushArgument) => !pushArgument.startsWith('-')).slice(1).some((pushedReference) => {
    const targetReference = pushedReference.split(':').pop();
    return targetReference === trunkBranch || targetReference === `refs/heads/${trunkBranch}` || TAG_REFERENCE_PATTERN.test(targetReference);
  });
}

function isPublishCommand(commandWords) {
  const commandName = baseName(commandWords[0]);
  if (commandName === 'gh') return commandWords[1] === 'release' && commandWords[2] === 'create';
  if (['npm', 'pnpm'].includes(commandName)) return commandWords[1] === 'publish';
  if (commandName === 'yarn') return commandWords.includes('publish');
  return false;
}

// The command text that looks like a release, or null.
export function findReleaseCommand(commandLine, { trunkBranch = 'main', deployCommandPatterns = [] } = {}) {
  const customPatterns = deployCommandPatterns.flatMap((patternText) => {
    try { return [new RegExp(patternText)]; } catch { return []; }
  });
  for (const simpleCommand of splitSimpleCommands(String(commandLine || ''))) {
    if (isReleasePush(simpleCommand.words, trunkBranch) || isPublishCommand(simpleCommand.words)) return simpleCommand.text;
    if (customPatterns.some((customPattern) => customPattern.test(simpleCommand.text))) return simpleCommand.text;
  }
  return null;
}

export default {
  id: MODULE_ID,
  event: 'PostToolUse',
  toolNames: ['Bash'],
  feature: 'watches',
  description: 'After something that looks like a release to production, reminds the agent once per session to offer following it with a watch.',
  run({ hookInput, config, projectRoot, environment }) {
    const deployCommandPatterns = getModuleOptions(MODULE_ID, config).deployCommands;
    const releaseCommand = findReleaseCommand(hookInput.tool_input?.command, {
      trunkBranch: config?.trunk || 'main',
      deployCommandPatterns: Array.isArray(deployCommandPatterns) ? deployCommandPatterns : [],
    });
    if (!releaseCommand) return allowDecision();
    const statePath = sessionStatePath(resolveStateDirectory(environment), hookInput.session_id, projectRoot, 'watch-release');
    if (readStateText(statePath) !== null) return allowDecision();
    writeStateText(statePath, releaseCommand);
    return contextDecision(MODULE_ID, `ai1/watches: \`${releaseCommand}\` looks like a release to production. When it is done, offer the person in one line to follow it with /ai1:watches-follow-release `
      + '(a check of whether it works and how often it succeeds or fails, and their own confirmation that they tried it). Do not create the watch without their yes.');
  },
};
