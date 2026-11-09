import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createProposal, setProposalStatus, checkProposals, listProposals } from '../src/proposals/proposals-documents.mjs';
import { createTemporaryProject } from './helpers.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createProposalRepo(featureSettings = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false, proposals: true, ...featureSettings } });
  writeFileSync(join(projectRoot, 'app.js'), 'console.log(1);\n');
  runGit(projectRoot, ['init', '-q']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  return projectRoot;
}

function addBundle(projectRoot, conceptText = '') {
  mkdirSync(join(projectRoot, '.ai1', 'okf', 'decisions'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n\n# Bundle\n');
  if (conceptText) writeFileSync(join(projectRoot, '.ai1', 'okf', 'decisions', 'prod-guard.md'), conceptText);
}

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

const startSession = (projectRoot, options, source = 'startup') => runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, options);
const sendPrompt = (projectRoot, options, promptText) => runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: projectRoot, prompt: promptText }, options);
const stopSession = (projectRoot, options) => runHookEvent('Stop', { session_id: 'session-1', cwd: projectRoot }, options);

test('proposals new: numbers from 0001, fills the template and writes the index', () => {
  const projectRoot = createProposalRepo();
  const firstProposal = createProposal(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production', today: '2026-11-08' });
  const secondProposal = createProposal(projectRoot, { slug: 'secret-scan', today: '2026-11-09' });
  assert.equal(firstProposal.relativePath, '.ai1/proposals/0001-prod-guard.md');
  assert.equal(secondProposal.relativePath, '.ai1/proposals/0002-secret-scan.md');
  const ideaText = readFileSync(join(projectRoot, firstProposal.relativePath), 'utf8');
  assert.match(ideaText, /^---\nproposal: 1\ntitle: Guard writes to production\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---/);
  assert.match(ideaText, /# Proposal 0001: Guard writes to production/);
  assert.doesNotMatch(ideaText, /{{/, 'no placeholder left');
  const fullText = readFileSync(join(projectRoot, secondProposal.relativePath), 'utf8');
  assert.match(fullText, /title: Secret scan/, 'title from the slug');
  assert.match(fullText, /## Decision criteria[\s\S]*## Options[\s\S]*Do nothing/, 'criteria come before options, doing nothing included');
  const indexText = readFileSync(join(projectRoot, '.ai1', 'proposals', 'README.md'), 'utf8');
  assert.match(indexText, /\| \[0001\]\(0001-prod-guard\.md\) \| Guard writes to production \| idea \| draft \| 2026-11-08 \| 2026-11-08 \|/);
  assert.match(indexText, /\| \[0002\]\(0002-secret-scan\.md\) \| Secret scan \| full \| draft \|/);
  assert.deepEqual(checkProposals(projectRoot), []);
});

test('proposals new: refuses a bad slug, a repeated slug and an unknown size', () => {
  const projectRoot = createProposalRepo();
  assert.throws(() => createProposal(projectRoot, { slug: 'Bad_Slug' }), /lowercase words/);
  createProposal(projectRoot, { slug: 'prod-guard' });
  assert.throws(() => createProposal(projectRoot, { slug: 'prod-guard' }), /already uses the slug/);
  assert.throws(() => createProposal(projectRoot, { slug: 'other', size: 'huge' }), /size must be/);
});

test('proposals new: a title with a colon stays valid YAML and reads back intact', () => {
  const projectRoot = createProposalRepo();
  const { relativePath } = createProposal(projectRoot, { slug: 'doctor', title: 'ai1 doctor: audit a repo' });
  const proposalText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(proposalText, /^title: "ai1 doctor: audit a repo"$/m);
  assert.match(proposalText, /^# Proposal 0001: ai1 doctor: audit a repo$/m);
  assert.equal(listProposals(projectRoot)[0].title, 'ai1 doctor: audit a repo');
});

test('proposals set: dates, History line, superseded link and index', () => {
  const projectRoot = createProposalRepo();
  createProposal(projectRoot, { slug: 'prod-guard', size: 'idea', today: '2026-11-08' });
  createProposal(projectRoot, { slug: 'prod-guard-v2', today: '2026-11-08' });
  setProposalStatus(projectRoot, 1, 'accepted', { today: '2026-11-20' });
  setProposalStatus(projectRoot, 1, 'implemented', { today: '2026-12-01' });
  const [firstProposal] = listProposals(projectRoot);
  assert.equal(firstProposal.status, 'implemented');
  assert.equal(firstProposal.updated, '2026-12-01');
  assert.equal(firstProposal.decided, '2026-11-20', 'implemented keeps the date of the decision');
  assert.match(firstProposal.bodyText, /## History\n\n- 2026-11-08: created as an idea\n- 2026-11-20: status accepted\n- 2026-12-01: status implemented\n$/);
  assert.throws(() => setProposalStatus(projectRoot, 2, 'superseded'), /--by/);
  assert.throws(() => setProposalStatus(projectRoot, 7, 'draft'), /no proposal number 7/);
  assert.throws(() => setProposalStatus(projectRoot, 2, 'maybe'), /status must be/);
  setProposalStatus(projectRoot, 2, 'superseded', { supersededBy: 1, today: '2026-11-21' });
  assert.equal(listProposals(projectRoot)[1].supersededBy, 1);
  assert.match(readFileSync(join(projectRoot, '.ai1', 'proposals', 'README.md'), 'utf8'), /\| superseded by 0001 \|/);
});

test('proposals check: reports broken frontmatter, numbering, decisions and a stale index', () => {
  const projectRoot = createProposalRepo();
  createProposal(projectRoot, { slug: 'prod-guard', today: '2026-11-08' });
  const proposalDirectory = join(projectRoot, '.ai1', 'proposals');
  writeFileSync(join(proposalDirectory, '0001-copy.md'), '---\nproposal: 1\ntitle: Copy\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(proposalDirectory, '0003-loose.md'), '# no frontmatter\n');
  writeFileSync(join(proposalDirectory, '0004-wrong.md'), '---\nproposal: 5\ntitle: Wrong\nsize: big\nstatus: accepted\ncreated: yesterday\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(proposalDirectory, '0006-orphan.md'), '---\nproposal: 6\ntitle: Orphan\nsize: idea\nstatus: superseded\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  const problemsText = checkProposals(projectRoot).join('\n');
  assert.match(problemsText, /0001-prod-guard\.md: number 0001 is also used by \.ai1\/proposals\/0001-copy\.md/);
  assert.match(problemsText, /0003-loose\.md: no frontmatter/);
  assert.match(problemsText, /0004-wrong\.md: `proposal: 5` does not match the file number 4/);
  assert.match(problemsText, /0004-wrong\.md: `size` must be one of idea, full/);
  assert.match(problemsText, /0004-wrong\.md: `created` must be a date/);
  assert.match(problemsText, /0004-wrong\.md: status accepted needs `decided/);
  assert.match(problemsText, /0006-orphan\.md: status superseded needs `superseded_by/);
  assert.match(problemsText, /README\.md is out of date: run `ai1 proposals index`/);
});

test('proposals check: an accepted proposal must be cited by a bundle concept', () => {
  const projectRoot = createProposalRepo({ okf: true });
  addBundle(projectRoot);
  createProposal(projectRoot, { slug: 'prod-guard', size: 'idea' });
  setProposalStatus(projectRoot, 1, 'accepted');
  const bundleOptions = { knowledgePath: '.ai1/okf', bundleDirectory: join(projectRoot, '.ai1', 'okf') };
  assert.match(checkProposals(projectRoot, bundleOptions).join('\n'), /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/proposals/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  assert.deepEqual(checkProposals(projectRoot, bundleOptions), []);
});

test('proposals index: keeps what people wrote around the generated table', () => {
  const projectRoot = createProposalRepo();
  createProposal(projectRoot, { slug: 'prod-guard' });
  const indexPath = join(projectRoot, '.ai1', 'proposals', 'README.md');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('# Proposals', '# Proposals\n\nAsk the platform team before writing one.') + '\nFooter by hand.\n');
  createProposal(projectRoot, { slug: 'secret-scan' });
  const indexText = readFileSync(indexPath, 'utf8');
  assert.match(indexText, /Ask the platform team/);
  assert.match(indexText, /Footer by hand\./);
  assert.match(indexText, /0002-secret-scan/);
});

test('proposals-brief: the recipe and the open proposals; silent on resume; off by default', () => {
  const projectRoot = createProposalRepo();
  createProposal(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production' });
  createProposal(projectRoot, { slug: 'old-idea' });
  setProposalStatus(projectRoot, 2, 'rejected');
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /Proposals: large changes .* live in `\.ai1\/proposals\/`/);
  assert.match(contextText, /Never create a proposal on your own\. Create one when the person asks for it\. When, while working on one subject, a clearly different one comes up/);
  assert.match(contextText, /three ways .* do it here, in this conversation; fork it into a new conversation \(\/ai1:session-fork-conversation\); or save it as a proposal for later/);
  assert.match(contextText, /Act only on the way the person picks; a yes to a question that bundles several things is not a pick\. Never offer for details/);
  assert.match(contextText, /load \/ai1:proposals-write/);
  assert.match(contextText, /0001 "Guard writes to production" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /Old idea/, 'rejected proposals are not open');
  assert.doesNotMatch(startSession(projectRoot, hookOptions(), 'resume').hookSpecificOutput.additionalContext, /Proposals: large changes/);
  const plainRepo = createTemporaryProject({ features: { okf: false } });
  assert.doesNotMatch(startSession(plainRepo, hookOptions()).hookSpecificOutput.additionalContext, /Proposals: large changes/);
});

test('proposals-recall: a message about a proposal brings it back with its status', () => {
  const projectRoot = createProposalRepo();
  createProposal(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production databases' });
  createProposal(projectRoot, { slug: 'dark-mode', size: 'idea', title: 'Dark mode for the dashboard' });
  const recallOutput = sendPrompt(projectRoot, hookOptions(), 'retomemos lo del guard de production databases');
  const contextText = recallOutput.hookSpecificOutput.additionalContext;
  assert.match(contextText, /Proposals related to this request\. They are not decided/);
  assert.match(contextText, /\.ai1\/proposals\/0001-prod-guard\.md — Proposal 0001 "Guard writes to production databases" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /dark-mode/);
  assert.equal(sendPrompt(projectRoot, hookOptions(), '/ai1:proposals-write production databases'), null, 'slash commands are skipped');
});

test('proposals-upkeep: blocks once when the session left the proposals inconsistent, silent when untouched', () => {
  const projectRoot = createProposalRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null, 'nothing touched');
  createProposal(projectRoot, { slug: 'prod-guard' });
  assert.equal(stopSession(projectRoot, options), null, 'consistent');
  writeFileSync(join(projectRoot, '.ai1', 'proposals', '0001-prod-guard.md'), '# lost the frontmatter\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /ai1\/proposals-upkeep: Proposals: \.ai1\/proposals\/ needs attention[\s\S]*no frontmatter/);
  assert.equal(stopSession(projectRoot, options), null, 'the same problems are reported once');
});

test('proposals-upkeep: an accepted proposal not cited by the bundle blocks; a finished plan asks for implemented', () => {
  const projectRoot = createProposalRepo({ okf: true, lanes: true });
  addBundle(projectRoot);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
  const options = hookOptions();
  startSession(projectRoot, options);
  createProposal(projectRoot, { slug: 'prod-guard', size: 'idea', knowledgePath: '.ai1/okf' });
  setProposalStatus(projectRoot, 1, 'accepted', { knowledgePath: '.ai1/okf' });
  assert.match(stopSession(projectRoot, options).reason, /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/proposals/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  const planDirectory = join(projectRoot, '.ai1', 'work', 'prod-guard');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Prod guard\nstatus: done\nproposal: 1\n---\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.match(stopOutput.reason, /plan `\.ai1\/work\/prod-guard\/plan\.md` built from it is done.*ai1 proposals set 1 implemented/);
  assert.doesNotMatch(stopOutput.reason, /cites it/);
});

test('okf-upkeep does not ask to document proposal drafts when the proposals feature is on', () => {
  const stopAfterWritingAProposal = (proposalEnabled) => {
    const projectRoot = createProposalRepo({ okf: true, proposals: proposalEnabled });
    addBundle(projectRoot);
    runGit(projectRoot, ['add', '.']);
    runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
    const options = hookOptions();
    startSession(projectRoot, options);
    createProposal(projectRoot, { slug: 'prod-guard', knowledgePath: '.ai1/okf' });
    return stopSession(projectRoot, options);
  };
  assert.equal(stopAfterWritingAProposal(true), null);
  assert.match(stopAfterWritingAProposal(false).reason, /okf-upkeep[\s\S]*\.ai1\/proposals\/0001-prod-guard\.md/, 'without the feature a proposal is just another file');
});

test('lanes-gate lets proposals be written while a deep design waits for approval', () => {
  const projectRoot = createProposalRepo({ lanes: true });
  const options = hookOptions();
  startSession(projectRoot, options);
  const planDirectory = join(projectRoot, '.ai1', 'work', 'billing');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Billing\nstatus: draft\n---\n');
  const useWrite = (relativePath) => runHookEvent('PreToolUse', {
    session_id: 'session-1', cwd: projectRoot, tool_name: 'Write', tool_input: { file_path: join(projectRoot, relativePath), content: 'x' },
  }, options);
  assert.equal(useWrite('.ai1/proposals/0001-billing.md'), null);
  assert.equal(useWrite('app.js').hookSpecificOutput.permissionDecision, 'deny');
});

test('ai1 proposals CLI: new, set, index and check from inside the repo', () => {
  const projectRoot = createProposalRepo();
  const runCli = (cliArguments) => execFileSync('node', [AI1_CLI, 'proposals', ...cliArguments], { cwd: projectRoot, encoding: 'utf8' });
  assert.match(runCli(['new', 'prod-guard', '--idea', '--title', 'Guard writes to production']), /created \.ai1\/proposals\/0001-prod-guard\.md\nupdated \.ai1\/proposals\/README\.md/);
  assert.match(runCli(['set', '1', 'review']), /0001-prod-guard\.md: status review/);
  assert.match(runCli(['check']), /1 proposal\(s\) in \.ai1\/proposals\/, all consistent/);
  writeFileSync(join(projectRoot, '.ai1', 'proposals', 'README.md'), '# Proposals\n');
  assert.throws(() => runCli(['check']), (cliError) => cliError.status === 1 && /out of date/.test(cliError.stderr));
  assert.match(runCli(['index']), /wrote \.ai1\/proposals\/README\.md/);
  assert.match(runCli(['check']), /all consistent/);
  assert.throws(() => runCli(['new', 'Nope']), (cliError) => cliError.status === 1 && /lowercase words/.test(cliError.stderr));
  assert.match(runCli(['new', '--title', 'Options first', '--idea', 'options-first']), /created \.ai1\/proposals\/0002-options-first\.md/, 'options before the slug');
  assert.match(readFileSync(join(projectRoot, '.ai1', 'proposals', '0002-options-first.md'), 'utf8'), /^title: Options first$/m);
  assert.match(runCli(['set', '--by', '1', '2', 'superseded']), /0002-options-first\.md: status superseded/, 'options before the positionals of set');
});

test('createProposal writes titles with $ patterns as they are', () => {
  const projectRoot = createProposalRepo();
  const { relativePath } = createProposal(projectRoot, { slug: 'cost-cuts', title: "Save $& on $$ and $' costs", size: 'idea', today: '2026-11-09' });
  const proposalText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(proposalText, /^title: Save \$& on \$\$ and \$' costs$/m);
  assert.equal(listProposals(projectRoot)[0].title, "Save $& on $$ and $' costs");
});
