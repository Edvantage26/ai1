// The session start reaches the agent whole: a normal repo stays under 8,500 characters, well under the
// 9,500 budget of core/hook-io.mjs (Claude Code cuts at 10,000); in the worst case every rule text still
// arrives whole and only list items are left out, each list saying how many.
// Built with the real modules on a generated worst-case repo, so a brief that grows breaks this test,
// not a person's session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { MAX_FIELD_CHARACTERS } from '../src/core/hook-io.mjs';
import { KNOWN_FEATURE_IDS } from '../src/core/features.mjs';
import { createLaterEntry } from '../src/later/later-documents.mjs';
import { createTemporaryProject } from './helpers.mjs';

const SESSION_START_LIMIT = 8500;
const TRIM_MARKER = /more characters left out to stay under Claude Code's 10,000-character hook limit/;

function runGit(projectRoot, gitArguments) {
  execFileSync('git', gitArguments, { cwd: projectRoot, stdio: 'ignore' });
}

const longTitle = (label) => `${label} `.padEnd(100, 'x');

function createWorstCaseRepo() {
  const allFeatures = Object.fromEntries(KNOWN_FEATURE_IDS.filter((featureId) => featureId !== 'core').map((featureId) => [featureId, true]));
  const projectRoot = createTemporaryProject({
    version: 2,
    verify: ['npm test', 'npm run lint'],
    features: allFeatures,
    related: [
      { name: 'api', path: '../api', owns: ['the public REST contract'] },
      { name: 'worker', path: '../worker', owns: ['the ingest queue'] },
      { name: 'infra', remote: 'git@example.com:org/infra.git', owns: ['deploys'] },
    ],
  });
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
  mkdirSync(join(projectRoot, 'src'));
  writeFileSync(join(projectRoot, 'src', 'App.tsx'), 'export const App = () => null;\n');
  writeFileSync(join(projectRoot, 'CLAUDE.md'), `# Notes\n\n${Array.from({ length: 120 }, (_, lineNumber) => `- note ${lineNumber}`).join('\n')}\n`);
  const bundleDirectory = join(projectRoot, '.ai1', 'okf');
  mkdirSync(join(bundleDirectory, 'concepts'), { recursive: true });
  writeFileSync(join(bundleDirectory, 'index.md'), `---\nokf_version: "0.2"\n---\n# Index\n\n${'* [A concept](concepts/a.md) - what it holds, described at some length.\n'.repeat(150)}`);
  for (let conceptNumber = 0; conceptNumber < 12; conceptNumber += 1) {
    writeFileSync(join(bundleDirectory, 'concepts', `missing-${conceptNumber}.md`), `---\ntype: Service\ntitle: ${longTitle(`Concept ${conceptNumber}`)}\n---\nBody.\n`);
  }
  for (let planNumber = 0; planNumber < 5; planNumber += 1) {
    mkdirSync(join(projectRoot, '.ai1', 'work', `plan-${planNumber}`), { recursive: true });
    writeFileSync(join(projectRoot, '.ai1', 'work', `plan-${planNumber}`, 'plan.md'), `---\ntitle: ${longTitle(`Plan ${planNumber}`)}\nstatus: active\n---\n`);
  }
  runGit(projectRoot, ['init', '-q']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  for (let entryNumber = 0; entryNumber < 10; entryNumber += 1) {
    createLaterEntry(projectRoot, { slug: `idea-${entryNumber}`, title: longTitle(`Idea ${entryNumber}`), today: '2026-11-15' });
  }
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.json'), JSON.stringify({ skillOverrides: { 'ai1:later-write': 'user-invocable-only' } }));
  return projectRoot;
}

function createWorstCaseHome() {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  mkdirSync(join(homeDirectory, '.claude', 'plugins'), { recursive: true });
  writeFileSync(join(homeDirectory, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': true } }));
  writeFileSync(join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 2, plugins: { 'frontend-design@claude-plugins-official': [] } }));
  mkdirSync(join(homeDirectory, '.claude', 'skills', 'impeccable'), { recursive: true });
  writeFileSync(join(homeDirectory, '.claude', 'skills', 'impeccable', 'SKILL.md'), '---\nname: impeccable\n---\n');
  mkdirSync(join(homeDirectory, '.claude', 'skills', 'hallmark'), { recursive: true });
  writeFileSync(join(homeDirectory, '.claude', 'skills', 'hallmark', 'SKILL.md'), '---\nname: hallmark\n---\n');
  return homeDirectory;
}

// The session-start context and, for the failure message, the characters each module added (decision log).
function startSession(projectRoot, homeDirectory) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  const contextText = runHookEvent('SessionStart', { session_id: 'budget-session', cwd: projectRoot, source: 'startup' }, {
    environment: { CLAUDE_PLUGIN_DATA: dataDirectory },
    homeDirectory,
    reportInternalError: () => {},
  })?.hookSpecificOutput?.additionalContext || '';
  const stateDirectory = join(dataDirectory, 'state');
  const moduleSizes = readdirSync(stateDirectory).filter((fileName) => fileName.endsWith('.jsonl'))
    .flatMap((fileName) => readFileSync(join(stateDirectory, fileName), 'utf8').trim().split('\n').map((logLine) => JSON.parse(logLine)))
    .filter((logEntry) => logEntry.chars > 0)
    .map((logEntry) => `${logEntry.module} ${logEntry.chars}`).join(', ');
  return { contextText, sizeReport: `${contextText.length} characters (${moduleSizes})` };
}

test('the worst-case session start keeps every rule text whole; only list items are left out, each list saying how many [session-start-diet:S2]', () => {
  const { contextText, sizeReport } = startSession(createWorstCaseRepo(), createWorstCaseHome());
  assert.ok(contextText.length <= MAX_FIELD_CHARACTERS && !TRIM_MARKER.test(contextText), sizeReport);
  // The fixture really is the worst case: every conditional text is there, and its rules whole.
  for (const expectedText of [/Plugins that overlap with ai1/, /skills listed for this repo do not match/, /frontend-design skill is installed/,
    /impeccable skill is installed/, /hallmark skill is installed/, /Unfinished plans/, /Related repositories/, /CLAUDE\.md/,
    /Later is only on demand: an entry exists only when the person asks for it/, /never offered for fork or later/,
    /create one before the first edit/, /Close it yourself, without asking/, /deep: .*\/ai1:sizing-design-before-code/,
    /Ask the person only for what is truly delicate/, /Reuse:/, /Craft:/, /Design:/]) {
    assert.match(contextText, expectedText);
  }
  assert.match(contextText, /- \.\.\. and \d+ more in `\.ai1\/later\/README\.md`/, 'the later list says how many it left out');
  assert.match(contextText, /- \.\.\. and \d+ more in `\.ai1\/work\/`/, 'the plans list too');
  assert.match(contextText, /\[\.\.\. \d+ more lines of the index; read \.ai1\/okf\/index\.md\]/, 'and the index');
  assert.doesNotMatch(contextText, /x{61}/, 'long list titles are shortened (to 60 characters)');
});

// On a copy of what this repository versions for ai1, so the session's own plans and worktree do not count.
test('this repository\'s own session start fits under 8,500 characters without a cut [session-start-diet:S1]', () => {
  const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
  const copyRoot = mkdtempSync(join(tmpdir(), 'ai1-self-'));
  for (const versionedPath of ['.ai1/config.json', '.ai1/okf', '.ai1/later', 'CLAUDE.md', 'package.json', '.claude/settings.json', '.claude/skills']) {
    cpSync(join(repositoryRoot, versionedPath), join(copyRoot, versionedPath), { recursive: true });
  }
  const { contextText, sizeReport } = startSession(copyRoot, mkdtempSync(join(tmpdir(), 'ai1-home-')));
  assert.ok(contextText.length <= SESSION_START_LIMIT && !TRIM_MARKER.test(contextText), sizeReport);
});

test('a default repo session start fits under 8,500 characters without a cut [session-start-diet:S1]', () => {
  const projectRoot = createTemporaryProject({ version: 2, verify: ['npm test'] });
  writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }));
  const { contextText, sizeReport } = startSession(projectRoot, mkdtempSync(join(tmpdir(), 'ai1-home-')));
  assert.ok(contextText.length <= SESSION_START_LIMIT && !TRIM_MARKER.test(contextText), sizeReport);
});

test('a brief that no longer spells out a procedure names where it is, in the same line as the rule [session-start-diet:S4]', () => {
  const { contextText } = startSession(createWorstCaseRepo(), createWorstCaseHome());
  assert.match(contextText, /^- `ai1 worktree create <name>`, then EnterWorktree/m);
  assert.match(contextText, /^- When `ai1 worktree` reports a gap in the recipe.*\/ai1:worktrees-plan-recipe/m);
  assert.match(contextText, /^- deep: .*Load \/ai1:sizing-design-before-code/m);
  assert.match(contextText, /^- The subject the person is talking about.*load \/ai1:later-write\.$/m);
  assert.match(contextText, /^- Avoid the generic AI look.*The design-detect hook checks every UI file you edit/m);
});
