// What `ai1 worktree finish` wrote into a checked-out base when it fast-forwarded it, and what was
// checked on that exact content first: `verified` (the recipe's pre-finish ran every verify command
// and passed) and `knowledge_checked` (the OKF checks passed). The fast-forward gives those files
// fresh modification times, so okf-upkeep and verify-gate would take them for unchecked changes;
// they skip a file only while its path and modification time still match the record, so a later
// edit counts again. Kept in `<git-common-dir>/ai1-integrations.json`, outside every checkout.

import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readJsonFileIfValid, writeJsonFile } from '../core/json-file.mjs';
import { findWorkingTreeTop, readGitDirectories } from '../core/project-roots.mjs';

const INTEGRATIONS_FILE_NAME = 'ai1-integrations.json';
const MAX_INTEGRATION_RECORDS = 20;

function integrationsPath(commonDirectory) {
  return join(commonDirectory, INTEGRATIONS_FILE_NAME);
}

// `changedPaths`: repo-relative paths the fast-forward changed in `checkout`; a deleted one is
// recorded without a modification time.
export function recordIntegration(commonDirectory, { checkout, changedPaths, verified, knowledgeChecked }) {
  const integratedFiles = changedPaths.map((changedPath) => {
    const absolutePath = join(checkout, changedPath);
    return { path: changedPath, modified_ms: existsSync(absolutePath) ? Math.floor(statSync(absolutePath).mtimeMs) : null };
  });
  const integrationRecords = readJsonFileIfValid(integrationsPath(commonDirectory)) || [];
  integrationRecords.push({
    checkout: resolve(checkout), at: new Date().toISOString(), verified, knowledge_checked: knowledgeChecked, files: integratedFiles,
  });
  writeJsonFile(integrationsPath(commonDirectory), integrationRecords.slice(-MAX_INTEGRATION_RECORDS));
}

// A function telling whether a file of `projectRoot` (relative path, modification time or null when
// deleted) is still exactly as an integration with `integrationCheck` left it. Never throws.
export function integratedFileMatcher(projectRoot, integrationCheck) {
  const integratedSignatures = new Set();
  try {
    const workingTreeTop = findWorkingTreeTop(projectRoot);
    const gitDirectories = workingTreeTop && readGitDirectories(workingTreeTop);
    const integrationRecords = gitDirectories ? readJsonFileIfValid(integrationsPath(gitDirectories.commonDirectory)) : null;
    for (const integrationRecord of Array.isArray(integrationRecords) ? integrationRecords : []) {
      if (integrationRecord.checkout !== resolve(projectRoot) || integrationRecord[integrationCheck] !== true) continue;
      for (const integratedFile of integrationRecord.files || []) integratedSignatures.add(`${integratedFile.path}:${integratedFile.modified_ms}`);
    }
  } catch {
    // No record readable: nothing is skipped.
  }
  return (relativePath, modifiedMilliseconds) => integratedSignatures.has(`${relativePath}:${modifiedMilliseconds === null ? null : Math.floor(modifiedMilliseconds)}`);
}
