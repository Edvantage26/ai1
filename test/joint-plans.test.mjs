import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { checkSubplans, hashContractSection, readFrontmatterList, readJointFields, canonicalPlanPath } from '../src/sizing/joint-plans.mjs';

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function createRepository(parentDirectory, repoName, ai1Config = { features: {} }) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(join(repoRoot, '.ai1'), { recursive: true });
  writeFileSync(join(repoRoot, '.ai1', 'config.json'), JSON.stringify(ai1Config));
  writeFileSync(join(repoRoot, '.gitignore'), '.ai1/work/\n');
  runGit(repoRoot, ['init', '-q', '-b', 'main']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

const CONTRACT_V1 = '# Contract\n\nThe engine accepts `tenant_options` (object) on POST /chat.\n';

function writePlan(repoRoot, planSlug, frontmatterLines, bodyText = '') {
  const planDirectory = join(repoRoot, '.ai1', 'work', planSlug);
  mkdirSync(planDirectory, { recursive: true });
  const planPath = join(planDirectory, 'plan.md');
  writeFileSync(planPath, `---\n${frontmatterLines.join('\n')}\n---\n\n${bodyText}`);
  return planPath;
}

// A coordinator (client) with a joint plan and an engine with its sub-plan, linked both ways.
function createJointWorkspace({ subplanStatus = 'ready', subplanContract } = {}) {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-joint-')));
  const clientRoot = createRepository(workspaceRoot, 'client');
  const engineRoot = createRepository(workspaceRoot, 'engine');
  const jointPlanPath = join(clientRoot, '.ai1', 'work', 'tenant-options', 'plan.md');
  const subplanPath = writePlan(engineRoot, 'tenant-options', ['title: Engine part', 'size: plan', `status: ${subplanStatus}`, `parent: ${jointPlanPath}`, `contract: ${subplanContract ?? hashContractSection(`---\n---\n${CONTRACT_V1}`)}`], '# Steps\n- [ ] 1. Accept tenant_options.\n');
  writePlan(clientRoot, 'tenant-options', ['title: Tenant options for the client', 'status: ready', 'subplans:', `  - ${subplanPath}`], `# Goal\nX.\n\n${CONTRACT_V1}\n# Steps\n- [ ] 1. Send it.\n`);
  return { workspaceRoot, clientRoot, engineRoot, jointPlanPath, subplanPath };
}

test('joint fields: subplans as a block or inline list, parent and contract', () => {
  assert.deepEqual(readFrontmatterList('subplans:\n  - /a b/plan.md\n  - "/c/plan.md"\nx: 1', 'subplans'), ['/a b/plan.md', '/c/plan.md']);
  assert.deepEqual(readFrontmatterList('subplans: [/a/plan.md, /c/plan.md]', 'subplans'), ['/a/plan.md', '/c/plan.md']);
  assert.deepEqual(readJointFields('---\nparent: /x/plan.md\ncontract: abc\n---\n'), { subplans: [], parent: '/x/plan.md', contract: 'abc' });
});

test('the contract hash changes only with the Contract section', () => {
  const baseText = `---\ntitle: t\n---\n# Goal\nA.\n\n${CONTRACT_V1}\n# Steps\n- 1\n`;
  assert.equal(hashContractSection(baseText), hashContractSection(baseText.replace('# Goal\nA.', '# Goal\nB, longer.')));
  assert.equal(hashContractSection(baseText), hashContractSection(baseText.replace('accepts `tenant_options`', 'accepts  `tenant_options`')), 'whitespace does not count');
  assert.notEqual(hashContractSection(baseText), hashContractSection(baseText.replace('(object)', '(string)')));
  assert.equal(hashContractSection('---\n---\n# Goal\nno contract\n'), '');
});

test('checkSubplans: ok when linked both ways, ready and on the current contract; each problem named', () => {
  const { jointPlanPath, engineRoot } = createJointWorkspace();
  assert.deepEqual(checkSubplans(jointPlanPath).map((subplanCheck) => [subplanCheck.repo, subplanCheck.problem]), [[engineRoot, null]]);
  assert.equal(checkSubplans(createJointWorkspace({ subplanStatus: 'draft' }).jointPlanPath)[0].problem, 'not-ready');
  assert.equal(checkSubplans(createJointWorkspace({ subplanContract: 'old' }).jointPlanPath)[0].problem, 'stale-contract');
});

test('a joint plan written in a worktree is still the parent its sub-plans name (main checkout form)', () => {
  const { clientRoot, workspaceRoot } = createJointWorkspace();
  const worktreeRoot = join(workspaceRoot, 'client-wt');
  runGit(clientRoot, ['worktree', 'add', '-q', worktreeRoot]);
  assert.equal(canonicalPlanPath(join(worktreeRoot, '.ai1', 'work', 'tenant-options', 'plan.md')), join(clientRoot, '.ai1', 'work', 'tenant-options', 'plan.md'));
});

function approveJointPlan({ clientRoot, jointPlanPath, workspaceRoot }) {
  const transcriptPath = join(workspaceRoot, 'coordinator.jsonl');
  writeFileSync(transcriptPath, [
    { type: 'user', message: { role: 'user', content: 'diseña el cambio' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w1', name: 'Write', input: { file_path: jointPlanPath, content: '...' } }] } },
  ].map((transcriptEvent) => `${JSON.stringify(transcriptEvent)}\n`).join(''));
  const environment = { AI1_DECISION_LOG: '0', CLAUDE_PLUGIN_DATA: join(workspaceRoot, '.plugin-data'), CLAUDE_PROJECT_DIR: clientRoot };
  return runHookEvent('UserPromptSubmit', { session_id: 'coordinator', cwd: clientRoot, transcript_path: transcriptPath, prompt: 'adelante' }, { environment, reportInternalError: () => {} });
}

test('one yes approves the joint plan only while every sub-plan links back, is ready and has the current contract [joint-plans:S2]', () => {
  const okWorkspace = createJointWorkspace();
  assert.match(approveJointPlan(okWorkspace).hookSpecificOutput.additionalContext, /approved the design/);
  assert.match(readFileSync(okWorkspace.jointPlanPath, 'utf8'), /status: approved/);
  assert.match(readFileSync(okWorkspace.subplanPath, 'utf8'), /status: ready/, 'the other repo\'s files are not written');

  const staleWorkspace = createJointWorkspace({ subplanContract: 'old' });
  const staleText = approveJointPlan(staleWorkspace).hookSpecificOutput.additionalContext;
  assert.match(staleText, /joint design .* is NOT approved/);
  assert.ok(staleText.includes(staleWorkspace.subplanPath) && /another version of `# Contract`/.test(staleText), 'names the sub-plan and why');
  assert.match(readFileSync(staleWorkspace.jointPlanPath, 'utf8'), /status: ready/);
});
