import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { ALL_MODULES } from '../src/core/registry.mjs';
import { KNOWN_FEATURE_IDS } from '../src/core/features.mjs';
import { allowDecision, askDecision } from '../src/core/hook-io.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const quietOptions = { environment: {}, reportInternalError: () => {} };

test('without .ai1/config.json ai1 only leaves a one-line note at session start', () => {
  const projectRoot = createTemporaryProject();
  const sessionOutput = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions);
  assert.match(sessionOutput.hookSpecificOutput.additionalContext, /inactive/);
  assert.equal(runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard'), quietOptions), null);
});

test('an invalid .ai1/config.json deactivates ai1 and says why', () => {
  const projectRoot = createTemporaryProject({ features: { danger: 'yes' } });
  const sessionOutput = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions);
  assert.match(sessionOutput.hookSpecificOutput.additionalContext, /invalid.*features\.danger/);
  assert.equal(runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard'), quietOptions), null);
});

test('a feature unknown to this ai1 version does not switch the guards off', () => {
  const projectRoot = createTemporaryProject({ features: { teleport: true } });
  assert.equal(runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard'), quietOptions).hookSpecificOutput.permissionDecision, 'ask');
});

test('a dangerous command produces a PreToolUse ask with the reason', () => {
  const projectRoot = createTemporaryProject({});
  const hookOutput = runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard'), quietOptions);
  assert.equal(hookOutput.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(hookOutput.hookSpecificOutput.permissionDecisionReason, /^ai1\/danger:/);
});

test('a safe command produces no output', () => {
  const projectRoot = createTemporaryProject({});
  assert.equal(runHookEvent('PreToolUse', bashPayload(projectRoot, 'ls -la'), quietOptions), null);
});

test('a module switched off in .ai1/config.json does not run', () => {
  const projectRoot = createTemporaryProject({ modules: { danger: false } });
  assert.equal(runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard'), quietOptions), null);
});

test('session brief describes features, hooks and verify', () => {
  const projectRoot = createTemporaryProject({ verify: ['npm test'], features: { okf: false } });
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions).hookSpecificOutput.additionalContext;
  assert.match(briefText, /- danger:/);
  assert.doesNotMatch(briefText, /- okf:/);
  assert.match(briefText, /`npm test`/);
});

test('session brief: a feature with its own session-start text gets only its title', () => {
  const projectRoot = createTemporaryProject({ features: { okf: false, craft: true, danger: true } });
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions).hookSpecificOutput.additionalContext;
  assert.match(briefText, /^- craft: Code craft rules$/m, 'craft explains itself in craft-brief');
  assert.match(briefText, /^- danger: Confirms or refuses shell commands/m, 'danger has no brief of its own');
  assert.match(briefText, /Craft: keep the code growing in order/, 'the craft brief still comes');
});

test('an unwritable state directory does not cost the session its brief', () => {
  const projectRoot = createTemporaryProject({ verify: ['npm test'], features: { okf: true } });
  mkdirSync(join(projectRoot, '.ai1', 'okf'));
  writeFileSync(join(projectRoot, '.ai1', 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n# Bundle\n');
  const notADirectory = join(projectRoot, 'state-is-a-file');
  writeFileSync(notADirectory, '');
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = () => true;
  try {
    const briefText = runHookEvent('SessionStart', { cwd: projectRoot, session_id: 's' }, { ...quietOptions, environment: { CLAUDE_PLUGIN_DATA: notADirectory } }).hookSpecificOutput.additionalContext;
    assert.match(briefText, /ai1 harness is active/);
    assert.match(briefText, /--- \.ai1\/okf\/index\.md ---/);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
});

test('a failing module fails open and the others still decide', () => {
  const projectRoot = createTemporaryProject({});
  const reportedErrors = [];
  const brokenModule = { id: 'broken', event: 'PreToolUse', feature: 'core', run() { throw new Error('boom'); } };
  const askingModule = { id: 'asker', event: 'PreToolUse', feature: 'core', run: () => askDecision('asker', 'confirm please') };
  const hookOutput = runHookEvent('PreToolUse', bashPayload(projectRoot, 'ls'), {
    environment: {},
    availableModules: [brokenModule, askingModule],
    reportInternalError: (errorMessage) => reportedErrors.push(errorMessage),
  });
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(reportedErrors[0], /broken failed/);
});

test('deny wins over ask when modules disagree', () => {
  const projectRoot = createTemporaryProject({});
  const hookOutput = runHookEvent('PreToolUse', bashPayload(projectRoot, 'git reset --hard && rm -rf /'), quietOptions);
  assert.equal(hookOutput.hookSpecificOutput.permissionDecision, 'deny');
});

test('CLAUDE_PROJECT_DIR takes precedence over the input cwd', () => {
  const configuredProject = createTemporaryProject({ modules: { danger: false } });
  const otherDirectory = createTemporaryProject({});
  const hookOutput = runHookEvent('PreToolUse', bashPayload(otherDirectory, 'git reset --hard'), {
    environment: { CLAUDE_PROJECT_DIR: configuredProject },
    reportInternalError: () => {},
  });
  assert.equal(hookOutput, null);
});

test('registry modules all declare the required fields', () => {
  for (const moduleDefinition of ALL_MODULES) {
    assert.ok(moduleDefinition.id && moduleDefinition.event && moduleDefinition.description, moduleDefinition.id);
    assert.ok(KNOWN_FEATURE_IDS.includes(moduleDefinition.feature), moduleDefinition.id);
    assert.equal(typeof moduleDefinition.run, 'function');
  }
  assert.equal(allowDecision().kind, 'allow');
});
