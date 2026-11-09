// issue-offer (UserPromptSubmit, feature `core`): when ai1 itself failed in this repo (a module threw,
// the hook entry point crashed), asks the agent to offer the person, in one line, to report it with
// /ai1:core-report-issue - once per error and plugin version, nothing created without the person's yes
// unless they chose automatic reports.
// In the ai1 repo itself it offers to fix it here instead. Silent, and nearly free, when nothing failed.
// Per person, AI1_REPORT_ERRORS (in ~/.claude/settings.json `env`): `ask` (default) offers, `auto` has
// the agent file it at once with the fixed-facts body of `ai1 issue auto-body`, `off` stays silent.

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

export const REPORT_MODES = ['ask', 'auto', 'off'];

export function readReportMode(environment = process.env) {
  return REPORT_MODES.includes(environment.AI1_REPORT_ERRORS) ? environment.AI1_REPORT_ERRORS : 'ask';
}

export function buildIssueOfferText(newErrors, { inAi1Repository, reportMode = 'ask' }) {
  const errorList = newErrors.map((pendingError) => `\`${pendingError.module}\` (${pendingError.error}), ${pendingError.count} time(s) since ${pendingError.first.slice(0, 10)}`).join('; ');
  if (inAi1Repository) return `ai1 itself failed here: ${errorList}. This is the ai1 repo: offer the person, in one line, to look into it and fix it in this session.`;
  if (reportMode === 'auto') {
    return `ai1 itself failed in this repo: ${errorList}. The person chose to report ai1's own errors automatically (AI1_REPORT_ERRORS=auto): file it now with /ai1:core-report-issue in auto mode - title and body exactly as \`ai1 issue auto-body\` prints them, nothing added - then tell the person the link in one line.`;
  }
  return `ai1 itself failed in this repo: ${errorList}. Offer the person, in one line, to report it with /ai1:core-report-issue; report nothing without their yes to the exact text.`;
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'core',
  description: 'When ai1 itself failed in this repo, asks the agent to offer reporting it as an issue (once per error and version).',
  run({ projectRoot, sharedRoot = projectRoot, environment }) {
    const reportMode = readReportMode(environment);
    if (reportMode === 'off') return allowDecision();
    const pendingErrors = readPendingErrors(sharedRoot, environment);
    const pluginVersion = readPluginVersion();
    const newErrorKeys = Object.keys(pendingErrors).filter((errorKey) => pendingErrors[errorKey].offeredVersion !== pluginVersion);
    if (newErrorKeys.length === 0) return allowDecision();
    markErrorsOffered(newErrorKeys, pluginVersion, sharedRoot, environment);
    return contextDecision(MODULE_ID, buildIssueOfferText(newErrorKeys.map((errorKey) => pendingErrors[errorKey]), { inAi1Repository: isAi1Repository(sharedRoot), reportMode }));
  },
};
