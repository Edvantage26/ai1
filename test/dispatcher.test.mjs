import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { ALL_MODULES } from '../src/core/registry.mjs';
import { MODULE_INDEX, loadModulesForEvent } from '../src/core/module-index.mjs';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { KNOWN_FEATURE_IDS } from '../src/core/features.mjs';
import { allowDecision, askDecision, blockDecision, noticeDecision, combineDecisions, buildHookOutput } from '../src/core/hook-io.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

test('session brief warns about enabled plugins that overlap with an enabled feature', () => {
  const projectRoot = createTemporaryProject({ features: { lanes: true, okf: false } });
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  mkdirSync(join(homeDirectory, '.claude'));
  writeFileSync(join(homeDirectory, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': true, 'okf@x': true, 'feature-dev@official': true } }));
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, { ...quietOptions, homeDirectory }).hookSpecificOutput.additionalContext;
  assert.match(briefText, /Plugins that overlap with ai1 are enabled here: superpowers@official overlaps with lanes/);
  assert.doesNotMatch(briefText, /okf@x/, 'okf is off in this repo');
  assert.doesNotMatch(briefText, /feature-dev/, 'warn-only overlaps stay out of the brief');
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(join(projectRoot, '.claude', 'settings.local.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': false } }));
  const briefAfterDisabling = runHookEvent('SessionStart', { cwd: projectRoot }, { ...quietOptions, homeDirectory }).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(briefAfterDisabling, /Plugins that overlap/);
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

test('the module index agrees with each module file, and an event loads only its modules', async () => {
  assert.equal(MODULE_INDEX.length, ALL_MODULES.length);
  for (const [moduleIndexPosition, moduleEntry] of MODULE_INDEX.entries()) {
    const loadedModule = ALL_MODULES[moduleIndexPosition];
    assert.deepEqual(
      { id: loadedModule.id, event: loadedModule.event, feature: loadedModule.feature, toolNames: loadedModule.toolNames },
      { id: moduleEntry.id, event: moduleEntry.event, feature: moduleEntry.feature, toolNames: moduleEntry.toolNames },
      moduleEntry.modulePath,
    );
  }
  const bashModules = await loadModulesForEvent('PreToolUse', 'Bash');
  assert.deepEqual(bashModules.map((loadedModule) => loadedModule.id), ['danger', 'config-guard', 'repo-rules', 'lanes-gate', 'lanes-escalate', 'test-guard']);
  assert.deepEqual((await loadModulesForEvent('PostToolUse', 'Read')).map((loadedModule) => loadedModule.id), ['okf-file-context']);
});

test('dispatchHookEvent lists every enabled module but runs only the loaded ones', () => {
  const projectRoot = createTemporaryProject({ verify: ['npm test'] });
  const briefModule = ALL_MODULES.find((loadedModule) => loadedModule.id === 'brief');
  const briefText = dispatchHookEvent('SessionStart', { cwd: projectRoot }, { ...quietOptions, runnableModules: [briefModule] }).hookSpecificOutput.additionalContext;
  assert.match(briefText, /Hooks enforcing them: .*danger.*verify-gate/, 'the brief names modules that were not loaded');
  assert.doesNotMatch(briefText, /Craft: keep the code growing/, 'craft-brief was not loaded, so it did not run');
});

test('a notice reaches the person as systemMessage and rides along a block', () => {
  const noticeOnly = buildHookOutput('Stop', combineDecisions([allowDecision(), noticeDecision('okf-upkeep', 'no Python')]));
  assert.deepEqual(noticeOnly, { systemMessage: 'ai1/okf-upkeep: no Python' });
  const withBlock = buildHookOutput('Stop', combineDecisions([noticeDecision('okf-upkeep', 'no Python'), blockDecision('verify-gate', 'run npm test')]));
  assert.deepEqual(withBlock, { decision: 'block', reason: 'ai1/verify-gate: run npm test', systemMessage: 'ai1/okf-upkeep: no Python' });
});

test('in bypass or auto mode only the asks that guard against losing data (danger) and the repo rules reach the person', () => {
  const projectRoot = createTemporaryProject({ version: 1, features: { danger: true } });
  const askedDecision = (permissionMode, commandLine) => runHookEvent('PreToolUse', { ...bashPayload(projectRoot, commandLine), permission_mode: permissionMode }, quietOptions)?.hookSpecificOutput?.permissionDecision ?? 'allow';
  const configEdit = `echo '{}' > ${join(projectRoot, '.ai1', 'config.json')}`;
  assert.equal(askedDecision('default', configEdit), 'ask', 'config-guard asks in the default mode');
  assert.equal(askedDecision('bypassPermissions', configEdit), 'allow');
  assert.equal(askedDecision('auto', configEdit), 'allow');
  assert.equal(askedDecision('bypassPermissions', 'git push --force'), 'ask', 'danger still asks');
  assert.equal(askedDecision('auto', 'git reset --hard'), 'ask');
});
