import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createLaterEntry, setLaterEntryStatus, checkLaterEntries, listLaterEntries } from '../src/later/later-documents.mjs';
import { createTemporaryProject } from './helpers.mjs';

const AI1_CLI = fileURLToPath(new URL('../bin/ai1', import.meta.url));

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function createLaterEntryRepo(featureSettings = {}) {
  const projectRoot = createTemporaryProject({ features: { okf: false, later: true, ...featureSettings } });
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

test('later new: numbers from 0001, fills the template and writes the index', () => {
  const projectRoot = createLaterEntryRepo();
  const firstEntry = createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production', today: '2026-11-08' });
  const secondEntry = createLaterEntry(projectRoot, { slug: 'secret-scan', today: '2026-11-09' });
  assert.equal(firstEntry.relativePath, '.ai1/later/0001-prod-guard.md');
  assert.equal(secondEntry.relativePath, '.ai1/later/0002-secret-scan.md');
  const ideaText = readFileSync(join(projectRoot, firstEntry.relativePath), 'utf8');
  assert.match(ideaText, /^---\nnumber: 1\ntitle: Guard writes to production\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---/);
  assert.match(ideaText, /# Later 0001: Guard writes to production/);
  assert.doesNotMatch(ideaText, /{{/, 'no placeholder left');
  const fullText = readFileSync(join(projectRoot, secondEntry.relativePath), 'utf8');
  assert.match(fullText, /title: Secret scan/, 'title from the slug');
  assert.match(fullText, /## Decision criteria[\s\S]*## Options[\s\S]*Do nothing/, 'criteria come before options, doing nothing included');
  const indexText = readFileSync(join(projectRoot, '.ai1', 'later', 'README.md'), 'utf8');
  assert.match(indexText, /\| \[0001\]\(0001-prod-guard\.md\) \| Guard writes to production \| idea \| draft \| 2026-11-08 \| 2026-11-08 \|/);
  assert.match(indexText, /\| \[0002\]\(0002-secret-scan\.md\) \| Secret scan \| full \| draft \|/);
  assert.deepEqual(checkLaterEntries(projectRoot), []);
});

test('later new: refuses a bad slug, a repeated slug and an unknown size', () => {
  const projectRoot = createLaterEntryRepo();
  assert.throws(() => createLaterEntry(projectRoot, { slug: 'Bad_Slug' }), /lowercase words/);
  createLaterEntry(projectRoot, { slug: 'prod-guard' });
  assert.throws(() => createLaterEntry(projectRoot, { slug: 'prod-guard' }), /already uses the slug/);
  assert.throws(() => createLaterEntry(projectRoot, { slug: 'other', size: 'huge' }), /size must be/);
});

test('later new: a title with a colon stays valid YAML and reads back intact', () => {
  const projectRoot = createLaterEntryRepo();
  const { relativePath } = createLaterEntry(projectRoot, { slug: 'doctor', title: 'ai1 doctor: audit a repo' });
  const entryText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(entryText, /^title: "ai1 doctor: audit a repo"$/m);
  assert.match(entryText, /^# Later 0001: ai1 doctor: audit a repo$/m);
  assert.equal(listLaterEntries(projectRoot)[0].title, 'ai1 doctor: audit a repo');
});

test('later set: dates, History line, superseded link and index', () => {
  const projectRoot = createLaterEntryRepo();
  createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea', today: '2026-11-08' });
  createLaterEntry(projectRoot, { slug: 'prod-guard-v2', today: '2026-11-08' });
  setLaterEntryStatus(projectRoot, 1, 'accepted', { today: '2026-11-20' });
  setLaterEntryStatus(projectRoot, 1, 'implemented', { today: '2026-12-01' });
  const [firstEntry] = listLaterEntries(projectRoot);
  assert.equal(firstEntry.status, 'implemented');
  assert.equal(firstEntry.updated, '2026-12-01');
  assert.equal(firstEntry.decided, '2026-11-20', 'implemented keeps the date of the decision');
  assert.match(firstEntry.bodyText, /## History\n\n- 2026-11-08: created as an idea\n- 2026-11-20: status accepted\n- 2026-12-01: status implemented\n$/);
  assert.throws(() => setLaterEntryStatus(projectRoot, 2, 'superseded'), /--by/);
  assert.throws(() => setLaterEntryStatus(projectRoot, 7, 'draft'), /no later entry number 7/);
  assert.throws(() => setLaterEntryStatus(projectRoot, 2, 'maybe'), /status must be/);
  setLaterEntryStatus(projectRoot, 2, 'superseded', { supersededBy: 1, today: '2026-11-21' });
  assert.equal(listLaterEntries(projectRoot)[1].supersededBy, 1);
  assert.match(readFileSync(join(projectRoot, '.ai1', 'later', 'README.md'), 'utf8'), /\| superseded by 0001 \|/);
});

test('later check: reports broken frontmatter, numbering, decisions and a stale index', () => {
  const projectRoot = createLaterEntryRepo();
  createLaterEntry(projectRoot, { slug: 'prod-guard', today: '2026-11-08' });
  const laterDirectory = join(projectRoot, '.ai1', 'later');
  writeFileSync(join(laterDirectory, '0001-copy.md'), '---\nnumber: 1\ntitle: Copy\nsize: idea\nstatus: draft\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(laterDirectory, '0003-loose.md'), '# no frontmatter\n');
  writeFileSync(join(laterDirectory, '0004-wrong.md'), '---\nnumber: 5\ntitle: Wrong\nsize: big\nstatus: accepted\ncreated: yesterday\nupdated: 2026-11-08\n---\n');
  writeFileSync(join(laterDirectory, '0006-orphan.md'), '---\nnumber: 6\ntitle: Orphan\nsize: idea\nstatus: superseded\ncreated: 2026-11-08\nupdated: 2026-11-08\n---\n');
  const problemsText = checkLaterEntries(projectRoot).join('\n');
  assert.match(problemsText, /0001-prod-guard\.md: number 0001 is also used by \.ai1\/later\/0001-copy\.md/);
  assert.match(problemsText, /0003-loose\.md: no frontmatter/);
  assert.match(problemsText, /0004-wrong\.md: `number: 5` does not match the file number 4/);
  assert.match(problemsText, /0004-wrong\.md: `size` must be one of idea, full/);
  assert.match(problemsText, /0004-wrong\.md: `created` must be a date/);
  assert.match(problemsText, /0004-wrong\.md: status accepted needs `decided/);
  assert.match(problemsText, /0006-orphan\.md: status superseded needs `superseded_by/);
  assert.match(problemsText, /README\.md is out of date: run `ai1 later index`/);
});

test('later check: an accepted entry must be cited by a bundle concept', () => {
  const projectRoot = createLaterEntryRepo({ okf: true });
  addBundle(projectRoot);
  createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea' });
  setLaterEntryStatus(projectRoot, 1, 'accepted');
  const bundleOptions = { knowledgePath: '.ai1/okf', bundleDirectory: join(projectRoot, '.ai1', 'okf') };
  assert.match(checkLaterEntries(projectRoot, bundleOptions).join('\n'), /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/later/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  assert.deepEqual(checkLaterEntries(projectRoot, bundleOptions), []);
});

test('later index: keeps what people wrote around the generated table', () => {
  const projectRoot = createLaterEntryRepo();
  createLaterEntry(projectRoot, { slug: 'prod-guard' });
  const indexPath = join(projectRoot, '.ai1', 'later', 'README.md');
  writeFileSync(indexPath, readFileSync(indexPath, 'utf8').replace('# Later', '# Later\n\nAsk the platform team before writing one.') + '\nFooter by hand.\n');
  createLaterEntry(projectRoot, { slug: 'secret-scan' });
  const indexText = readFileSync(indexPath, 'utf8');
  assert.match(indexText, /Ask the platform team/);
  assert.match(indexText, /Footer by hand\./);
  assert.match(indexText, /0002-secret-scan/);
});

test('later-brief: the recipe and the open entries; silent on resume; off with features.later false', () => {
  const projectRoot = createLaterEntryRepo();
  createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production' });
  createLaterEntry(projectRoot, { slug: 'old-idea' });
  setLaterEntryStatus(projectRoot, 2, 'rejected');
  const contextText = startSession(projectRoot, hookOptions()).hookSpecificOutput.additionalContext;
  assert.match(contextText, /Later: large changes .* noted down for later in `\.ai1\/later\/`/);
  assert.match(contextText, /"acepto la propuesta" in the conversation mean your own proposal in this conversation \(answer it, or build it by its size\), never this feature/);
  assert.match(contextText, /Never note one down on your own\. Do it when the person asks \("apúntalo para luego"/);
  assert.match(contextText, /mention it in one line at the end of your report with the way you recommend: do it here, fork it into a new conversation \(\/ai1:session-fork-conversation\) or note it down for later/);
  assert.match(contextText, /do not stop to ask, and a yes means the way you recommended\. A small fix you found on the way is done here without asking\. The subject the person is talking about is never offered for later or fork, however large: the default is to build it now/);
  assert.match(contextText, /accept, reject or resume one the person names by number, load \/ai1:later-write/);
  assert.match(contextText, /0001 "Guard writes to production" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /Old idea/, 'rejected entries are not open');
  assert.doesNotMatch(startSession(projectRoot, hookOptions(), 'resume').hookSpecificOutput.additionalContext, /Later: large changes/);
  const plainRepo = createTemporaryProject({ features: { okf: false, later: false } });
  assert.doesNotMatch(startSession(plainRepo, hookOptions()).hookSpecificOutput.additionalContext, /Later: large changes/);
});

test('later-recall: a message about an entry brings it back with its status', () => {
  const projectRoot = createLaterEntryRepo();
  createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea', title: 'Guard writes to production databases' });
  createLaterEntry(projectRoot, { slug: 'dark-mode', size: 'idea', title: 'Dark mode for the dashboard' });
  const recallOutput = sendPrompt(projectRoot, hookOptions(), 'retomemos lo del guard de production databases');
  const contextText = recallOutput.hookSpecificOutput.additionalContext;
  assert.match(contextText, /Later entries related to this request\. They are not decided/);
  assert.match(contextText, /\.ai1\/later\/0001-prod-guard\.md — Later 0001 "Guard writes to production databases" \(idea, draft\)/);
  assert.doesNotMatch(contextText, /dark-mode/);
  assert.equal(sendPrompt(projectRoot, hookOptions(), '/ai1:later-write production databases'), null, 'slash commands are skipped');
});

test('later-upkeep: blocks once when the session left the later entries inconsistent, silent when untouched', () => {
  const projectRoot = createLaterEntryRepo();
  const options = hookOptions();
  startSession(projectRoot, options);
  assert.equal(stopSession(projectRoot, options), null, 'nothing touched');
  createLaterEntry(projectRoot, { slug: 'prod-guard' });
  assert.equal(stopSession(projectRoot, options), null, 'consistent');
  writeFileSync(join(projectRoot, '.ai1', 'later', '0001-prod-guard.md'), '# lost the frontmatter\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /ai1\/later-upkeep: Later: \.ai1\/later\/ needs attention[\s\S]*no frontmatter/);
  assert.equal(stopSession(projectRoot, options), null, 'the same problems are reported once');
});

test('later-upkeep: an accepted entry not cited by the bundle blocks; a finished plan asks for implemented', () => {
  const projectRoot = createLaterEntryRepo({ okf: true, sizing: true });
  addBundle(projectRoot);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
  const options = hookOptions();
  startSession(projectRoot, options);
  createLaterEntry(projectRoot, { slug: 'prod-guard', size: 'idea', knowledgePath: '.ai1/okf' });
  setLaterEntryStatus(projectRoot, 1, 'accepted', { knowledgePath: '.ai1/okf' });
  assert.match(stopSession(projectRoot, options).reason, /accepted but no concept in \.ai1\/okf\/ cites it/);
  addBundle(projectRoot, '---\ntype: Decision\nsources:\n  - resource: .ai1/later/0001-prod-guard.md\n---\n\nGuard prod writes.\n');
  const planDirectory = join(projectRoot, '.ai1', 'work', 'prod-guard');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Prod guard\nstatus: done\nlater: 1\n---\n');
  const stopOutput = stopSession(projectRoot, options);
  assert.match(stopOutput.reason, /plan `\.ai1\/work\/prod-guard\/plan\.md` built from it is done.*ai1 later set 1 implemented/);
  assert.doesNotMatch(stopOutput.reason, /cites it/);
});

test('okf-upkeep does not ask to document later entries when the later feature is on', () => {
  const stopAfterWritingAnEntry = (laterEnabled) => {
    const projectRoot = createLaterEntryRepo({ okf: true, later: laterEnabled });
    addBundle(projectRoot);
    runGit(projectRoot, ['add', '.']);
    runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'bundle']);
    const options = hookOptions();
    startSession(projectRoot, options);
    createLaterEntry(projectRoot, { slug: 'prod-guard', knowledgePath: '.ai1/okf' });
    return stopSession(projectRoot, options);
  };
  assert.equal(stopAfterWritingAnEntry(true), null);
  assert.match(stopAfterWritingAnEntry(false).reason, /okf-upkeep[\s\S]*\.ai1\/later\/0001-prod-guard\.md/, 'without the feature an entry is just another file');
});

test('sizing-gate lets later entries be written while a deep design waits for approval', () => {
  const projectRoot = createLaterEntryRepo({ sizing: true });
  const options = hookOptions();
  startSession(projectRoot, options);
  const planDirectory = join(projectRoot, '.ai1', 'work', 'billing');
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(join(planDirectory, 'plan.md'), '---\ntitle: Billing\nstatus: draft\n---\n');
  const useWrite = (relativePath) => runHookEvent('PreToolUse', {
    session_id: 'session-1', cwd: projectRoot, tool_name: 'Write', tool_input: { file_path: join(projectRoot, relativePath), content: 'x' },
  }, options);
  assert.equal(useWrite('.ai1/later/0001-billing.md'), null);
  assert.equal(useWrite('app.js').hookSpecificOutput.permissionDecision, 'deny');
});

test('ai1 later CLI: new, set, index and check from inside the repo', () => {
  const projectRoot = createLaterEntryRepo();
  const runCli = (cliArguments) => execFileSync('node', [AI1_CLI, 'later', ...cliArguments], { cwd: projectRoot, encoding: 'utf8' });
  assert.match(runCli(['new', 'prod-guard', '--idea', '--title', 'Guard writes to production']), /created \.ai1\/later\/0001-prod-guard\.md\nupdated \.ai1\/later\/README\.md/);
  assert.match(runCli(['set', '1', 'review']), /0001-prod-guard\.md: status review/);
  assert.match(runCli(['check']), /1 later entr\(y\/ies\) in \.ai1\/later\/, all consistent/);
  writeFileSync(join(projectRoot, '.ai1', 'later', 'README.md'), '# Later\n');
  assert.throws(() => runCli(['check']), (cliError) => cliError.status === 1 && /out of date/.test(cliError.stderr));
  assert.match(runCli(['index']), /wrote \.ai1\/later\/README\.md/);
  assert.match(runCli(['check']), /all consistent/);
  assert.throws(() => runCli(['new', 'Nope']), (cliError) => cliError.status === 1 && /lowercase words/.test(cliError.stderr));
  assert.match(runCli(['new', '--title', 'Options first', '--idea', 'options-first']), /created \.ai1\/later\/0002-options-first\.md/, 'options before the slug');
  assert.match(readFileSync(join(projectRoot, '.ai1', 'later', '0002-options-first.md'), 'utf8'), /^title: Options first$/m);
  assert.match(runCli(['set', '--by', '1', '2', 'superseded']), /0002-options-first\.md: status superseded/, 'options before the positionals of set');
});

test('createLaterEntry writes titles with $ patterns as they are', () => {
  const projectRoot = createLaterEntryRepo();
  const { relativePath } = createLaterEntry(projectRoot, { slug: 'cost-cuts', title: "Save $& on $$ and $' costs", size: 'idea', today: '2026-11-09' });
  const entryText = readFileSync(join(projectRoot, relativePath), 'utf8');
  assert.match(entryText, /^title: Save \$& on \$\$ and \$' costs$/m);
  assert.equal(listLaterEntries(projectRoot)[0].title, "Save $& on $$ and $' costs");
});

test('later-write: "propuesta" in the conversation never loads the skill; noting down for later does', () => {
  const skillText = readFileSync(fileURLToPath(new URL('../skills/later-write/SKILL.md', import.meta.url)), 'utf8');
  const skillDescription = /^description: (.*)$/m.exec(skillText)[1];
  assert.match(skillDescription, /"apúntalo para luego"/);
  assert.match(skillDescription, /NOT when the person says "propuesta", "proposal", "proponme algo", "hazme una propuesta" or "acepto la propuesta"/);
  assert.doesNotMatch(skillDescription.split('NOT when')[0], /propuesta|proposal/i, 'no trigger phrase before the exclusion mentions a proposal');
  assert.match(skillText, /## First: is this skill the right one\?/);
});
