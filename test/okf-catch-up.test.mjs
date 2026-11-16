import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFileMap } from '../src/okf/okf-file-map.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import {
  listPendingCatchUps, buildCatchUpInstruction, buildCatchUpBrief, claimPendingCatchUps, CLAIM_MILLISECONDS,
} from '../src/okf/okf-catch-up.mjs';
import { createTemporaryProject } from './helpers.mjs';

const BUNDLE_INDEX = '---\nokf_version: "0.2"\n---\n\n# Demo bundle\n\n* [App](app.md) - the app.\n';
const APP_CONCEPT = '---\ntype: Component\ntitle: App\nresource: src/app.js\n---\nThe app.\n';

export function git(projectRoot, gitArguments) {
  return execFileSync('git', ['-C', projectRoot, ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function commitFile(projectRoot, filePath, fileText, message) {
  mkdirSync(join(projectRoot, filePath, '..'), { recursive: true });
  writeFileSync(join(projectRoot, filePath), fileText);
  git(projectRoot, ['add', '-A']);
  git(projectRoot, ['commit', '-q', '-m', message]);
}

export function initRepo() {
  const projectRoot = createTemporaryProject();
  git(projectRoot, ['init', '-q', '-b', 'main']);
  git(projectRoot, ['config', 'user.email', 'test@example.com']);
  git(projectRoot, ['config', 'user.name', 'Test']);
  return projectRoot;
}

// main: a first commit, then ai1 with a bundle; `old-branch`: forked before the bundle, with its own work.
export function createRepoWithBranchWithoutBundle() {
  const projectRoot = initRepo();
  commitFile(projectRoot, 'src/app.js', 'export const version = 1;\n', 'first');
  git(projectRoot, ['checkout', '-q', '-b', 'old-branch']);
  commitFile(projectRoot, 'src/app.js', 'export const version = 2;\n', 'app v2 without docs');
  commitFile(projectRoot, 'src/billing.js', 'export const billing = true;\n', 'billing without docs');
  git(projectRoot, ['checkout', '-q', 'main']);
  writeFileSync(join(projectRoot, 'README.md'), 'demo\n');
  mkdirSync(join(projectRoot, '.ai1', 'okf'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'config.json'), '{}');
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), BUNDLE_INDEX);
  commitFile(projectRoot, '.ai1/okf/app.md', APP_CONCEPT, 'enable ai1');
  return projectRoot;
}

export function mergeBranch(projectRoot, branchName) {
  git(projectRoot, ['merge', '-q', '--no-ff', '--no-edit', branchName]);
  return git(projectRoot, ['rev-parse', 'HEAD']);
}

const fileMapOf = (projectRoot) => buildFileMap(join(projectRoot, '.ai1', 'okf'), '.ai1/okf');

test('catch-up: a merged branch that had no bundle is pending, with its files and concepts [okf-merge-catch-up:S1]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const mergeSha = mergeBranch(projectRoot, 'old-branch');
  const [pendingMerge, ...otherMerges] = listPendingCatchUps(projectRoot);
  assert.equal(otherMerges.length, 0);
  assert.equal(pendingMerge.sha, mergeSha);
  assert.deepEqual(pendingMerge.changedPaths, ['src/app.js', 'src/billing.js']);
  const instruction = buildCatchUpInstruction([pendingMerge], fileMapOf(projectRoot));
  assert.match(instruction, new RegExp(`merge ${mergeSha.slice(0, 7)} "Merge branch 'old-branch'": 2 file\\(s\\); probably affected: \`.ai1/okf/app.md\`; 1 of them described by no concept`));
  assert.match(instruction, /Tell the person in one line/);
  assert.match(instruction, /ai1 okf catch-up --brief <sha>/);
  const brief = buildCatchUpBrief(projectRoot, pendingMerge, fileMapOf(projectRoot));
  assert.match(brief, /billing without docs/);
  assert.match(brief, new RegExp(`Knowledge-Catch-Up: ${mergeSha}`));
  assert.match(brief, /ai1 worktree create/);
});

test('catch-up: a commit with the trailer closes the merge, full or abbreviated sha [okf-merge-catch-up:S2]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const mergeSha = mergeBranch(projectRoot, 'old-branch');
  git(projectRoot, ['commit', '-q', '--allow-empty', '-m', `docs: nothing to add\n\nKnowledge-Catch-Up: ${mergeSha.slice(0, 9)}`]);
  assert.deepEqual(listPendingCatchUps(projectRoot), []);
});

test('catch-up: merges where both sides or neither side had the bundle are not pending [okf-merge-catch-up:S4]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  git(projectRoot, ['checkout', '-q', '-b', 'documented-branch']);
  commitFile(projectRoot, 'src/other.js', 'export const other = 1;\n', 'work with ai1, no concept needed');
  git(projectRoot, ['checkout', '-q', 'main']);
  mergeBranch(projectRoot, 'documented-branch');
  assert.deepEqual(listPendingCatchUps(projectRoot), []);
  // History before the bundle: neither side has it.
  const plainRoot = initRepo();
  commitFile(plainRoot, 'a.js', '1\n', 'first');
  git(plainRoot, ['checkout', '-q', '-b', 'side']);
  commitFile(plainRoot, 'b.js', '1\n', 'side');
  git(plainRoot, ['checkout', '-q', 'main']);
  commitFile(plainRoot, 'c.js', '1\n', 'main');
  mergeBranch(plainRoot, 'side');
  assert.deepEqual(listPendingCatchUps(plainRoot), []);
});

test('catch-up: a branch forked before the bundle moved from .okf/ to .ai1/okf/ had documentation', () => {
  const projectRoot = initRepo();
  commitFile(projectRoot, '.okf/index.md', BUNDLE_INDEX, 'legacy bundle');
  git(projectRoot, ['checkout', '-q', '-b', 'legacy-branch']);
  commitFile(projectRoot, 'src/x.js', '1\n', 'legacy work');
  git(projectRoot, ['checkout', '-q', 'main']);
  git(projectRoot, ['mv', '.okf', '.ai1']);
  mkdirSync(join(projectRoot, '.ai1', 'okf'));
  git(projectRoot, ['mv', '.ai1/index.md', '.ai1/okf/index.md']);
  git(projectRoot, ['commit', '-q', '-m', 'move bundle']);
  mergeBranch(projectRoot, 'legacy-branch');
  assert.deepEqual(listPendingCatchUps(projectRoot), []);
});

test('catch-up claims: a merge told to one session is not told to another for 2 hours [okf-merge-catch-up:S3]', () => {
  const claimsPath = join(createTemporaryProject(), 'claims.json');
  const pendingMerges = [{ sha: 'a'.repeat(40) }];
  const startMilliseconds = 1_000_000;
  assert.equal(claimPendingCatchUps(claimsPath, pendingMerges, 'session-1', startMilliseconds).length, 1);
  assert.equal(claimPendingCatchUps(claimsPath, pendingMerges, 'session-2', startMilliseconds + 60_000).length, 0);
  const newMerge = { sha: 'b'.repeat(40) };
  assert.deepEqual(claimPendingCatchUps(claimsPath, [...pendingMerges, newMerge], 'session-2', startMilliseconds + 60_000), [newMerge]);
  assert.equal(claimPendingCatchUps(claimsPath, pendingMerges, 'session-2', startMilliseconds + CLAIM_MILLISECONDS).length, 1);
});

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function hookContext(eventName, projectRoot, sessionId, options) {
  return JSON.stringify(runHookEvent(eventName, { session_id: sessionId, cwd: projectRoot, prompt: 'sigue con la tarea de antes' }, options) || {});
}

const CATCH_UP_TOLD = /a branch that had no knowledge bundle was merged here/;

test('catch-up hooks: told at session start, then not again to another session within 2 hours [okf-merge-catch-up:S1] [okf-merge-catch-up:S3]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  mergeBranch(projectRoot, 'old-branch');
  const options = hookOptions();
  assert.match(hookContext('SessionStart', projectRoot, 'session-1', options), CATCH_UP_TOLD);
  assert.doesNotMatch(hookContext('SessionStart', projectRoot, 'session-2', options), CATCH_UP_TOLD);
});

test('catch-up hooks: a merge done in a terminal during the session is told at the next message [okf-merge-catch-up:S1]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const options = hookOptions();
  assert.doesNotMatch(hookContext('SessionStart', projectRoot, 'session-1', options), CATCH_UP_TOLD);
  assert.doesNotMatch(hookContext('UserPromptSubmit', projectRoot, 'session-1', options), CATCH_UP_TOLD);
  mergeBranch(projectRoot, 'old-branch');
  assert.match(hookContext('UserPromptSubmit', projectRoot, 'session-1', options), CATCH_UP_TOLD);
  assert.doesNotMatch(hookContext('UserPromptSubmit', projectRoot, 'session-1', options), CATCH_UP_TOLD);
});

test('okf-upkeep: a merge of a branch without bundle made in the session asks for the catch-up, not to document it as the session\'s work [okf-merge-catch-up:S5]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const options = hookOptions();
  hookContext('SessionStart', projectRoot, 'session-1', options);
  mergeBranch(projectRoot, 'old-branch');
  const stopOutput = JSON.stringify(runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot }, options) || {});
  assert.match(stopOutput, CATCH_UP_TOLD);
  assert.doesNotMatch(stopOutput, /Repo files changed after the last bundle update/);
  const secondStopOutput = JSON.stringify(runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot }, options) || {});
  assert.doesNotMatch(secondStopOutput, CATCH_UP_TOLD);
  assert.doesNotMatch(secondStopOutput, /src\/billing\.js/);
});

test('ai1 okf catch-up lists the pending merges, as text or JSON, and prints the brief of one [okf-merge-catch-up:S6]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const cliPath = fileURLToPath(new URL('../bin/ai1', import.meta.url));
  const runCli = (cliArguments) => execFileSync(process.execPath, [cliPath, 'okf', 'catch-up', ...cliArguments], { cwd: join(projectRoot, 'src'), encoding: 'utf8' });
  assert.match(runCli([]), /No merge of a branch without knowledge bundle is pending here/);
  const mergeSha = mergeBranch(projectRoot, 'old-branch');
  assert.match(runCli([]), new RegExp(`^merge ${mergeSha.slice(0, 7)} "Merge branch 'old-branch'": 2 file\\(s\\)`));
  const [pendingEntry] = JSON.parse(runCli(['--json']));
  assert.deepEqual(pendingEntry, {
    sha: mergeSha, subject: "Merge branch 'old-branch'", files: ['src/app.js', 'src/billing.js'],
    affectedConceptPaths: ['.ai1/okf/app.md'], uncoveredPaths: ['src/billing.js'],
  });
  const brief = runCli(['--brief', mergeSha.slice(0, 8)]);
  assert.match(brief, /Bring the knowledge bundle/);
  assert.match(brief, /What the code does not show, write as unknown; never invent intent/);
  assert.match(brief, /generated: \{ by: claude-code\/<model>/);
  assert.match(brief, new RegExp(`Knowledge-Catch-Up: ${mergeSha}`));
  assert.throws(() => runCli(['--brief', 'abcdef1']), (cliError) => cliError.status === 1);
});

test('catch-up hooks: caught up, or the okf feature off, says nothing [okf-merge-catch-up:S2]', () => {
  const projectRoot = createRepoWithBranchWithoutBundle();
  const mergeSha = mergeBranch(projectRoot, 'old-branch');
  git(projectRoot, ['commit', '-q', '--allow-empty', '-m', `docs: catch up\n\nKnowledge-Catch-Up: ${mergeSha}`]);
  assert.doesNotMatch(hookContext('SessionStart', projectRoot, 'session-1', hookOptions()), CATCH_UP_TOLD);
  const featureOffRoot = createRepoWithBranchWithoutBundle();
  writeFileSync(join(featureOffRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: false, danger: true } }));
  mergeBranch(featureOffRoot, 'old-branch');
  assert.doesNotMatch(hookContext('SessionStart', featureOffRoot, 'session-1', hookOptions()), CATCH_UP_TOLD);
});
