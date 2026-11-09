// issue-offer (UserPromptSubmit, feature `core`): when ai1 itself failed in this repo (a module threw,
// the hook entry point crashed), asks the agent to offer the person, in one line, to report it with
// /ai1:core-report-issue - once per error and plugin version, nothing created without the person's yes.
// In the ai1 repo itself it offers to fix it here instead. Silent, and nearly free, when nothing failed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from './hook-io.mjs';
import { markErrorsOffered, readPendingErrors } from './pending-errors.mjs';

const MODULE_ID = 'issue-offer';

export function readPluginVersion() {
  return JSON.parse(readFileSync(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version;
}

function isAi1Repository(sharedRoot) {
  const manifestPath = join(sharedRoot, '.claude-plugin', 'plugin.json');
  try {
    return existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).name === 'ai1';
  } catch {
    return false;
  }
}

export function buildIssueOfferText(newErrors, { inAi1Repository }) {
  const errorList = newErrors.map((pendingError) => `\`${pendingError.module}\` (${pendingError.error}), ${pendingError.count} time(s) since ${pendingError.first.slice(0, 10)}`).join('; ');
  return inAi1Repository
    ? `ai1 itself failed here: ${errorList}. This is the ai1 repo: offer the person, in one line, to look into it and fix it in this session.`
    : `ai1 itself failed in this repo: ${errorList}. Offer the person, in one line, to report it with /ai1:core-report-issue; report nothing without their yes to the exact text.`;
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'core',
  description: 'When ai1 itself failed in this repo, asks the agent to offer reporting it as an issue (once per error and version).',
  run({ projectRoot, sharedRoot = projectRoot, environment }) {
    const pendingErrors = readPendingErrors(sharedRoot, environment);
    const pluginVersion = readPluginVersion();
    const newErrorKeys = Object.keys(pendingErrors).filter((errorKey) => pendingErrors[errorKey].offeredVersion !== pluginVersion);
    if (newErrorKeys.length === 0) return allowDecision();
    markErrorsOffered(newErrorKeys, pluginVersion, sharedRoot, environment);
    return contextDecision(MODULE_ID, buildIssueOfferText(newErrorKeys.map((errorKey) => pendingErrors[errorKey]), { inAi1Repository: isAi1Repository(sharedRoot) }));
  },
};
