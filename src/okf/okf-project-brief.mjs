// okf-project (SessionStart, feature `okf`): what the agent must know of the project before working on
// it (src/okf/okf-project.mjs). Once the project context is started (a Product concept or a
// requirement): the rule to ask before guessing what neither the code nor the bundle answers, the
// gaps in one line, then what is out of scope, the questions still open and the active must
// requirements, each list capped so the whole stays within a few lines. Silent on resume, without a
// bundle and before the project context starts: the session start has no room to spare (see
// test/session-start-budget.test.mjs), and core-setup-repo offers the interview that starts it.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { contextList, shortenListTitle } from '../core/context-list.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';
import { resolveBundleDirectory } from './okf-bundle.mjs';
import { buildGapMap, REQUIREMENTS_DIRECTORY } from './okf-project.mjs';
import { buildStackCatalog } from './okf-stack.mjs';

const MODULE_ID = 'okf-project';
const MAX_OUT_OF_SCOPE = 2;
const MAX_QUESTIONS = 2;
const MAX_ACTIVE_REQUIREMENTS = 3;

export const DOUBT_RULE = 'Project doubts: when a decision depends on something neither the code nor the bundle answers (who it is for, scope, constraints, how it ships, who decides), ask the person before guessing, one question with your recommended answer, and write the answer where it belongs; what they cannot answer now goes to `ai1 okf project question add|assume`.';
const REQUIREMENT_CHANGE_RULE = 'Requirements say what the project must achieve and why (changing one needs the person\'s decision); how it is built goes in the other concepts. They change only from the person\'s words, never from what the code does: when a message contradicts one ("ahora el cliente quiere...", "eso ya no"), confirm in one line and record it with their words via `ai1 okf project req add|set` (a replacement: `req add --supersedes <id>`). A deep design lists the requirements it serves in `requirements:` of its plan.';

const plainTitle = (requirement) => shortenListTitle((requirement.title || requirement.id).replace(/^R\d+\s+/, ''));

// The context parts for a started project; [] when it has not started.
export function describeProjectContext(gapMap) {
  if (!gapMap.started) return [];
  const missingLabels = gapMap.categories.filter((projectCategory) => projectCategory.status === 'missing').map((projectCategory) => projectCategory.label);
  const partialLabels = gapMap.categories.filter((projectCategory) => projectCategory.status === 'partial').map((projectCategory) => projectCategory.label);
  const gapText = [missingLabels.length ? `missing ${missingLabels.join(', ')}` : '', partialLabels.length ? `partial ${partialLabels.join(', ')}` : ''].filter(Boolean).join('; ');
  const listPointer = (leftOutCount, commandText) => `- ... and ${leftOutCount} more: \`${commandText}\``;
  const outOfScope = gapMap.requirements.filter((requirement) => requirement.state === 'out-of-scope');
  const pendingQuestions = gapMap.questions.filter((question) => question.status !== 'answered');
  const activeMust = gapMap.requirements.filter((requirement) => requirement.state === 'active' && requirement.priority === 'must');
  const contextParts = [
    `Project context (\`${KNOWLEDGE_BUNDLE_PATH}/${gapMap.product || 'product.md'}\`, \`${KNOWLEDGE_BUNDLE_PATH}/${REQUIREMENTS_DIRECTORY}/\`): ${gapText || 'every category answered'}.${gapText ? ' Fill the gaps when the person has a moment, with /ai1:okf-interview-project (never in the middle of a task).' : ''}`,
    REQUIREMENT_CHANGE_RULE,
  ];
  if (outOfScope.length) {
    contextParts.push('Out of scope (do not build; say so if a request touches it):', contextList(outOfScope.map((requirement) => `- ${requirement.id} ${plainTitle(requirement)}`), (leftOutCount) => listPointer(leftOutCount, 'ai1 okf project req list --state out-of-scope'), { shownAtMost: MAX_OUT_OF_SCOPE }));
  }
  if (pendingQuestions.length) {
    contextParts.push('Open questions (ask when it fits; an assumption holds until confirmed):', contextList(pendingQuestions.map((question) => `- ${question.id} ${shortenListTitle(question.text)}${question.status === 'assumed' ? ` (assumed: ${shortenListTitle(question.assumption.replace(/ \(\d{4}-\d{2}-\d{2}\)$/, ''))})` : ''}`), (leftOutCount) => listPointer(leftOutCount, 'ai1 okf project question list'), { shownAtMost: MAX_QUESTIONS }));
  }
  if (activeMust.length) {
    contextParts.push('Active must requirements:', contextList(activeMust.map((requirement) => `- ${requirement.id} ${plainTitle(requirement)}`), (leftOutCount) => listPointer(leftOutCount, 'ai1 okf project req list --state active'), { shownAtMost: MAX_ACTIVE_REQUIREMENTS }));
  }
  return contextParts;
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'okf',
  description: 'Once the project context is started, has the agent ask before guessing what the bundle does not answer, and lists the project gaps, what is out of scope, open questions and active requirements.',
  run({ hookInput, config, projectRoot, environment, homeDirectory }) {
    if (hookInput.source === 'resume') return allowDecision();
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (!existsSync(join(bundleDirectory, 'index.md'))) return allowDecision();
    const stackCatalogPieceCount = buildStackCatalog(projectRoot, { environment: environment || process.env, ...(homeDirectory ? { homeDirectory } : {}) }).pieces.length;
    const gapMap = buildGapMap(bundleDirectory, { verifyCommands: config?.verify || [], stackCatalogPieceCount });
    if (!gapMap.started) return allowDecision();
    return contextDecision(MODULE_ID, [DOUBT_RULE, ...describeProjectContext(gapMap)]);
  },
};
