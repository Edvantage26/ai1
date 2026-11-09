// repo-rules (PreToolUse, feature `danger`): the repo's own rules from `rules` in .ai1/config.json,
// so a project rule ("use pnpm", "never edit generated/") is a mechanism instead of a CLAUDE.md line.
// `bash` rules test each simple command of the line (words joined, quotes removed); `edit` rules
// limit by `paths` and/or test `pattern` against the new text. Rules were validated when the config
// loaded (core/repo-rules-config). Inputs are capped so a slow pattern stays bounded.

import { relative } from 'node:path';
import { allowDecision, askDecision, denyDecision } from '../core/hook-io.mjs';
import { matchesAnyGlob } from '../core/path-glob.mjs';
import { splitSimpleCommands } from '../core/shell-parse.mjs';

const MODULE_ID = 'repo-rules';
const MAX_TESTED_CHARACTERS = 20000;

function newTextOfEdit(toolInput) {
  if (typeof toolInput.content === 'string') return toolInput.content;
  if (Array.isArray(toolInput.edits)) return toolInput.edits.map((fileEdit) => fileEdit.new_string || '').join('\n');
  return toolInput.new_string ?? toolInput.new_source ?? '';
}

export function findRepoRuleMatches(hookInput, projectRoot, repoRules = []) {
  const toolInput = hookInput.tool_input || {};
  const isBash = hookInput.tool_name === 'Bash';
  const applicableRules = repoRules.filter((repoRule) => repoRule.on === (isBash ? 'bash' : 'edit'));
  if (applicableRules.length === 0) return [];
  if (isBash) {
    const commandTexts = splitSimpleCommands(String(toolInput.command || '')).map(({ text }) => text.slice(0, MAX_TESTED_CHARACTERS));
    return applicableRules.filter((repoRule) => {
      const rulePattern = new RegExp(repoRule.pattern);
      return commandTexts.some((commandText) => rulePattern.test(commandText));
    });
  }
  const editedPath = toolInput.file_path || toolInput.notebook_path;
  if (typeof editedPath !== 'string') return [];
  const relativePath = relative(projectRoot, editedPath).split('\\').join('/');
  const newText = String(newTextOfEdit(toolInput)).slice(0, MAX_TESTED_CHARACTERS);
  return applicableRules.filter((repoRule) => (!repoRule.paths || matchesAnyGlob(relativePath, repoRule.paths))
    && (repoRule.pattern === undefined || new RegExp(repoRule.pattern).test(newText)));
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  toolNames: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash'],
  feature: 'danger',
  description: 'Applies the repo\'s own rules (`rules` in .ai1/config.json): ask or refuse matching commands and edits.',
  run({ hookInput, projectRoot, config }) {
    const matchedRules = findRepoRuleMatches(hookInput, projectRoot, config.rules);
    if (matchedRules.length === 0) return allowDecision();
    const ruleLines = matchedRules.map((repoRule) => `[${repoRule.id}] ${repoRule.message}`).join(' ');
    if (matchedRules.some((repoRule) => repoRule.action === 'deny')) {
      return denyDecision(MODULE_ID, `${ruleLines} (a rule of this repo). Do not reach the same result another way; if it seems wrong, tell the person.`, matchedRules.map((repoRule) => repoRule.id));
    }
    return askDecision(MODULE_ID, `${ruleLines} (a rule of this repo). The person confirms.`, matchedRules.map((repoRule) => repoRule.id));
  },
};
