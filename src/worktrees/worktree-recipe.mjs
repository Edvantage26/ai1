// The per-project worktree recipe: `.claude/skills/worktree/recipe.json`, written by /jig:worktree
// after the person approves it and committed with the repo. The project skill next to it
// (`SKILL.md`) holds the rules in prose; this file holds the data the engine needs.
// schema/worktree-recipe.schema.json describes the same rules for editors; this validator is
// hand-written so jig keeps zero dependencies (test/worktrees.test.mjs checks both agree).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PROJECT_SKILL_DIRECTORY = join('.claude', 'skills', 'worktree');
export const RECIPE_RELATIVE_PATH = join(PROJECT_SKILL_DIRECTORY, 'recipe.json');
export const SUPPORTED_RECIPE_VERSION = 1;
export const BUILT_IN_MODES = ['auto', 'full', 'light'];
export const HEAVY_STRATEGIES = ['copy', 'share', 'regenerate', 'exclude'];
// Fields of the recipe format that a later jig phase implements; accepted and ignored for now.
export const PLANNED_RECIPE_FIELDS = ['caches', 'slots'];

const KNOWN_RECIPE_FIELDS = new Set([
  '$schema', 'version', 'location', 'branch_prefix', 'base', 'default_mode', 'copy', 'heavy', 'modes',
  'disk_margin_percent', 'port', 'env', 'setup', 'commands', 'finish', 'reminder_every', ...PLANNED_RECIPE_FIELDS,
]);

export const DEFAULT_RECIPE = {
  version: SUPPORTED_RECIPE_VERSION,
  location: join('.claude', 'worktrees'),
  branch_prefix: 'wt/',
  base: 'current',
  default_mode: 'auto',
  copy: [],
  heavy: [],
  modes: {},
  disk_margin_percent: 15,
  port: null,
  env: {},
  setup: [],
  commands: {},
  finish: { strategy: 'rebase', allow_merge: true, dirty_base_paths_ok: [] },
  reminder_every: 5,
};

const isPlainObject = (candidateValue) => candidateValue !== null && typeof candidateValue === 'object' && !Array.isArray(candidateValue);
const isNonEmptyString = (candidateValue) => typeof candidateValue === 'string' && candidateValue.trim() !== '';
const isListOfStrings = (candidateValue) => Array.isArray(candidateValue) && candidateValue.every(isNonEmptyString);

export function validateRecipe(rawRecipe) {
  if (!isPlainObject(rawRecipe)) return ['the file must contain a JSON object'];
  const validationErrors = [];
  if (rawRecipe.version !== undefined && rawRecipe.version !== SUPPORTED_RECIPE_VERSION) {
    validationErrors.push(`"version" must be ${SUPPORTED_RECIPE_VERSION}`);
  }
  for (const stringField of ['location', 'branch_prefix', 'base']) {
    if (rawRecipe[stringField] !== undefined && !isNonEmptyString(rawRecipe[stringField])) validationErrors.push(`"${stringField}" must be a non-empty string`);
  }
  const extraModeNames = isPlainObject(rawRecipe.modes) ? Object.keys(rawRecipe.modes) : [];
  if (rawRecipe.modes !== undefined) {
    if (!isPlainObject(rawRecipe.modes)) validationErrors.push('"modes" must be an object of mode name -> options');
    else {
      for (const [modeName, modeOptions] of Object.entries(rawRecipe.modes)) {
        if (BUILT_IN_MODES.includes(modeName)) validationErrors.push(`"modes.${modeName}" is built in; name extra modes differently`);
        else if (!isPlainObject(modeOptions)) validationErrors.push(`"modes.${modeName}" must be an object`);
        else {
          if (modeOptions.sparse_exclude !== undefined && !isListOfStrings(modeOptions.sparse_exclude)) validationErrors.push(`"modes.${modeName}.sparse_exclude" must be a list of paths`);
          if (modeOptions.skip_setup !== undefined && typeof modeOptions.skip_setup !== 'boolean') validationErrors.push(`"modes.${modeName}.skip_setup" must be true or false`);
        }
      }
    }
  }
  if (rawRecipe.default_mode !== undefined && ![...BUILT_IN_MODES, ...extraModeNames].includes(rawRecipe.default_mode)) {
    validationErrors.push(`"default_mode" must be one of ${[...BUILT_IN_MODES, ...extraModeNames].join(', ')}`);
  }
  for (const listField of ['copy', 'setup']) {
    if (rawRecipe[listField] !== undefined && !isListOfStrings(rawRecipe[listField])) validationErrors.push(`"${listField}" must be a list of non-empty strings`);
  }
  if (rawRecipe.heavy !== undefined) {
    if (!Array.isArray(rawRecipe.heavy)) validationErrors.push('"heavy" must be a list of { path, strategy }');
    else {
      rawRecipe.heavy.forEach((heavyEntry, heavyIndex) => {
        if (!isPlainObject(heavyEntry) || !isNonEmptyString(heavyEntry.path)) validationErrors.push(`"heavy[${heavyIndex}].path" must be a non-empty path`);
        else if (!HEAVY_STRATEGIES.includes(heavyEntry.strategy)) validationErrors.push(`"heavy[${heavyIndex}].strategy" must be one of ${HEAVY_STRATEGIES.join(', ')}`);
        else if (heavyEntry.strategy === 'regenerate' && !isNonEmptyString(heavyEntry.command)) validationErrors.push(`"heavy[${heavyIndex}].command" is required for strategy regenerate`);
      });
    }
  }
  if (rawRecipe.disk_margin_percent !== undefined) {
    const marginPercent = rawRecipe.disk_margin_percent;
    if (typeof marginPercent !== 'number' || marginPercent < 0 || marginPercent >= 100) validationErrors.push('"disk_margin_percent" must be a number from 0 to 99');
  }
  if (rawRecipe.port !== undefined && rawRecipe.port !== null) {
    const portSettings = rawRecipe.port;
    if (!isPlainObject(portSettings)) validationErrors.push('"port" must be an object or null');
    else {
      if (!isNonEmptyString(portSettings.env_file)) validationErrors.push('"port.env_file" must be a path');
      if (!isListOfStrings(portSettings.variables) || portSettings.variables.length === 0) validationErrors.push('"port.variables" must list at least one variable name');
      const portRange = portSettings.range;
      if (portRange !== undefined && !(Array.isArray(portRange) && portRange.length === 2 && portRange.every(Number.isInteger)
        && portRange[0] >= 1024 && portRange[1] <= 65535 && portRange[0] < portRange[1])) {
        validationErrors.push('"port.range" must be [low, high] with 1024 <= low < high <= 65535');
      }
    }
  }
  if (rawRecipe.env !== undefined && !(isPlainObject(rawRecipe.env) && Object.values(rawRecipe.env).every((envValue) => typeof envValue === 'string'))) {
    validationErrors.push('"env" must be an object of variable name -> string');
  }
  if (rawRecipe.commands !== undefined) {
    const isCommandSpec = (commandSpec) => isNonEmptyString(commandSpec) || isListOfStrings(commandSpec);
    if (!(isPlainObject(rawRecipe.commands) && Object.values(rawRecipe.commands).every(isCommandSpec))) {
      validationErrors.push('"commands" must be an object of name -> command or list of commands');
    }
  }
  if (rawRecipe.finish !== undefined) {
    const finishSettings = rawRecipe.finish;
    if (!isPlainObject(finishSettings)) validationErrors.push('"finish" must be an object');
    else {
      if (finishSettings.strategy !== undefined && !['rebase', 'merge'].includes(finishSettings.strategy)) validationErrors.push('"finish.strategy" must be rebase or merge');
      if (finishSettings.allow_merge !== undefined && typeof finishSettings.allow_merge !== 'boolean') validationErrors.push('"finish.allow_merge" must be true or false');
      if (finishSettings.dirty_base_paths_ok !== undefined && !isListOfStrings(finishSettings.dirty_base_paths_ok)) validationErrors.push('"finish.dirty_base_paths_ok" must be a list of paths');
    }
  }
  if (rawRecipe.reminder_every !== undefined && !(Number.isInteger(rawRecipe.reminder_every) && rawRecipe.reminder_every >= 0)) {
    validationErrors.push('"reminder_every" must be a whole number (0 turns the periodic reminder off)');
  }
  return validationErrors;
}

export function listUnknownRecipeFields(rawRecipe) {
  if (!isPlainObject(rawRecipe)) return [];
  return Object.keys(rawRecipe).filter((fieldName) => !KNOWN_RECIPE_FIELDS.has(fieldName));
}

// status: 'missing' | 'invalid' (errors) | 'ok' (recipe merged with defaults, plus warnings).
export function loadRecipe(repoRoot) {
  const recipePath = join(repoRoot, RECIPE_RELATIVE_PATH);
  if (!existsSync(recipePath)) return { status: 'missing', recipePath };
  let rawRecipe;
  try {
    rawRecipe = JSON.parse(readFileSync(recipePath, 'utf8'));
  } catch (parseError) {
    return { status: 'invalid', recipePath, errors: [`not valid JSON: ${parseError.message}`] };
  }
  const validationErrors = validateRecipe(rawRecipe);
  if (validationErrors.length) return { status: 'invalid', recipePath, errors: validationErrors };
  const warnings = [
    ...listUnknownRecipeFields(rawRecipe).map((fieldName) => `field "${fieldName}" is unknown to this jig version; ignored`),
    ...PLANNED_RECIPE_FIELDS.filter((fieldName) => rawRecipe[fieldName] !== undefined).map((fieldName) => `field "${fieldName}" is planned, not built yet; ignored`),
  ];
  return {
    status: 'ok',
    recipePath,
    warnings,
    recipe: { ...DEFAULT_RECIPE, ...rawRecipe, finish: { ...DEFAULT_RECIPE.finish, ...rawRecipe.finish } },
  };
}
