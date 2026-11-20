import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { ALL_MODULES } from '../src/core/registry.mjs';
import { MODULE_INDEX, loadModulesForEvent } from '../src/core/module-index.mjs';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { KNOWN_FEATURE_IDS } from '../src/core/features.mjs';
import { allowDecision, askDecision, blockDecision, noticeDecision, contextDecision, combineDecisions, buildHookOutput, fitTextsToBudget, MAX_FIELD_CHARACTERS } from '../src/core/hook-io.mjs';
import { contextList, shortenListTitle, MAX_LIST_TITLE_CHARACTERS } from '../src/core/context-list.mjs';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

test('session brief names the features on and the verify commands', () => {
  const projectRoot = createTemporaryProject({ verify: ['npm test'], features: { okf: false } });
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions).hookSpecificOutput.additionalContext;
  assert.match(briefText, /^Features on in \.ai1\/config\.json: .*\bdanger\b.*\.$/m);
  assert.doesNotMatch(briefText, /Features on in .*\bokf\b/);
  assert.match(briefText, /`npm test`/);
});

test('session brief: features are one line of ids, each feature with its own brief explains itself there', () => {
  const projectRoot = createTemporaryProject({ features: { okf: false, craft: true, danger: true } });
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, quietOptions).hookSpecificOutput.additionalContext;
  assert.match(briefText, /^Features on in \.ai1\/config\.json: (?=.*\bcraft\b)(?=.*\bdanger\b)/m);
  assert.doesNotMatch(briefText, /Confirms or refuses shell commands|Hooks enforcing them/, 'no reference lists at session start');
  assert.match(briefText, /Craft: keep the code growing in order/, 'the craft brief still comes');
});

test('session brief warns about enabled plugins that overlap with an enabled feature', () => {
  const projectRoot = createTemporaryProject({ features: { sizing: true, okf: false } });
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  mkdirSync(join(homeDirectory, '.claude'));
  writeFileSync(join(homeDirectory, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'superpowers@official': true, 'okf@x': true, 'feature-dev@official': true } }));
  const briefText = runHookEvent('SessionStart', { cwd: projectRoot }, { ...quietOptions, homeDirectory }).hookSpecificOutput.additionalContext;
  assert.match(briefText, /Plugins that overlap with ai1 are enabled here: superpowers@official overlaps with sizing/);
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
  assert.deepEqual(bashModules.map((loadedModule) => loadedModule.id), ['issue-guard', 'danger', 'config-guard', 'repo-rules', 'sizing-gate', 'sizing-escalate', 'test-guard', 'tool-loop', 'foreign-repo']);
  assert.deepEqual((await loadModulesForEvent('PostToolUse', 'Read')).map((loadedModule) => loadedModule.id), ['okf-file-context']);
});

test('dispatchHookEvent names every enabled feature but runs only the loaded modules', () => {
  const projectRoot = createTemporaryProject({ verify: ['npm test'] });
  const briefModule = ALL_MODULES.find((loadedModule) => loadedModule.id === 'brief');
  const briefText = dispatchHookEvent('SessionStart', { cwd: projectRoot }, { ...quietOptions, runnableModules: [briefModule] }).hookSpecificOutput.additionalContext;
  assert.match(briefText, /Features on in .*\bdanger\b.*\bverify\b/, 'the brief names features whose modules were not loaded');
  assert.doesNotMatch(briefText, /Craft: keep the code growing/, 'craft-brief was not loaded, so it did not run');
});

test('a notice reaches the person as systemMessage and rides along a block', () => {
  const noticeOnly = buildHookOutput('Stop', combineDecisions([allowDecision(), noticeDecision('okf-upkeep', 'no Python')]));
  assert.deepEqual(noticeOnly, { systemMessage: 'ai1/okf-upkeep: no Python' });
  const withBlock = buildHookOutput('Stop', combineDecisions([noticeDecision('okf-upkeep', 'no Python'), blockDecision('verify-gate', 'run npm test')]));
  assert.deepEqual(withBlock, { decision: 'block', reason: 'ai1/verify-gate: run npm test', systemMessage: 'ai1/okf-upkeep: no Python' });
});

test('texts that fit the hook limit pass untouched', () => {
  const combinedDecision = combineDecisions([contextDecision('brief', 'a'.repeat(4000)), contextDecision('later-brief', 'b'.repeat(4000))]);
  assert.equal(combinedDecision.text, `${'a'.repeat(4000)}\n\n${'b'.repeat(4000)}`);
  assert.equal(combinedDecision.trimmedModules, undefined);
});

test('over the hook limit the longest texts are cut first, at a line end, and the short ones stay whole', () => {
  const longLines = (letter, lineCount) => Array.from({ length: lineCount }, () => letter.repeat(99)).join('\n');
  const shortText = 'worktrees: fix-brief (this session)';
  const combinedDecision = combineDecisions([
    contextDecision('brief', longLines('a', 60)),
    contextDecision('worktree-brief', shortText),
    contextDecision('okf-index', longLines('b', 60)),
  ]);
  assert.ok(combinedDecision.text.length <= MAX_FIELD_CHARACTERS, `${combinedDecision.text.length} characters`);
  assert.ok(combinedDecision.text.includes(shortText));
  assert.match(combinedDecision.text, /a\n\[ai1\/brief: \d+ more characters left out to stay under Claude Code's 10,000-character hook limit\]/);
  assert.deepEqual(combinedDecision.trimmedModules.map((trimmedModule) => trimmedModule.moduleId), ['brief', 'okf-index']);
  const fittedTexts = fitTextsToBudget([{ moduleId: 'brief', text: longLines('a', 60) }, { moduleId: 'okf-index', text: longLines('b', 60) }], '\n\n');
  assert.ok(Math.abs(fittedTexts.texts[0].length - fittedTexts.texts[1].length) < 120, 'both cut to about the same length');
});

test('over the hook limit list items go first, from the longest list, and the rule text stays whole [session-start-diet:S2]', () => {
  const ruleText = 'r'.repeat(5000);
  const listItems = (letter, itemCount) => Array.from({ length: itemCount }, (_, itemNumber) => `- ${letter.repeat(90)} ${itemNumber}`);
  const combinedDecision = combineDecisions([
    contextDecision('brief', ruleText),
    contextDecision('later-brief', ['Open later entries:', contextList(listItems('a', 60), (leftOutCount) => `- ... and ${leftOutCount} more in .ai1/later/README.md`)]),
    contextDecision('sizing-brief', ['Unfinished plans:', contextList(listItems('b', 4), (leftOutCount) => `- ... and ${leftOutCount} more in .ai1/work/`)]),
  ]);
  assert.ok(combinedDecision.text.length <= MAX_FIELD_CHARACTERS);
  assert.ok(combinedDecision.text.includes(ruleText), 'the rule text is not cut');
  assert.doesNotMatch(combinedDecision.text, /characters left out/, 'no generic cut while lists had items');
  assert.match(combinedDecision.text, /- \.\.\. and \d+ more in \.ai1\/later\/README\.md/);
  assert.match(combinedDecision.text, /b{90} 3/, 'the short list keeps its items');
  assert.deepEqual(combinedDecision.trimmedModules.map((trimmedModule) => trimmedModule.moduleId), ['later-brief']);
  assert.ok(combinedDecision.trimmedModules[0].droppedItems > 0);
});

test('a list shows at most its shownAtMost items and says how many more; titles are shortened at a word', () => {
  const shownList = contextDecision('later-brief', ['Open:', contextList(['- one', '- two', '- three', '- four'], (leftOutCount) => `- ... and ${leftOutCount} more`, { shownAtMost: 3 })]);
  assert.equal(shownList.text, 'Open:\n- one\n- two\n- three\n- ... and 1 more');
  const shortTitle = shortenListTitle('Guard writes to production databases when the agent runs migrations from a worktree');
  assert.ok(shortTitle.length <= MAX_LIST_TITLE_CHARACTERS && shortTitle.endsWith('...'), shortTitle);
  assert.equal(shortenListTitle('Short title'), 'Short title');
});

test('a session start over the hook limit is cut and logged as trimmed, not reported as an error', () => {
  const projectRoot = createTemporaryProject({ version: 1, features: {} });
  const stateDirectory = mkdtempSync(join(tmpdir(), 'ai1-trim-'));
  const reportedErrors = [];
  const bigModule = (moduleId) => ({ id: moduleId, event: 'SessionStart', feature: 'core', run: () => contextDecision(moduleId, 'x'.repeat(6000)) });
  const moduleDefinitions = [{ id: 'brief', event: 'SessionStart', feature: 'core' }, { id: 'issue-offer', event: 'SessionStart', feature: 'core' }];
  const sessionOutput = dispatchHookEvent('SessionStart', { cwd: projectRoot, session_id: 'trim-test' }, {
    environment: { CLAUDE_PLUGIN_DATA: stateDirectory },
    reportInternalError: (errorMessage) => reportedErrors.push(errorMessage),
    moduleDefinitions,
    runnableModules: [bigModule('brief'), bigModule('issue-offer')],
  });
  assert.ok(sessionOutput.hookSpecificOutput.additionalContext.length <= MAX_FIELD_CHARACTERS);
  assert.deepEqual(reportedErrors, []);
  const logText = readdirSync(join(stateDirectory, 'state')).filter((fileName) => fileName.endsWith('.jsonl'))
    .map((fileName) => readFileSync(join(stateDirectory, 'state', fileName), 'utf8')).join('');
  assert.match(logText, /"module":"brief","decision":"trimmed"/);
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
