import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject } from './helpers.mjs';

const OLD_EPOCH_SECONDS = 1_000_000;

function runGit(projectRoot, gitArguments) {
  execFileSync('git', ['-C', projectRoot, ...gitArguments], { stdio: 'ignore' });
}

function writeRepoFile(projectRoot, relativePath, fileText) {
  mkdirSync(join(projectRoot, relativePath, '..'), { recursive: true });
  writeFileSync(join(projectRoot, relativePath), fileText);
}

function createFileContextRepo(ai1Config = {}) {
  const projectRoot = createTemporaryProject(ai1Config);
  writeRepoFile(projectRoot, '.ai1/okf/index.md', '---\nokf_version: "0.2"\n---\n# Bundle\n');
  writeRepoFile(projectRoot, '.ai1/okf/guards/danger.md', '---\ntype: Component\ntitle: danger guard\nresource: src/guards/danger.mjs\n---\nAlso `src/core/shell-parse.mjs`.\n');
  writeRepoFile(projectRoot, '.ai1/okf/overview.md', '---\ntype: Overview\ntitle: Overview\n---\nCode in `src/core/`.\n');
  writeRepoFile(projectRoot, 'src/guards/danger.mjs', 'export default 1;\n');
  writeRepoFile(projectRoot, 'src/core/shell-parse.mjs', 'export default 2;\n');
  writeRepoFile(projectRoot, 'README.md', '# Repo\n');
  runGit(projectRoot, ['init', '-q']);
  runGit(projectRoot, ['add', '.']);
  runGit(projectRoot, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init']);
  for (const conceptPath of ['index.md', 'guards/danger.md', 'overview.md']) {
    utimesSync(join(projectRoot, '.ai1/okf', conceptPath), OLD_EPOCH_SECONDS, OLD_EPOCH_SECONDS);
  }
  return projectRoot;
}

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function useTool(projectRoot, options, toolName, relativePath, extraInput = {}) {
  const hookOutput = runHookEvent('PostToolUse', {
    session_id: 'session-1', cwd: projectRoot, tool_name: toolName, tool_input: { file_path: join(projectRoot, relativePath) }, ...extraInput,
  }, options);
  return hookOutput?.hookSpecificOutput?.additionalContext ?? null;
}

test('okf-file-context: a read file gets its concept once, by the strongest citation', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  const firstContext = useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs');
  assert.match(firstContext, /`src\/guards\/danger\.mjs` is described by `\.ai1\/okf\/guards\/danger\.md` \(danger guard\)\. Read it before changing this code/);
  assert.equal(useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs'), null, 'second read is silent');
  assert.equal(useTool(projectRoot, options, 'Read', 'src/core/shell-parse.mjs'), null, 'same concept from another file is silent');
  assert.equal(useTool(projectRoot, options, 'Read', 'README.md'), null, 'a file no concept describes gets nothing');
});

test('okf-file-context: body-exact beats a folder citation', () => {
  const projectRoot = createFileContextRepo();
  const shellParseContext = useTool(projectRoot, hookOptions(), 'Read', 'src/core/shell-parse.mjs');
  assert.match(shellParseContext, /guards\/danger\.md/);
  assert.doesNotMatch(shellParseContext, /overview\.md/);
});

test('okf-file-context: an edit reminds to update once, after a read pointer or without one', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs');
  assert.match(useTool(projectRoot, options, 'Edit', 'src/guards/danger.mjs'), /you changed `src\/guards\/danger\.mjs`, described by .*\. Update it if the change affects what it says\./);
  assert.equal(useTool(projectRoot, options, 'Edit', 'src/guards/danger.mjs'), null, 'second edit is silent');
  const freshOptions = hookOptions();
  assert.match(useTool(projectRoot, freshOptions, 'Write', 'src/guards/danger.mjs'), /Read it and update it if the change affects/);
  assert.equal(useTool(projectRoot, freshOptions, 'Read', 'src/guards/danger.mjs'), null, 'the edit reminder already pointed to it');
});

test('okf-file-context: a concept the agent already opened gets no read pointer', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  assert.equal(useTool(projectRoot, options, 'Read', '.ai1/okf/guards/danger.md'), null, 'bundle files are silent');
  assert.equal(useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs'), null);
});

test('okf-file-context: no update reminder when the concept was already edited in the session', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot }, options);
  writeFileSync(join(projectRoot, '.ai1/okf/guards/danger.md'), '---\ntype: Component\ntitle: danger guard\nresource: src/guards/danger.mjs\n---\nUpdated.\n');
  assert.equal(useTool(projectRoot, options, 'Edit', 'src/guards/danger.mjs'), null);
});

test('okf-file-context: a subagent gets its own pointers', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  assert.ok(useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs'));
  assert.ok(useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs', { agent_id: 'agent-7' }), 'subagent pointer');
  assert.equal(useTool(projectRoot, options, 'Read', 'src/guards/danger.mjs', { agent_id: 'agent-7' }), null);
});

test('okf-file-context: harness files, outside paths, no bundle and the module switch stay silent', () => {
  const projectRoot = createFileContextRepo();
  const options = hookOptions();
  assert.equal(useTool(projectRoot, options, 'Read', '.ai1/config.json'), null);
  assert.equal(runHookEvent('PostToolUse', { session_id: 's', cwd: projectRoot, tool_name: 'Read', tool_input: { file_path: '/etc/hosts' } }, options), null);
  const switchedOffRepo = createFileContextRepo({ modules: { 'okf-file-context': false } });
  assert.equal(useTool(switchedOffRepo, hookOptions(), 'Read', 'src/guards/danger.mjs'), null);
  const okfOffRepo = createFileContextRepo({ features: { okf: false } });
  assert.equal(useTool(okfOffRepo, hookOptions(), 'Read', 'src/guards/danger.mjs'), null);
  const noBundleRepo = createTemporaryProject({});
  writeRepoFile(noBundleRepo, 'src/a.mjs', '1');
  assert.equal(useTool(noBundleRepo, hookOptions(), 'Read', 'src/a.mjs'), null);
});
