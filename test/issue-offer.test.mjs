import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchHookEvent } from '../src/core/hook-dispatch.mjs';
import { ALL_MODULES } from '../src/core/registry.mjs';
import { readPendingErrors, recordPendingErrors } from '../src/core/pending-errors.mjs';
import { readPluginVersion, readReportMode } from '../src/core/issue-offer.mjs';
import { collectIssueEnvironment, formatIssueEnvironment, buildAutomaticReport } from '../src/cli/issue-command.mjs';
import { createTemporaryProject, bashPayload } from './helpers.mjs';

const pluginDataEnvironment = () => ({ CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) });
const throwingModule = { id: 'throws-on-purpose', event: 'PreToolUse', feature: 'core', run() { throw new TypeError('private detail'); } };
const issueOfferModule = ALL_MODULES.find((loadedModule) => loadedModule.id === 'issue-offer');

function failOnce(projectRoot, environment) {
  dispatchHookEvent('PreToolUse', bashPayload(projectRoot, 'git status'), {
    environment, moduleDefinitions: [throwingModule], runnableModules: [throwingModule], reportInternalError: () => {},
  });
}

function sendPrompt(projectRoot, environment) {
  return dispatchHookEvent('UserPromptSubmit', { session_id: 's', cwd: projectRoot, prompt: 'hola' }, {
    environment, moduleDefinitions: [issueOfferModule], runnableModules: [issueOfferModule], reportInternalError: () => {},
  });
}

test('issue-offer: silent with no errors; one offer per error and version after a module throws', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = pluginDataEnvironment();
  assert.equal(sendPrompt(projectRoot, environment), null);
  failOnce(projectRoot, environment);
  failOnce(projectRoot, environment);
  const offerText = sendPrompt(projectRoot, environment).hookSpecificOutput.additionalContext;
  assert.match(offerText, /ai1 itself failed in this repo: `throws-on-purpose` \(TypeError at test\/issue-offer\.test\.mjs:\d+\), 2 time\(s\)/);
  assert.match(offerText, /\/ai1:core-report-issue; report nothing without their yes/);
  assert.doesNotMatch(offerText, /private detail/);
  assert.equal(sendPrompt(projectRoot, environment), null, 'offered once');
  failOnce(projectRoot, environment);
  assert.equal(sendPrompt(projectRoot, environment), null, 'the same error again in the same version is not offered again');
  const [pendingError] = Object.values(readPendingErrors(projectRoot, environment));
  assert.equal(pendingError.count, 3);
  assert.equal(pendingError.offeredVersion, readPluginVersion());
});

test('issue-offer: in the ai1 repo itself it offers to fix it here', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  mkdirSync(join(projectRoot, '.claude-plugin'));
  writeFileSync(join(projectRoot, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'ai1' }));
  const environment = pluginDataEnvironment();
  failOnce(projectRoot, environment);
  assert.match(sendPrompt(projectRoot, environment).hookSpecificOutput.additionalContext, /This is the ai1 repo: offer the person, in one line, to look into it and fix it/);
});

test('pending errors: entries unseen for 30 days are dropped', () => {
  const environment = pluginDataEnvironment();
  recordPendingErrors([{ module: 'old', error: 'Error' }], '/repo', environment, new Date('2026-09-01T00:00:00Z'));
  recordPendingErrors([{ module: 'new', error: 'Error' }], '/repo', environment, new Date('2026-11-09T00:00:00Z'));
  assert.deepEqual(Object.keys(readPendingErrors('/repo', environment)), ['new|Error']);
});

test('ai1 issue env lists the pending errors without any repo path', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = { CLAUDE_PLUGIN_DATA: join(homeDirectory, 'data') };
  failOnce(projectRoot, environment);
  const issueEnvironment = collectIssueEnvironment(projectRoot, { environment, homeDirectory, runCommand: () => ({ status: 1, stdout: '' }) });
  assert.equal(issueEnvironment.pendingErrors[0].module, 'throws-on-purpose');
  const environmentText = formatIssueEnvironment(issueEnvironment);
  assert.match(environmentText, /- ai1 errors in this repo:\n {2}- `throws-on-purpose`: TypeError at test\/issue-offer\.test\.mjs:\d+ \(1x/);
  assert.ok(!environmentText.includes(projectRoot));
});

test('issue-offer: AI1_REPORT_ERRORS=off is silent, auto asks to file the fixed-facts report now', () => {
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = pluginDataEnvironment();
  failOnce(projectRoot, environment);
  assert.equal(sendPrompt(projectRoot, { ...environment, AI1_REPORT_ERRORS: 'off' }), null);
  const autoText = sendPrompt(projectRoot, { ...environment, AI1_REPORT_ERRORS: 'auto' }).hookSpecificOutput.additionalContext;
  assert.match(autoText, /chose to report ai1's own errors automatically.*exactly as `ai1 issue auto-body` prints them, nothing added/);
  assert.equal(readReportMode({ AI1_REPORT_ERRORS: 'sometimes' }), 'ask', 'an unknown value means ask');
});

test('ai1 issue auto-body: fixed facts only, null without errors', () => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const projectRoot = createTemporaryProject({ version: 1 });
  const environment = { CLAUDE_PLUGIN_DATA: join(homeDirectory, 'data') };
  const collect = () => collectIssueEnvironment(projectRoot, { environment, homeDirectory, runCommand: () => ({ status: 0, stdout: '2.1.300 (Claude Code)' }) });
  assert.equal(buildAutomaticReport(collect()), null);
  failOnce(projectRoot, environment);
  const automaticReport = buildAutomaticReport(collect());
  assert.match(automaticReport.title, /^ai1 error: throws-on-purpose - TypeError at test\/issue-offer\.test\.mjs:\d+$/);
  assert.match(automaticReport.body, /nothing from the session, the repo or its code/);
  assert.match(automaticReport.body, /- Claude Code: 2\.1\.300/);
  assert.ok(!automaticReport.body.includes(projectRoot) && !automaticReport.body.includes('private detail'));
});
