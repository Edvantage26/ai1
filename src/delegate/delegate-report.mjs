// delegate-report (Stop, feature `delegate`): in a session started by `ai1 delegate` (environment
// AI1_DELEGATION=<its session id>), writes what ai1 knows for certain about the run, for the caller:
// whether the verify commands passed in this session and the plans it left open. `ai1 delegate` merges
// it into the delegation record when the run ends, next to the status the agent wrote. Silent elsewhere.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { allowDecision } from '../core/hook-io.mjs';
import { readSessionBase } from '../core/session-base.mjs';
import { listActivePlans, listPlanRoots, readSessionPlanSlugs } from '../sizing/sizing-work.mjs';
import { scanVerifyRuns } from '../verify/verify-gate.mjs';
import { delegationReportPath } from './delegate-state.mjs';

const MODULE_ID = 'delegate-report';

// 'passed' when every verify command's last run in this session passed, 'failed' when one failed,
// 'not-run' when one never ran, 'none' when the repo has no verify commands.
export function summarizeVerifyRuns(verifyCommands, lastRuns = {}) {
  if (verifyCommands.length === 0) return 'none';
  const verifyRuns = verifyCommands.map((verifyCommand, verifyIndex) => lastRuns[verifyIndex]);
  if (verifyRuns.some((verifyRun) => verifyRun && !verifyRun.passed)) return 'failed';
  return verifyRuns.every(Boolean) ? 'passed' : 'not-run';
}

export default {
  id: MODULE_ID,
  event: 'Stop',
  feature: 'delegate',
  description: 'In a session started by `ai1 delegate`, records for the caller whether the verify commands passed and the plans left open.',
  run({ hookInput, config, projectRoot, sharedRoot, environment }) {
    const delegatedSessionId = environment.AI1_DELEGATION;
    if (!delegatedSessionId) return allowDecision();
    const verifyCommands = config.verify || [];
    const scanState = {};
    const hasTranscript = scanVerifyRuns(hookInput.transcript_path, verifyCommands, scanState, projectRoot);
    const sessionBase = readSessionBase(hookInput, projectRoot, environment);
    const openPlans = listActivePlans(listPlanRoots(projectRoot, sharedRoot), sessionBase?.sessionStartMilliseconds, readSessionPlanSlugs(hookInput, projectRoot, environment))
      .map((workPlan) => ({ slug: workPlan.slug, title: workPlan.title, status: workPlan.status, path: workPlan.planPath }));
    const reportPath = delegationReportPath(delegatedSessionId, environment);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({
      verify: hasTranscript ? summarizeVerifyRuns(verifyCommands, scanState.lastRuns) : 'unknown',
      verify_commands: verifyCommands,
      open_plans: openPlans,
      reported_at: new Date().toISOString(),
    }));
    return allowDecision();
  },
};
