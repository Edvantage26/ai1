// okf-claude-md (SessionStart, feature `okf`): when the repo's CLAUDE.md files drift from the bundle
// (too long, sections that repeat or should be concepts, references that no longer exist), tells the
// agent in one line so it can tell the person and offer /ai1:okf-tidy-claude-md. Says it once per set
// of findings for the whole repo (worktrees share it); same findings, silence. No LLM: the
// deterministic check of okf-claude-md.mjs; the judging is the skill's, on request.

import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { tryGit } from '../core/git.mjs';
import { resolveStateDirectory, readStateText, writeStateText, shortHash } from '../core/session-state.mjs';
import { resolveBundleDirectory, readBundleIndex } from './okf-bundle.mjs';
import { loadFileMap } from './okf-file-map.mjs';
import { checkClaudeMdFiles, summarizeClaudeMdReports } from './okf-claude-md-check.mjs';
import { KNOWLEDGE_BUNDLE_PATH } from '../core/config.mjs';

const MODULE_ID = 'okf-claude-md';

export function buildClaudeMdHint(claudeMdReports) {
  return `ai1/okf: CLAUDE.md drifts from the bundle: ${summarizeClaudeMdReports(claudeMdReports)}. `
    + 'Tell the person in one line and offer /ai1:okf-tidy-claude-md (details: `ai1 claude-md`); do not tidy it unasked.';
}

// What the findings are, not where they were seen: the same drift in another worktree is not news.
function fingerprintClaudeMdReports(claudeMdReports) {
  return shortHash(JSON.stringify(claudeMdReports.map(({ path, findings }) => [path,
    findings.map((finding) => [finding.kind, finding.section || '', finding.conceptPath || '', finding.reference || ''])])));
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'okf',
  description: 'Says once when the repo\'s CLAUDE.md drifts from the OKF bundle and offers /ai1:okf-tidy-claude-md.',
  run({ projectRoot, environment }) {
    const bundleDirectory = resolveBundleDirectory(projectRoot);
    if (readBundleIndex(bundleDirectory) === null) return allowDecision();
    const stateDirectory = resolveStateDirectory(environment);
    const claudeMdReports = checkClaudeMdFiles(projectRoot, bundleDirectory, loadFileMap(bundleDirectory, KNOWLEDGE_BUNDLE_PATH, projectRoot, stateDirectory));
    if (!claudeMdReports.length) return allowDecision();
    const repoIdentity = tryGit(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']) || projectRoot;
    const statePath = join(stateDirectory, `${shortHash(repoIdentity)}.claude-md`);
    const findingsFingerprint = fingerprintClaudeMdReports(claudeMdReports);
    if (readStateText(statePath) === findingsFingerprint) return allowDecision();
    writeStateText(statePath, findingsFingerprint);
    return contextDecision(MODULE_ID, buildClaudeMdHint(claudeMdReports));
  },
};
