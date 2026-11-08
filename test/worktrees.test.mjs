import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRecipe, loadRecipe, listUnknownRecipeFields, DEFAULT_RECIPE, RECIPE_RELATIVE_PATH } from '../src/worktrees/worktree-recipe.mjs';
import { createTemporaryProject } from './helpers.mjs';

const readJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));

test('recipe: the shipped template is valid and has no unknown fields', () => {
  const templateRecipe = readJson('templates/worktree-skill/recipe.json');
  assert.deepEqual(validateRecipe(templateRecipe), []);
  assert.deepEqual(listUnknownRecipeFields(templateRecipe), []);
});

test('recipe: the schema documents every field the validator knows', () => {
  const schemaFields = Object.keys(readJson('schema/worktree-recipe.schema.json').properties);
  for (const fieldName of [...Object.keys(DEFAULT_RECIPE), '$schema', 'caches', 'slots']) assert.ok(schemaFields.includes(fieldName), fieldName);
  assert.deepEqual(listUnknownRecipeFields(Object.fromEntries(schemaFields.map((fieldName) => [fieldName, null]))), []);
});

test('recipe: invalid recipes are reported with a readable reason', () => {
  assert.match(validateRecipe([]).join(), /JSON object/);
  assert.match(validateRecipe({ version: 2 }).join(), /version/);
  assert.match(validateRecipe({ heavy: [{ path: 'x', strategy: 'zip' }] }).join(), /heavy\[0\]\.strategy/);
  assert.match(validateRecipe({ heavy: [{ path: 'node_modules', strategy: 'regenerate' }] }).join(), /command/);
  assert.match(validateRecipe({ modes: { full: {} } }).join(), /built in/);
  assert.match(validateRecipe({ default_mode: 'tiny' }).join(), /default_mode/);
  assert.deepEqual(validateRecipe({ default_mode: 'tiny', modes: { tiny: { sparse_exclude: ['assets'] } } }), []);
  assert.match(validateRecipe({ port: { env_file: '.env', variables: [] } }).join(), /port.variables/);
  assert.match(validateRecipe({ port: { env_file: '.env', variables: ['PORT'], range: [80, 90] } }).join(), /port.range/);
  assert.match(validateRecipe({ commands: { build: 3 } }).join(), /commands/);
  assert.match(validateRecipe({ finish: { strategy: 'squash' } }).join(), /finish.strategy/);
  assert.match(validateRecipe({ disk_margin_percent: 100 }).join(), /disk_margin_percent/);
});

test('recipe: load merges defaults and warns about unknown and planned fields', () => {
  const repoRoot = createTemporaryProject();
  assert.equal(loadRecipe(repoRoot).status, 'missing');
  mkdirSync(join(repoRoot, '.claude', 'skills', 'worktree'), { recursive: true });
  writeFileSync(join(repoRoot, RECIPE_RELATIVE_PATH), '{ nope');
  assert.equal(loadRecipe(repoRoot).status, 'invalid');
  writeFileSync(join(repoRoot, RECIPE_RELATIVE_PATH), JSON.stringify({ copy: ['.env'], finish: { strategy: 'merge' }, caches: [], teleport: 1 }));
  const loadedRecipe = loadRecipe(repoRoot);
  assert.equal(loadedRecipe.status, 'ok');
  assert.deepEqual(loadedRecipe.recipe.copy, ['.env']);
  assert.equal(loadedRecipe.recipe.branch_prefix, 'wt/');
  assert.deepEqual(loadedRecipe.recipe.finish, { strategy: 'merge', allow_merge: true, dirty_base_paths_ok: [] });
  assert.equal(loadedRecipe.warnings.length, 2);
});
