import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createRfc, setRfcStatus, checkRfcs, listRfcs } from '../src/rfc/rfc-documents.mjs';
import { createTemporaryProject } from './helpers.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createRfcRepo(featureSettings = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false, rfc: true, ...featureSettings } });
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

test('rfc new: numbers from 0001, fills the template and writes the index', () => {
  const projectRoot = createRfcRepo();
  const firstRfc = createRfc(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production', today: '2026-11-08' });
  const secondRfc = createRfc(projectRoot, { slug: 'secret-scan', today: '2026-11-09' });
  assert.equal(firstRfc.relativePath, '.ai1/rfc/0001-prod-guard.md');
  assert.equal(secondRfc.relativePath, '.ai1/rfc/0002-secret-scan.md');
  const ideaText = readFileSync(join(projectRoot, firstRfc.relativePath), 'utf8');
  assert.match(ideaText, /^---\nrfc: 1\ntitle: Guard writes to production\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---/);
  assert.match(ideaText, /# RFC 0001: Guard writes to production/);
  assert.doesNotMatch(ideaText, /{{/, 'no placeholder left');
  const fullText = readFileSync(join(projectRoot, secondRfc.relativePath), 'utf8');
  assert.match(fullText, /title: Secret scan/, 'title from the slug');
  assert.match(fullText, /## Decision criteria[\s\S]*## Options[\s\S]*Do nothing/, 'criteria come before options, doing nothing included');
  const indexText = readFileSync(join(projectRoot, '.ai1', 'rfc', 'README.md'), 'utf8');
  assert.match(indexText, /\| \[0001\]\(0001-prod-guard\.md\) \| Guard writes to production \| idea \| draft \| 2026-11-08 \| 2026-11-08 \|/);
  assert.match(indexText, /\| \[0002\]\(0002-secret-scan\.md\) \| Secret scan \| full \| draft \|/);
  assert.deepEqual(checkRfcs(projectRoot), []);
});

test('rfc new: refuses a bad slug, a repeated slug and an unknown size', () => {
  const projectRoot = createRfcRepo();
  assert.throws(() => createRfc(projectRoot, { slug: 'Bad_Slug' }), /lowercase words/);
  createRfc(projectRoot, { slug: 'prod-guard' });
  assert.throws(() => createRfc(projectRoot, { slug: 'prod-guard' }), /already uses the slug/);
  assert.throws(() => createRfc(projectRoot, { slug: 'other', size: 'huge' }), /size must be/);
});

test('rfc new: a title with a colon stays valid YAML and reads back intact', () => {
  const projectRoot = createRfcRepo();
  const { relativePath } = createRfc(projectRoot, { slug: 'doctor', title: 'ai1 doctor: audit a repo' });
  const rfcText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(rfcText, /^title: "ai1 doctor: audit a repo"$/m);
  assert.match(rfcText, /^# RFC 0001: ai1 doctor: audit a repo$/m);
  assert.equal(listRfcs(projectRoot)[0].title, 'ai1 doctor: audit a repo');
});

test('rfc set: dates, History line, superseded link and index', () => {
  const projectRoot = createRfcRepo();
  createRfc(projectRoot, { slug: 'prod-guard', size: 'idea', today: '2026-11-08' });
  createRfc(projectRoot, { slug: 'prod-guard-v2', today: '2026-11-08' });
  setRfcStatus(projectRoot, 1, 'accepted', { today: '2026-11-20' });
  setRfcStatus(projectRoot, 1, 'implemented', { today: '2026-12-01' });
  const [firstRfc] = listRfcs(projectRoot);
  assert.equal(firstRfc.status, 'implemented');
  assert.equal(firstRfc.updated, '2026-12-01');
  assert.equal(firstRfc.decided, '2026-11-20', 'implemented keeps the date of the decision');
  assert.match(firstRfc.bodyText, /## History\n\n- 2026-11-08: created as an idea\n- 2026-11-20: status accepted\n- 2026-12-01: status implemented\n$/);
  assert.throws(() => setRfcStatus(projectRoot, 2, 'superseded'), /--by/);
  assert.throws(() => setRfcStatus(projectRoot, 7, 'draft'), /no RFC number 7/);
  assert.throws(() => setRfcStatus(projectRoot, 2, 'maybe'), /status must be/);
  setRfcStatus(projectRoot, 2, 'superseded', { supersededBy: 1, today: '2026-11-21' });
  assert.equal(listRfcs(projectRoot)[1].supersededBy, 1);
  assert.match(readFileSync(join(projectRoot, '.ai1', 'rfc', 'README.md'), 'utf8'), /\| superseded by 0001 \|/);
});

test('rfc check: reports broken frontmatter, numbering, decisions and a stale index', () => {
  const projectRoot = createRfcRepo();
  createRfc(projectRoot, { slug: 'prod-guard', today: '2026-11-08' });
  const rfcDirectory = join(projectRoot, '.ai1', 'rfc');
  writeFileSync(join(rfcDirectory, '0001-copy.md'), '---\nrfc: 1\ntitle: Copy\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(rfcDirectory, '0003-loose.md'), '# no frontmatter\n');
  writeFileSync(join(rfcDirectory, '0004-wrong.md'), '---\nrfc: 5\ntitle: Wrong\nsize: big\nstatus: accepted\ncreated: yesterday\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(rfcDirectory, '0006-orphan.md'), '---\nrfc: 6\ntitle: Orphan\nsize: idea\nstatus: superseded\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  const problemsText = checkRfcs(projectRoot).join('\n');
  assert.match(problemsText, /0001-prod-guard\.md: number 0001 is also used by \.ai1\/rfc\/0001-copy\.md/);
  assert.match(problemsText, /0003-loose\.md: no frontmatter/);
  assert.match(problemsText, /0004-wrong\.md: `rfc: 5` does not match the file number 4/);
  assert.match(problemsText, /0004-wrong\.md: `size` must be one of idea, full/);
  assert.match(problemsText, /0004-wrong\.md: `created` must be a date/);
  assert.match(problemsText, /0004-wrong\.md: status accepted needs `decided/);
  assert.match(problemsText, /0006-orphan\.md: status superseded needs `superseded_by/);
  assert.match(problemsText, /README\.md is out of date: run `ai1 rfc index`/);
});

test('rfc check: an accepted RFC must be cited by a bundle concept', () => {
  const projectRoot = createRfcRepo({ okf: true });
  addBundle(projectRoot);
  createRfc(projectRoot, { slug: 'prod-guard', size: 'idea' });
  setRfcStatus(projectRoot, 1, 'accepted');
  const bundleOptions = { knowledgePath: '.ai1/okf', bundleDirectory: join(projectRoot, '.ai1', 'okf') };
  assert.match(checkRfcs(projectRoot, bundleOptions).join('\n'), /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/rfc/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  assert.deepEqual(checkRfcs(projectRoot, bundleOptions), []);
});

test('rfc index: keeps what people wrote around the generated table', () => {
  const projectRoot = createRfcRepo();
  createRfc(projectRoot, { slug: 'prod-guard' });
  const indexPath = join(projectRoot, '.ai1', 'rfc', 'README.md');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('# RFCs', '# RFCs\n\nAsk the platform team before writing one.') + '\nFooter by hand.\n');
  createRfc(projectRoot, { slug: 'secret-scan' });
  const indexText = readFileSync(indexPath, 'utf8');
  assert.match(indexText, /Ask the platform team/);
  assert.match(indexText, /Footer by hand\./);
  assert.match(indexText, /0002-secret-scan/);
});

test('rfc-brief: the recipe and the open RFCs; silent on resume; off by default', () => {
  const projectRoot = createRfcRepo();
  createRfc(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production' });
  createRfc(projectRoot, { slug: 'old-idea' });
  setRfcStatus(projectRoot, 2, 'rejected');
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /RFCs: proposals .* live in `\.ai1\/rfc\/`/);
  assert.match(contextText, /load \/ai1:rfc-write-proposal/);
  assert.match(contextText, /0001 "Guard writes to production" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /Old idea/, 'rejected RFCs are not open');
  assert.doesNotMatch(startSession(projectRoot, hookOptions(), 'resume').hookSpecificOutput.additionalContext, /RFCs:/);
  const plainRepo = createTemporaryProject({ features: { okf: false } });
  assert.doesNotMatch(startSession(plainRepo, hookOptions()).hookSpecificOutput.additionalContext, /RFCs:/);
});

test('rfc-recall: a message about a proposal brings it back with its status', () => {
  const projectRoot = createRfcRepo();
  createRfc(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production databases' });
  createRfc(projectRoot, { slug: 'dark-mode', size: 'idea', title: 'Dark mode for the dashboard' });
  const recallOutput = sendPrompt(projectRoot, hookOptions(), 'retomemos lo del guard de production databases');
  const contextText = recallOutput.hookSpecificOutput.additionalContext;
  assert.match(contextText, /They are proposals/);
  assert.match(contextText, /\.ai1\/rfc\/0001-prod-guard\.md — RFC 0001 "Guard writes to production databases" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /dark-mode/);
  assert.equal(sendPrompt(projectRoot, hookOptions(), '/ai1:rfc-write-proposal production databases'), null, 'slash commands are skipped');
});

test('rfc-upkeep: blocks once when the session left the RFCs inconsistent, silent when untouched', () => {
  const projectRoot = createRfcRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null, 'nothing touched');
  createRfc(projectRoot, { slug: 'prod-guard' });
  assert.equal(stopSession(projectRoot, options), null, 'consistent');
  writeFileSync(join(projectRoot, '.ai1', 'rfc', '0001-prod-guard.md'), '# lost the frontmatter\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /ai1\/rfc-upkeep: RFCs: \.ai1\/rfc\/ needs attention[\s\S]*no frontmatter/);
  assert.equal(stopSession(projectRoot, options), null, 'the same problems are reported once');
});

test('rfc-upkeep: an accepted RFC not cited by the bundle blocks; a finished plan asks for implemented', () => {
  const projectRoot = createRfcRepo({ okf: true, lanes: true });
  addBundle(projectRoot);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
  const options = hookOptions();
  startSession(projectRoot, options);
  createRfc(projectRoot, { slug: 'prod-guard', size: 'idea', knowledgePath: '.ai1/okf' });
  setRfcStatus(projectRoot, 1, 'accepted', { knowledgePath: '.ai1/okf' });
  assert.match(stopSession(projectRoot, options).reason, /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/rfc/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  const planDirectory = join(projectRoot, '.ai1', 'work', 'prod-guard');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Prod guard\nstatus: done\nrfc: 1\n---\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.match(stopOutput.reason, /plan `\.ai1\/work\/prod-guard\/plan\.md` built from it is done.*ai1 rfc set 1 implemented/);
  assert.doesNotMatch(stopOutput.reason, /cites it/);
});

test('okf-upkeep does not ask to document RFC drafts when the rfc feature is on', () => {
  const stopAfterWritingAnRfc = (rfcEnabled) => {
    const projectRoot = createRfcRepo({ okf: true, rfc: rfcEnabled });
    addBundle(projectRoot);
    runGit(projectRoot, ['add', '.']);
    runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
    const options = hookOptions();
    startSession(projectRoot, options);
    createRfc(projectRoot, { slug: 'prod-guard', knowledgePath: '.ai1/okf' });
    return stopSession(projectRoot, options);
  };
  assert.equal(stopAfterWritingAnRfc(true), null);
  assert.match(stopAfterWritingAnRfc(false).reason, /okf-upkeep[\s\S]*\.ai1\/rfc\/0001-prod-guard\.md/, 'without the feature an RFC is just another file');
});

test('lanes-gate lets RFCs be written while a deep design waits for approval', () => {
  const projectRoot = createRfcRepo({ lanes: true });
  const options = hookOptions();
  startSession(projectRoot, options);
  const planDirectory = join(projectRoot, '.ai1', 'work', 'billing');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Billing\nstatus: draft\n---\n');
  const useWrite = (relativePath) => runHookEvent('PreToolUse', {
    session_id: 'session-1', cwd: projectRoot, tool_name: 'Write', tool_input: { file_path: join(projectRoot, relativePath), content: 'x' },
  }, options);
  assert.equal(useWrite('.ai1/rfc/0001-billing.md'), null);
  assert.equal(useWrite('app.js').hookSpecificOutput.permissionDecision, 'deny');
});

test('ai1 rfc CLI: new, set, index and check from inside the repo', () => {
  const projectRoot = createRfcRepo();
  const runCli = (cliArguments) => execFileSync('node', [AI1_CLI, 'rfc', ...cliArguments], { cwd: projectRoot, encoding: 'utf8' });
  assert.match(runCli(['new', 'prod-guard', '--idea', '--title', 'Guard writes to production']), /created \.ai1\/rfc\/0001-prod-guard\.md\nupdated \.ai1\/rfc\/README\.md/);
  assert.match(runCli(['set', '1', 'review']), /0001-prod-guard\.md: status review/);
  assert.match(runCli(['check']), /1 RFC\(s\) in \.ai1\/rfc\/, all consistent/);
  writeFileSync(join(projectRoot, '.ai1', 'rfc', 'README.md'), '# RFCs\n');
  assert.throws(() => runCli(['check']), (cliError) => cliError.status === 1 && /out of date/.test(cliError.stderr));
  assert.match(runCli(['index']), /wrote \.ai1\/rfc\/README\.md/);
  assert.match(runCli(['check']), /all consistent/);
  assert.throws(() => runCli(['new', 'Nope']), (cliError) => cliError.status === 1 && /lowercase words/.test(cliError.stderr));
});

test('createRfc writes titles with $ patterns as they are', () => {
  const projectRoot = createRfcRepo();
  const { relativePath } = createRfc(projectRoot, { slug: 'cost-cuts', title: "Save $& on $$ and $' costs", size: 'idea', today: '2026-11-09' });
  const rfcText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(rfcText, /^title: Save \$& on \$\$ and \$' costs$/m);
  assert.equal(listRfcs(projectRoot)[0].title, "Save $& on $$ and $' costs");
});
