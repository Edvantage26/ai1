// The `rules` of .ai1/config.json: a repo's own block/ask rules, run by the repo-rules module.
// A rule that does not validate is dropped with a notice at session start, never an error: one bad
// rule must not switch off the rest of the harness.

export const REPO_RULE_EVENTS = ['bash', 'edit'];
export const REPO_RULE_ACTIONS = ['ask', 'deny'];
export const MAX_RULE_PATTERN_LENGTH = 300;
const REPO_RULE_FIELDS = new Set(['id', 'on', 'pattern', 'paths', 'action', 'message']);
const RULE_ID_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Problems of one rule, as short phrases (empty when the rule is valid).
export function listRepoRuleProblems(repoRule) {
  if (!repoRule || typeof repoRule !== 'object' || Array.isArray(repoRule)) return ['must be an object'];
  const ruleProblems = Object.keys(repoRule).filter((fieldName) => !REPO_RULE_FIELDS.has(fieldName)).map((fieldName) => `unknown field "${fieldName}"`);
  if (typeof repoRule.id !== 'string' || !RULE_ID_SHAPE.test(repoRule.id)) ruleProblems.push('"id" must be kebab-case (e.g. use-pnpm)');
  if (!REPO_RULE_EVENTS.includes(repoRule.on)) ruleProblems.push(`"on" must be ${REPO_RULE_EVENTS.join(' or ')}`);
  if (!REPO_RULE_ACTIONS.includes(repoRule.action)) ruleProblems.push(`"action" must be ${REPO_RULE_ACTIONS.join(' or ')}`);
  if (typeof repoRule.message !== 'string' || !repoRule.message.trim()) ruleProblems.push('"message" must say why and what to do instead');
  if (repoRule.pattern !== undefined) {
    if (typeof repoRule.pattern !== 'string' || !repoRule.pattern || repoRule.pattern.length > MAX_RULE_PATTERN_LENGTH) {
      ruleProblems.push(`"pattern" must be a regular expression of 1-${MAX_RULE_PATTERN_LENGTH} characters`);
    } else {
      try {
        new RegExp(repoRule.pattern);
      } catch (patternError) {
        ruleProblems.push(`"pattern" is not a valid regular expression (${patternError.message})`);
      }
    }
  }
  if (repoRule.paths !== undefined) {
    const isListOfGlobs = Array.isArray(repoRule.paths) && repoRule.paths.length > 0 && repoRule.paths.every((pathGlob) => typeof pathGlob === 'string' && pathGlob.trim());
    if (!isListOfGlobs) ruleProblems.push('"paths" must be a non-empty list of globs');
    if (repoRule.on === 'bash') ruleProblems.push('"paths" only applies to edit rules');
  }
  if (repoRule.on === 'bash' && repoRule.pattern === undefined) ruleProblems.push('a bash rule needs "pattern"');
  if (repoRule.on === 'edit' && repoRule.pattern === undefined && repoRule.paths === undefined) ruleProblems.push('an edit rule needs "pattern", "paths" or both');
  return ruleProblems;
}

// { validRules, notices }: the rules that run, and one line per dropped rule (duplicate ids included).
export function splitRepoRules(repoRules = []) {
  const validRules = [];
  const notices = [];
  const seenRuleIds = new Set();
  repoRules.forEach((repoRule, ruleIndex) => {
    const ruleProblems = listRepoRuleProblems(repoRule);
    if (!ruleProblems.length && seenRuleIds.has(repoRule.id)) ruleProblems.push(`"id" ${repoRule.id} is repeated`);
    if (ruleProblems.length) {
      notices.push(`.ai1/config.json rules[${ruleIndex}]${typeof repoRule?.id === 'string' ? ` (${repoRule.id})` : ''} is ignored: ${ruleProblems.join('; ')}. Tell the person so it can be fixed.`);
      return;
    }
    seenRuleIds.add(repoRule.id);
    validRules.push(repoRule);
  });
  return { validRules, notices };
}
