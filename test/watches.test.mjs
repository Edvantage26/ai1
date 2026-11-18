import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseDuration, validateWatchDefinition, listWatchDefinitions, writeWatchDefinition, findWatchDefinition,
} from '../src/watches/watch-definitions.mjs';
import { createTemporaryProject } from './helpers.mjs';

const HEALTH_WATCH = { title: 'Checkout in production', check: { kind: 'command', run: ['node', '-e', 'process.exit(0)'] }, every: '1d', suggestedFor: '14d', createdBy: 'ana@x.com' };

test('watch definitions: durations in hours or days', () => {
  assert.equal(parseDuration('12h'), 12 * 3600 * 1000);
  assert.equal(parseDuration('14d'), 14 * 86400 * 1000);
  assert.equal(parseDuration('2w'), null);
  assert.equal(parseDuration(undefined), null);
});

test('watch definitions: a command or agent check is valid; the rest is explained', () => {
  assert.deepEqual(validateWatchDefinition(HEALTH_WATCH), []);
  assert.deepEqual(validateWatchDefinition({ title: 'Usage', check: { kind: 'command', run: 'curl -fsS https://example.test/stats', expect: 'counts' } }), []);
  assert.deepEqual(validateWatchDefinition({ title: 'Logs', check: { kind: 'agent', prompt: 'Look for new errors in the logs' } }), []);
  assert.deepEqual(validateWatchDefinition({ title: '', check: { kind: 'shell' }, every: 'daily', extra: 1 }),
    ['unknown field "extra"', '"title" must be a non-empty string', '"check.kind" must be "command" or "agent"', '"every" must be a duration like 12h or 14d']);
  assert.deepEqual(validateWatchDefinition({ title: 'x', check: { kind: 'command', run: [], expect: { exitCode: 'zero' } } }),
    ['"check.run" must be a list of arguments or a command line', '"check.expect" must be { "exitCode": n } or "counts"']);
});

test('watch definitions: written and listed from .ai1/watches/, a broken file listed with its error', () => {
  const projectRoot = createTemporaryProject({});
  writeWatchDefinition(projectRoot, 'checkout-prod', HEALTH_WATCH);
  writeFileSync(join(projectRoot, '.ai1', 'watches', 'broken.json'), '{ nope');
  const watchEntries = listWatchDefinitions(projectRoot);
  assert.deepEqual(watchEntries.map((watchEntry) => [watchEntry.id, watchEntry.errors.length]), [['broken', 1], ['checkout-prod', 0]]);
  assert.deepEqual(findWatchDefinition(projectRoot, 'checkout-prod').definition, HEALTH_WATCH);
  assert.throws(() => writeWatchDefinition(projectRoot, 'Bad Id', HEALTH_WATCH), /lower-case letters/);
  assert.throws(() => writeWatchDefinition(projectRoot, 'no-check', { title: 'x' }), /"check" must be an object/);
});

test('watch schema: every field the validator knows is in schema/watch.schema.json', () => {
  const watchSchema = JSON.parse(readFileSync(fileURLToPath(new URL('../schema/watch.schema.json', import.meta.url)), 'utf8'));
  assert.deepEqual(Object.keys(watchSchema.properties).sort(), ['$schema', 'check', 'createdBy', 'description', 'every', 'suggestedFor', 'title']);
  assert.deepEqual(Object.keys(watchSchema.properties.check.properties).sort(), ['expect', 'kind', 'prompt', 'run', 'timeoutSeconds']);
});
