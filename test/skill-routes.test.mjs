// Routes to skills that had none: rule-offer (/ai1:danger-write-rule on a lasting correction) and
// llm-brief (/ai1:verify-evaluate-llm-prompts in a repo with an LLM SDK).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemporaryProject } from './helpers.mjs';
import { runHookEvent } from '../src/core/dispatcher.mjs';
import { isLastingCorrection } from '../src/guards/rule-offer.mjs';
import { findLlmPackages } from '../src/verify/llm-brief.mjs';

function hookOptions() {
  return {
    environment: { CLAUDE_PLUGIN_DATA: mkdtempSync(join(tmpdir(), 'ai1-data-')) },
    homeDirectory: mkdtempSync(join(tmpdir(), 'ai1-home-')),
    reportInternalError: (errorMessage) => { throw new Error(errorMessage); },
  };
}

function contextOf(hookOutput) {
  return hookOutput?.hookSpecificOutput?.additionalContext || '';
}

test('rule-offer: lasting corrections in Spanish and English, not ordinary requests', () => {
  for (const promptText of ['No vuelvas a hacer un force push', 'que no pase más lo de borrar la carpeta', 'que no vuelva a pasar', 'nunca más edites los generados', 'Never do that again', "don't ever run npm here", 'never run it again']) {
    assert.ok(isLastingCorrection(promptText), promptText);
  }
  for (const promptText of ['bloquea el botón mientras carga', 'arregla el test', 'the user never logs in again after a reset?', 'vuelve a lanzar los tests', '']) {
    assert.ok(!isLastingCorrection(promptText), promptText);
  }
});

test('rule-offer: the prompt hook offers /ai1:danger-write-rule after doing what was asked, silent otherwise and when danger is off', () => {
  const projectRoot = createTemporaryProject({ version: 2 });
  const submitPrompt = (root, promptText) => contextOf(runHookEvent('UserPromptSubmit', { session_id: 'session-1', cwd: root, prompt: promptText }, hookOptions()));
  const offerText = submitPrompt(projectRoot, 'no vuelvas a tocar el lockfile');
  assert.match(offerText, /ai1\/rule-offer: .*Do what they asked first\./);
  assert.match(offerText, /offer in one line at the end to turn it into a guard rule with \/ai1:danger-write-rule; write nothing without their yes/);
  assert.match(offerText, /\/ai1:core-customize-skill/);
  assert.doesNotMatch(submitPrompt(projectRoot, 'añade un botón'), /rule-offer/);
  const offRepo = createTemporaryProject({ version: 2, features: { danger: false } });
  assert.doesNotMatch(submitPrompt(offRepo, 'no vuelvas a tocar el lockfile'), /rule-offer/);
});

test('llm-brief: finds LLM SDKs in package.json, requirements and pyproject, not look-alikes', () => {
  const npmRepo = createTemporaryProject();
  writeFileSync(join(npmRepo, 'package.json'), JSON.stringify({ dependencies: { '@anthropic-ai/sdk': '^1', react: '^19' }, devDependencies: { '@langchain/core': '^0.3' } }));
  assert.deepEqual(findLlmPackages(npmRepo), ['@anthropic-ai/sdk', '@langchain/core']);
  const pythonRepo = createTemporaryProject();
  writeFileSync(join(pythonRepo, 'requirements-dev.txt'), 'pytest\nopenai>=1.40\n');
  writeFileSync(join(pythonRepo, 'pyproject.toml'), '[project]\ndependencies = ["litellm==1.2", "anthropic-tools-unrelated"]\n');
  assert.deepEqual(findLlmPackages(pythonRepo), ['openai', 'litellm']);
  const plainRepo = createTemporaryProject();
  writeFileSync(join(plainRepo, 'package.json'), JSON.stringify({ dependencies: { aimless: '1', 'openai-like': '1' } }));
  writeFileSync(join(plainRepo, 'requirements.txt'), 'openai_helpers_x\n');
  assert.deepEqual(findLlmPackages(plainRepo), []);
});

test('llm-brief: one line at session start in a repo with an LLM SDK; silent without one, on resume and when verify is off', () => {
  const startSession = (root, source = 'startup') => contextOf(runHookEvent('SessionStart', { session_id: 'session-1', cwd: root, source }, hookOptions()));
  const llmRepo = createTemporaryProject({ version: 2 });
  writeFileSync(join(llmRepo, 'package.json'), JSON.stringify({ dependencies: { openai: '^4' } }));
  assert.match(startSession(llmRepo), /LLM: this repo calls a language model \(openai\)\. .*\/ai1:verify-evaluate-llm-prompts/);
  assert.doesNotMatch(startSession(llmRepo, 'resume'), /LLM: this repo/);
  assert.doesNotMatch(startSession(createTemporaryProject({ version: 2 })), /LLM: this repo/);
  const offRepo = createTemporaryProject({ version: 2, features: { verify: false } });
  writeFileSync(join(offRepo, 'package.json'), JSON.stringify({ dependencies: { openai: '^4' } }));
  assert.doesNotMatch(startSession(offRepo), /LLM: this repo/);
});
