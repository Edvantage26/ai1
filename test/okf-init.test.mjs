// `ai1 okf init` (src/okf/okf-init.mjs): the scaffold validates strict-clean and refuses a used folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOkfInitCommand } from '../src/okf/okf-init.mjs';
import { validateOkfBundle } from '../src/okf/okf-validate.mjs';

const silent = () => {};

test('ai1 okf init scaffolds a strict-clean bundle, titled from the folder or --title [okf-node:S4]', () => {
  const parentDirectory = mkdtempSync(join(tmpdir(), 'ai1-okf-init-'));
  const namedBundle = join(parentDirectory, 'my-cool_bundle');
  assert.equal(runOkfInitCommand([namedBundle], silent, silent, new Date('2026-11-15T10:20:30.456Z')), 0);
  assert.deepEqual(validateOkfBundle(namedBundle), { errors: [], warnings: [], concepts: 1, indexes: 1, logs: 1 });
  assert.match(readFileSync(join(namedBundle, 'index.md'), 'utf8'), /^---\nokf_version: '0\.2'\n---\n\n# My Cool Bundle\n/);
  assert.match(readFileSync(join(namedBundle, 'log.md'), 'utf8'), /\n## 2026-11-15\n/);
  assert.match(readFileSync(join(namedBundle, 'getting-started.md'), 'utf8'), /\n {2}at: '2026-11-15T10:20:30Z'\n/);
  const titledBundle = join(parentDirectory, 'titled');
  assert.equal(runOkfInitCommand(['--title', 'Auth: tokens # v2', titledBundle], silent, silent), 0);
  assert.deepEqual(validateOkfBundle(titledBundle).warnings, []);
  assert.match(readFileSync(join(titledBundle, 'getting-started.md'), 'utf8'), /\ntitle: "Getting started — Auth: tokens # v2"\n/);
});

test('ai1 okf init --no-starter writes only index and log, the creation entry linking to the index', () => {
  const bundleDirectory = join(mkdtempSync(join(tmpdir(), 'ai1-okf-init-')), 'acme');
  assert.equal(runOkfInitCommand([bundleDirectory, '--no-starter', '--title', 'Acme'], silent, silent), 0);
  assert.equal(existsSync(join(bundleDirectory, 'getting-started.md')), false);
  const { errors, warnings } = validateOkfBundle(bundleDirectory);
  assert.deepEqual({ errors, warnings }, { errors: [], warnings: [] });
  assert.doesNotMatch(readFileSync(join(bundleDirectory, 'index.md'), 'utf8'), /getting-started/);
  assert.match(readFileSync(join(bundleDirectory, 'log.md'), 'utf8'), /\[index\]\(index\.md\)/);
});

test('ai1 okf init refuses a folder with .md files unless --force, and a file as target', () => {
  const bundleDirectory = mkdtempSync(join(tmpdir(), 'ai1-okf-init-'));
  assert.equal(runOkfInitCommand([bundleDirectory], silent, silent), 0);
  const refusals = [];
  assert.equal(runOkfInitCommand([bundleDirectory], silent, (line) => refusals.push(line)), 1);
  assert.match(refusals[0], /already contains \.md files/);
  assert.equal(runOkfInitCommand([bundleDirectory, '--force'], silent, silent), 0);
  assert.equal(runOkfInitCommand([join(bundleDirectory, 'index.md')], silent, silent), 2);
  assert.equal(runOkfInitCommand([], silent, silent), 2);
});
