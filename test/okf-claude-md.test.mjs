import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { buildFileMap } from '../src/okf/okf-file-map.mjs';
import {
  splitClaudeMdSections, readClaudeMdReferences, checkClaudeMdFiles, formatClaudeMdReport, summarizeClaudeMdReports,
} from '../src/okf/okf-claude-md-check.mjs';
import { createTemporaryProject } from './helpers.mjs';

const BUNDLE_INDEX = '---\nokf_version: "0.2"\n---\n\n# Demo bundle\n';
const BILLING_CONCEPT = [
  '---', 'type: Component', 'title: Stripe billing webhooks', 'description: Invoices paid through Stripe checkout and confirmed by webhook.',
  'tags: [stripe, invoices]', 'sources:', '  - id: webhook', '    resource: backend/webhooks.py', '---', 'Body.', '',
].join('\n');
const FILLER_CONCEPTS = ['alpha', 'bravo', 'charlie', 'delta', 'echo'].map((conceptName) => [conceptName,
  `---\ntype: Component\ntitle: ${conceptName} module\ndescription: The ${conceptName} part.\n---\nBody.\n`]);

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function sectionOf(headingText, bodyLines) {
  return [`## ${headingText}`, ...bodyLines, ''];
}

// A git repo with a small bundle and the given CLAUDE.md files ({ path: text }).
function createRepoWithClaudeMd(claudeMdFiles) {
  const projectRoot = createTemporaryProject({});
  mkdirSync(join(projectRoot, '.ai1', 'okf'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), BUNDLE_INDEX);
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'billing.md'), BILLING_CONCEPT);
  for (const [conceptName, conceptText] of FILLER_CONCEPTS) writeFileSync(join(projectRoot, '.ai1', 'okf', `${conceptName}.md`), conceptText);
  mkdirSync(join(projectRoot, 'backend', 'app'), { recursive: true });
  writeFileSync(join(projectRoot, 'backend', 'webhooks.py'), 'pass\n');
  writeFileSync(join(projectRoot, 'backend', 'app', 'main.py'), 'pass\n');
  for (const [claudeMdPath, claudeMdText] of Object.entries(claudeMdFiles)) {
    mkdirSync(join(projectRoot, claudeMdPath, '..'), { recursive: true });
    writeFileSync(join(projectRoot, claudeMdPath), claudeMdText);
  }
  runGit(projectRoot, ['init', '-q']);
  return projectRoot;
}

function checkRepo(projectRoot) {
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  return checkClaudeMdFiles(projectRoot, bundleDirectory, buildFileMap(bundleDirectory, '.ai1/okf'));
}

function findingKinds(claudeMdReports) {
  return claudeMdReports.flatMap((claudeMdReport) => claudeMdReport.findings.map((finding) => finding.kind));
}

const SHORT_CLAUDE_MD = ['# Demo', 'Read `.ai1/okf/index.md` first.', '', ...sectionOf('Rules', ['- Run `npm test`.', '- Never commit secrets.'])].join('\n');

test('claude-md: sections split by heading, fenced headings ignored', () => {
  const claudeMdSections = splitClaudeMdSections(['intro', '# One', 'a', '```', '# not a heading', '```', '### Two', 'b'].join('\n'));
  assert.deepEqual(claudeMdSections.map((section) => [section.heading, section.line, section.endLine, section.contentLineCount]), [['', 1, 1, 1], ['One', 2, 6, 4], ['Two', 7, 8, 1]]);
});

test('claude-md: a short CLAUDE.md that points to the bundle has nothing to tidy', () => {
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': SHORT_CLAUDE_MD });
  assert.deepEqual(checkRepo(projectRoot), []);
  assert.equal(formatClaudeMdReport([]), 'CLAUDE.md: nothing to tidy.');
});

test('claude-md: an overlong file is too-long (and, without headings, one long section)', () => {
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': Array.from({ length: 90 }, (_, lineIndex) => `- rule ${lineIndex}`).join('\n') });
  assert.deepEqual(findingKinds(checkRepo(projectRoot)), ['too-long', 'knowledge-without-concept']);
});

test('claude-md: a section about a concept (keywords or a cited source path) duplicates it', () => {
  const byKeywords = sectionOf('Payments', ['Stripe checkout creates the invoices.', 'The webhook confirms them.', 'a', 'b', 'c', 'd']);
  const byPath = sectionOf('Hooks', ['Handlers live in `backend/webhooks.py`.', 'a', 'b', 'c', 'd', 'e']);
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': [...byKeywords, ...byPath].join('\n') });
  const [claudeMdReport] = checkRepo(projectRoot);
  assert.deepEqual(claudeMdReport.findings.map((finding) => [finding.kind, finding.section, finding.conceptPath]),
    [['duplicates-concept', 'Payments', 'billing.md'], ['duplicates-concept', 'Hooks', 'billing.md']]);
  assert.match(formatClaudeMdReport([claudeMdReport]), /CLAUDE\.md:1-8 duplicates-concept: section "Payments" overlaps \.ai1\/okf\/billing\.md \(Stripe billing webhooks\)/);
});

test('claude-md: a long section no concept covers is knowledge-without-concept; a short one is left alone', () => {
  const longSection = sectionOf('Deployment server', Array.from({ length: 12 }, (_, lineIndex) => `- server detail ${lineIndex}`));
  const shortSection = sectionOf('Style', ['- tabs', '- semicolons']);
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': [...longSection, ...shortSection].join('\n') });
  assert.deepEqual(findingKinds(checkRepo(projectRoot)), ['knowledge-without-concept']);
});

test('claude-md: missing paths and links are stale; subproject-relative, placeholder and non-path text is not', () => {
  const claudeMdText = [
    'Gone: `backend/old_module.py`, `missing/folder/`, [design](docs/design.md).',
    'Fine: `backend/webhooks.py`, `app/main.py` (subproject), `owner/repo`, `text/html`, `src/<name>.ts`, `@/components/ui/`, `C=/srv/x.py`, `~/notes.md`, [site](https://example.com).',
    '```', '`inside/fence.md`', '```',
  ].join('\n');
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': claudeMdText });
  const [claudeMdReport] = checkRepo(projectRoot);
  assert.deepEqual(claudeMdReport.findings.map((finding) => finding.reference), ['backend/old_module.py', 'missing/folder/', 'docs/design.md']);
});

test('claude-md: a file deleted from the checkout but still in the git index is stale (an old bundle path after a move)', () => {
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': SHORT_CLAUDE_MD, '.okf/old-concept.md': 'old\n' });
  runGit(projectRoot, ['add', '.']);
  rmSync(join(projectRoot, '.okf'), { recursive: true });
  writeFileSync(join(projectRoot, 'CLAUDE.md'), `${SHORT_CLAUDE_MD}\nSee \`.okf/old-concept.md\`.\n`);
  assert.deepEqual(checkRepo(projectRoot)[0].findings.map((finding) => finding.reference), ['.okf/old-concept.md']);
});

test('claude-md: nested CLAUDE.md files are checked with links relative to their folder', () => {
  const projectRoot = createRepoWithClaudeMd({
    'CLAUDE.md': SHORT_CLAUDE_MD,
    'backend/CLAUDE.md': 'See [the hook](webhooks.py) and [nothing](nothing.py).\n',
  });
  assert.deepEqual(checkRepo(projectRoot).map((claudeMdReport) => [claudeMdReport.path, claudeMdReport.findings.map((finding) => finding.reference)]),
    [['backend/CLAUDE.md', ['nothing.py']]]);
});

test('claude-md: references are read from backticks and relative links only', () => {
  assert.deepEqual(readClaudeMdReferences('`a/b.md` [x](c/d.md#top) [y](#anchor) `plain`').map((found) => found.reference), ['a/b.md', 'c/d.md']);
});

test('claude-md: the summary counts findings per kind', () => {
  const claudeMdReports = [{ path: 'CLAUDE.md', findings: [{ kind: 'too-long' }, { kind: 'duplicates-concept' }, { kind: 'stale-reference' }, { kind: 'stale-reference' }] }];
  assert.equal(summarizeClaudeMdReports(claudeMdReports), 'CLAUDE.md over 80 lines or 6000 characters; 1 section(s) overlap bundle concepts; 2 reference(s) no longer exist');
});

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function startSessionContext(projectRoot, options) {
  return JSON.stringify(runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot }, options) || {});
}

const DRIFTING_CLAUDE_MD = [SHORT_CLAUDE_MD, 'Old: `backend/old_module.py`.'].join('\n');

test('okf-claude-md hook: drift is told once, with the skill; the same findings stay silent', () => {
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': DRIFTING_CLAUDE_MD });
  const options = hookOptions();
  assert.match(startSessionContext(projectRoot, options), /ai1\/okf: CLAUDE\.md drifts from the bundle: 1 reference\(s\) no longer exist\. .*\/ai1:okf-tidy-claude-md/);
  assert.doesNotMatch(startSessionContext(projectRoot, options), /drifts from the bundle/);
  writeFileSync(join(projectRoot, 'CLAUDE.md'), `${DRIFTING_CLAUDE_MD}\nAlso: \`backend/gone.py\`.\n`);
  assert.match(startSessionContext(projectRoot, options), /2 reference\(s\) no longer exist/);
});

test('ai1 claude-md prints one line per finding, or JSON', () => {
  const projectRoot = createRepoWithClaudeMd({ 'CLAUDE.md': DRIFTING_CLAUDE_MD });
  const cliPath = fileURLToPath(new URL('../bin/ai1', import.meta.url));
  assert.equal(execFileSync(process.execPath, [cliPath, 'claude-md'], { cwd: projectRoot, encoding: 'utf8' }).trim(),
    'CLAUDE.md:8 stale-reference: `backend/old_module.py` does not exist');
  const [claudeMdReport] = JSON.parse(execFileSync(process.execPath, [cliPath, 'claude-md', '--json'], { cwd: projectRoot, encoding: 'utf8' }));
  assert.deepEqual(claudeMdReport.findings, [{ kind: 'stale-reference', line: 8, reference: 'backend/old_module.py' }]);
});

test('okf-claude-md hook: a tidy CLAUDE.md, or the okf feature off, says nothing', () => {
  const tidyRoot = createRepoWithClaudeMd({ 'CLAUDE.md': SHORT_CLAUDE_MD });
  assert.doesNotMatch(startSessionContext(tidyRoot, hookOptions()), /drifts from the bundle/);
  const featureOffRoot = createRepoWithClaudeMd({ 'CLAUDE.md': DRIFTING_CLAUDE_MD });
  writeFileSync(join(featureOffRoot, '.ai1', 'config.json'), JSON.stringify({ features: { okf: false, danger: true } }));
  assert.doesNotMatch(startSessionContext(featureOffRoot, hookOptions()), /drifts from the bundle/);
});
