// okf-recall (UserPromptSubmit, feature `okf`): on every message from the person, finds the bundle
// concepts related to it and puts them in front of the agent, so consulting the knowledge does not
// depend on the agent remembering an index it saw at session start. Keyword matching, no LLM:
// title and tags weigh most, then description and path, then the body (where the domain words the
// person actually uses tend to live). Words that appear in most concepts are ignored in the body.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { allowDecision, contextDecision } from '../core/hook-io.mjs';
import { resolveBundleDirectory, readBundleIndex } from './okf-bundle.mjs';

const MODULE_ID = 'okf-recall';
const MAX_SUGGESTED_CONCEPTS = 5;
const MIN_CONCEPT_SCORE = 3;
const MIN_PROMPT_KEYWORDS = 2;
const TOKEN_PREFIX_LENGTH = 6;
const COMMON_BODY_WORD_RATIO = 0.4;
const FIELD_WEIGHTS = { title: 3, tags: 3, description: 2, path: 2, body: 1 };
const STOP_WORDS = new Set([
  // Spanish
  'para', 'como', 'este', 'esta', 'estos', 'estas', 'pero', 'porque', 'cuando', 'donde', 'sobre',
  'entre', 'tiene', 'tienen', 'hacer', 'hace', 'puede', 'pueden', 'quiero', 'necesito', 'tambien',
  'solo', 'cada', 'todo', 'todos', 'todas', 'esto', 'ahora', 'antes', 'despues', 'hola', 'gracias',
  'vale', 'bien', 'mira', 'dime', 'algo', 'cosa', 'cosas', 'otra', 'otro', 'otros', 'otras', 'desde',
  'hasta', 'sigue', 'seguir', 'hemos', 'estamos', 'tengo', 'tenemos', 'creo', 'parece', 'favor',
  'revisa', 'revisar', 'muestra', 'mostrar', 'explica', 'explicar', 'mirar', 'busca', 'buscar', 'dame',
  'haz', 'hazlo', 'adelante', 'perfecto', 'entonces', 'vamos', 'oye',
  // English
  'that', 'this', 'with', 'from', 'have', 'what', 'when', 'where', 'which', 'there', 'they', 'their',
  'would', 'should', 'could', 'about', 'into', 'your', 'will', 'does', 'them', 'then', 'than', 'please',
]);

export function normalizeKeywords(text) {
  return [...new Set(String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word) && !/^\d+$/.test(word))
    .map((word) => word.slice(0, TOKEN_PREFIX_LENGTH)))];
}

function readFrontmatterField(frontmatterText, fieldName) {
  const fieldMatch = new RegExp(`^${fieldName}:\\s*(.*)$`, 'm').exec(frontmatterText);
  if (!fieldMatch) return '';
  const inlineValue = fieldMatch[1].trim();
  if (inlineValue) return inlineValue.replace(/^\[|\]$/g, '').replace(/^['"]|['"]$/g, '');
  // Block list: "tags:\n  - a\n  - b"
  const blockStart = fieldMatch.index + fieldMatch[0].length;
  const blockItems = [];
  for (const blockLine of frontmatterText.slice(blockStart).split('\n').slice(1)) {
    const itemMatch = /^\s*-\s*(.+)$/.exec(blockLine);
    if (!itemMatch) break;
    blockItems.push(itemMatch[1]);
  }
  return blockItems.join(' ');
}

function listConceptFiles(directoryPath) {
  const conceptFiles = [];
  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entryName);
    if (statSync(entryPath).isDirectory()) conceptFiles.push(...listConceptFiles(entryPath));
    else if (entryName.endsWith('.md') && entryName !== 'index.md' && entryName !== 'log.md') conceptFiles.push(entryPath);
  }
  return conceptFiles;
}

export function buildConceptCatalog(bundleDirectory) {
  return listConceptFiles(bundleDirectory).map((conceptPath) => {
    const conceptText = readFileSync(conceptPath, 'utf8');
    const frontmatterMatch = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(conceptText);
    const frontmatterText = frontmatterMatch ? frontmatterMatch[1] : '';
    const bodyText = frontmatterMatch ? frontmatterMatch[2] : conceptText;
    const relativePath = relative(bundleDirectory, conceptPath);
    const title = readFrontmatterField(frontmatterText, 'title');
    const description = readFrontmatterField(frontmatterText, 'description');
    return {
      relativePath,
      type: readFrontmatterField(frontmatterText, 'type'),
      title,
      description,
      keywordsByField: {
        title: new Set(normalizeKeywords(title)),
        tags: new Set(normalizeKeywords(readFrontmatterField(frontmatterText, 'tags'))),
        description: new Set(normalizeKeywords(description)),
        path: new Set(normalizeKeywords(relativePath.replace(/\.md$/, ''))),
        body: new Set(normalizeKeywords(bodyText)),
      },
    };
  });
}

export function rankConceptsForPrompt(promptText, conceptCatalog) {
  const promptKeywords = normalizeKeywords(promptText);
  if (promptKeywords.length < MIN_PROMPT_KEYWORDS) return [];
  const bodyDocumentFrequency = new Map();
  for (const concept of conceptCatalog) {
    for (const bodyKeyword of concept.keywordsByField.body) bodyDocumentFrequency.set(bodyKeyword, (bodyDocumentFrequency.get(bodyKeyword) || 0) + 1);
  }
  const commonBodyThreshold = Math.max(2, conceptCatalog.length * COMMON_BODY_WORD_RATIO);
  return conceptCatalog
    .map((concept) => {
      let conceptScore = 0;
      const matchedKeywords = [];
      for (const promptKeyword of promptKeywords) {
        let keywordScore = 0;
        for (const [fieldName, fieldWeight] of Object.entries(FIELD_WEIGHTS)) {
          if (!concept.keywordsByField[fieldName].has(promptKeyword)) continue;
          if (fieldName === 'body' && (bodyDocumentFrequency.get(promptKeyword) || 0) > commonBodyThreshold) continue;
          keywordScore = Math.max(keywordScore, fieldWeight);
        }
        if (keywordScore) {
          conceptScore += keywordScore;
          matchedKeywords.push(promptKeyword);
        }
      }
      return { ...concept, conceptScore, matchedKeywords };
    })
    .filter((concept) => concept.conceptScore >= MIN_CONCEPT_SCORE)
    .sort((firstConcept, secondConcept) => secondConcept.conceptScore - firstConcept.conceptScore)
    .slice(0, MAX_SUGGESTED_CONCEPTS);
}

export function buildRecallText(bundleRelativePath, rankedConcepts) {
  return [
    `OKF concepts related to this request (read the relevant ones in \`${bundleRelativePath}/\` before answering or changing code; they hold decisions and context the code does not):`,
    ...rankedConcepts.map((concept) => `- ${bundleRelativePath}/${concept.relativePath}${concept.title ? ` — ${concept.title}` : ''}${concept.description ? `: ${concept.description.slice(0, 140)}` : ''}`),
  ].join('\n');
}

export default {
  id: MODULE_ID,
  event: 'UserPromptSubmit',
  feature: 'okf',
  description: 'On every message, points the agent to the OKF concepts related to it.',
  run({ hookInput, config, projectRoot }) {
    const promptText = hookInput.prompt;
    if (typeof promptText !== 'string' || promptText.trim().startsWith('/')) return allowDecision();
    const bundleRelativePath = config.knowledge || '.okf';
    const bundleDirectory = resolveBundleDirectory(projectRoot, config);
    if (readBundleIndex(bundleDirectory) === null) return allowDecision();
    const rankedConcepts = rankConceptsForPrompt(promptText, buildConceptCatalog(bundleDirectory));
    if (!rankedConcepts.length) return allowDecision();
    return contextDecision(MODULE_ID, buildRecallText(bundleRelativePath, rankedConcepts));
  },
};
