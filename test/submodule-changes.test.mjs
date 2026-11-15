import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { listFilesChangedSinceBase, readSessionBase } from '../src/core/session-base.mjs';

const SECOND = 1000;

function runGit(repoRoot, gitArguments) {
  return execFileSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'protocol.file.allow=always', ...gitArguments], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function createRepository(parentDirectory, repoName, extraFiles = {}) {
  const repoRoot = join(parentDirectory, repoName);
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, 'src', 'app.js'), 'console.log(1);\n');
  for (const [relativePath, fileText] of Object.entries(extraFiles)) {
    mkdirSync(join(repoRoot, relativePath, '..'), { recursive: true });
    writeFileSync(join(repoRoot, relativePath), fileText);
  }
  runGit(repoRoot, ['init', '-q']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-qm', 'init']);
  return repoRoot;
}

// A superproject with one ai1 config (verify on), a submodule `child` that has its own submodule `commons`.
function createSuperproject() {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-super-')));
  const commonsSource = createRepository(workspaceRoot, 'commons-source');
  const childSource = createRepository(workspaceRoot, 'child-source');
  runGit(childSource, ['submodule', 'add', '-q', commonsSource, 'commons']);
  runGit(childSource, ['commit', '-qm', 'add commons']);
  const superRoot = createRepository(workspaceRoot, 'super', { '.ai1/config.json': JSON.stringify({ features: { okf: false }, verify: ['npm test'] }), '.gitignore': '.ai1/work/\n' });
  runGit(superRoot, ['submodule', 'add', '-q', childSource, 'child']);
  runGit(superRoot, ['commit', '-qm', 'add child']);
  runGit(superRoot, ['submodule', 'update', '--init', '--recursive', '-q']);
  return { workspaceRoot, superRoot };
}

test('files changed inside submodules, nested ones too, are listed by their path from the superproject [foreign-repo-delegation:S4]', () => {
  const { superRoot } = createSuperproject();
  const baseHead = runGit(superRoot, ['rev-parse', 'HEAD']);
  const childRoot = join(superRoot, 'child');
  writeFileSync(join(childRoot, 'src', 'feature.js'), 'export const feature = 1;\n');
  runGit(childRoot, ['add', '.']);
  runGit(childRoot, ['commit', '-qm', 'feature']);
  writeFileSync(join(childRoot, 'commons', 'src', 'app.js'), 'console.log(2);\n');
  writeFileSync(join(superRoot, 'NOTES.md'), 'notes\n');
  assert.deepEqual(listFilesChangedSinceBase(superRoot, baseHead).sort(), ['NOTES.md', 'child/commons/src/app.js', 'child/src/feature.js']);
});

test('a repo without submodules gets exactly the plain git lists [foreign-repo-delegation:S4]', () => {
  const workspaceRoot = realpathSync(mkdtempSync(join(tmpdir(), 'ai1-plain-')));
  const repoRoot = createRepository(workspaceRoot, 'plain');
  const baseHead = runGit(repoRoot, ['rev-parse', 'HEAD']);
  writeFileSync(join(repoRoot, 'src', 'app.js'), 'console.log(3);\n');
  writeFileSync(join(repoRoot, 'new.js'), '1\n');
  const plainLists = [...new Set([...runGit(repoRoot, ['diff', '--name-only', baseHead]).split('\n'), ...runGit(repoRoot, ['ls-files', '--others', '--exclude-standard']).split('\n')])].filter(Boolean);
  assert.deepEqual(listFilesChangedSinceBase(repoRoot, baseHead), plainLists);
});

test('verify-gate blocks finishing after a change inside a submodule, naming it from the superproject [foreign-repo-delegation:S4]', () => {
  const { superRoot } = createSuperproject();
  const options = {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')), AI1_DECISION_LOG: '0' },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: superRoot, source: 'startup' }, options);
  const sessionStart = Date.now();
  const changedPath = join(superRoot, 'child', 'commons', 'src', 'app.js');
  writeFileSync(changedPath, 'console.log(4);\n');
  utimesSync(changedPath, (sessionStart + 10 * SECOND) / SECOND, (sessionStart + 10 * SECOND) / SECOND);
  const transcriptPath = join(options.homeDirectory, 'transcript.jsonl');
  writeFileSync(transcriptPath, `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-edit', name: 'Edit', input: { file_path: changedPath } }] } })}\n`);
  const stopOutput = runHookEvent('Stop', { session_id: 'session-1', cwd: superRoot, transcript_path: transcriptPath }, options);
  assert.equal(stopOutput.decision, 'block');
  assert.match(stopOutput.reason, /`child\/commons\/src\/app\.js`/);
});

test('what a submodule was already ahead of the parent before the session is not a change of the session [foreign-repo-delegation:S4]', () => {
  const { workspaceRoot, superRoot } = createSuperproject();
  const childRoot = join(superRoot, 'child');
  writeFileSync(join(childRoot, 'src', 'old-work.js'), 'export const oldWork = 1;\n');
  runGit(childRoot, ['add', '.']);
  runGit(childRoot, ['commit', '-qm', 'work from before the session, not recorded in the parent']);
  const environment = { CLAUDE_PLUGIN_DATA: join(workspaceRoot, '.plugin-data') };
  const sessionBase = readSessionBase({ session_id: 'session-2' }, superRoot, environment);
  writeFileSync(join(childRoot, 'src', 'app.js'), 'console.log(5);\n');
  assert.deepEqual(listFilesChangedSinceBase(superRoot, sessionBase), ['child/src/app.js']);
});
