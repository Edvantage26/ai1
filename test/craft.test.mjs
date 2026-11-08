import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { createTemporaryProject } from './helpers.mjs';

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function startSessionContext(projectRoot, source = 'startup') {
  return runHookEvent('SessionStart', { session_id: 'session-1', cwd: projectRoot, source }, hookOptions()).hookSpecificOutput?.additionalContext || '';
}

test('craft-brief: on by default, with the five rules', () => {
  const contextText = startSessionContext(createTemporaryProject({ features: { okf: false } }));
  for (const rulePattern of [/Craft:/, /Simplicity:/, /Surgical changes:/, /Reuse before writing: .*look in the code for one/, /Refactors: .*wait for a yes/, /Names: /]) {
    assert.match(contextText, rulePattern);
  }
});

test('craft-brief: points reuse at the knowledge bundle when okf is on', () => {
  const contextText = startSessionContext(createTemporaryProject({ features: { okf: true }, knowledge: 'docs/kb' }));
  assert.match(contextText, /look in the code and the knowledge bundle \(`docs\/kb`\)/);
});

test('craft-brief: silent on resume and when the repo turns craft off', () => {
  assert.doesNotMatch(startSessionContext(createTemporaryProject({ features: { okf: false } }), 'resume'), /Craft:/);
  assert.doesNotMatch(startSessionContext(createTemporaryProject({ features: { okf: false, craft: false } })), /Craft:/);
});
