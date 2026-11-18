// llm-brief (SessionStart, feature `verify`): in a repo that depends on an LLM SDK (package.json,
// requirements*.txt, pyproject.toml at the root), one line pointing to /ai1:verify-evaluate-llm-prompts
// for when a prompt, a model or an LLM step's results are written, changed or questioned. Silent in a
// repo without one. Reads only root manifests, so it stays cheap; the text changes only with them.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { readJsonFileIfValid } from '../core/json-file.mjs';

const MODULE_ID = 'llm-brief';

const NPM_LLM_PACKAGES = ['openai', '@anthropic-ai/sdk', '@google/generative-ai', '@google/genai', 'ai', 'langchain', '@mistralai/mistralai', 'cohere-ai', 'ollama', '@openrouter/ai-sdk-provider', 'llamaindex'];
const NPM_LLM_PREFIXES = ['@langchain/', '@ai-sdk/'];
const PYTHON_LLM_PACKAGES = ['openai', 'anthropic', 'google-generativeai', 'google-genai', 'langchain', 'litellm', 'mistralai', 'cohere', 'ollama', 'instructor', 'dspy', 'dspy-ai', 'llama-index', 'pydantic-ai'];

function npmLlmPackages(projectRoot) {
  const packageJson = readJsonFileIfValid(join(projectRoot, 'package.json'));
  if (!packageJson) return [];
  const dependencyNames = Object.keys({ ...packageJson.dependencies, ...packageJson.devDependencies });
  return dependencyNames.filter((dependencyName) => NPM_LLM_PACKAGES.includes(dependencyName) || NPM_LLM_PREFIXES.some((packagePrefix) => dependencyName.startsWith(packagePrefix)));
}

function pythonLlmPackages(projectRoot) {
  const manifestNames = readdirSync(projectRoot).filter((fileName) => /^requirements.*\.txt$/i.test(fileName) || fileName === 'pyproject.toml');
  const manifestText = manifestNames.map((manifestName) => readFileSync(join(projectRoot, manifestName), 'utf8')).join('\n').toLowerCase();
  return PYTHON_LLM_PACKAGES.filter((packageName) => new RegExp(`(^|[\\s"'\\[,])${packageName.replace(/[.-]/g, '[-_.]')}(?=$|[\\s"'\\],<>=!~;\\[])`, 'm').test(manifestText));
}

export function findLlmPackages(projectRoot) {
  if (!existsSync(projectRoot)) return [];
  return [...new Set([...npmLlmPackages(projectRoot), ...pythonLlmPackages(projectRoot)])];
}

export function llmBriefText(llmPackages) {
  return `LLM: this repo calls a language model (${llmPackages.join(', ')}). When a prompt, a model choice or the results of an LLM step are written, changed or questioned ("el modelo falla", "prueba otro modelo"), follow /ai1:verify-evaluate-llm-prompts: evidence on real cases before blaming the model.`;
}

export default {
  id: MODULE_ID,
  event: 'SessionStart',
  feature: 'verify',
  description: 'In a repo that depends on an LLM SDK, points to /ai1:verify-evaluate-llm-prompts for prompt and model work.',
  run({ hookInput, projectRoot }) {
    if (hookInput.source === 'resume') return allowDecision();
    const llmPackages = findLlmPackages(projectRoot);
    return llmPackages.length ? contextDecision(MODULE_ID, llmBriefText(llmPackages)) : allowDecision();
  },
};
