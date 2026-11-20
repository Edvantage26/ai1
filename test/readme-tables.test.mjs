import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_MODULE_IDS } from '../src/core/module-index.mjs';
import { HOOK_README_INDEX, SKILL_ORIGIN_INDEX } from '../src/core/readme-index.mjs';
import { listSkillFolders, renderOrigin, renderReadmeTables, replaceReadmeTable, summarizeSkillDescription, tableMarkers } from '../scripts/readme-tables.mjs';

// Not import.meta.dirname: it needs Node 20.11, and CI runs Node 18 too.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

function assertSourcesHaveNameAndUrl(entryName, origin) {
  for (const originSource of [...origin.importedFrom, ...origin.basedOn]) {
    assert.ok(originSource.name && /^https:\/\//.test(originSource.url), `${entryName}: every source has a name and an https url`);
  }
}

test('every skill folder has an origin entry, and every entry a skill folder', () => {
  const skillFolders = listSkillFolders(REPO_ROOT);
  assert.deepEqual(skillFolders.filter((skillFolder) => !SKILL_ORIGIN_INDEX[skillFolder]), [], 'add the skill to src/core/readme-index.mjs');
  assert.deepEqual(Object.keys(SKILL_ORIGIN_INDEX).filter((skillFolder) => !skillFolders.includes(skillFolder)), []);
  for (const [skillFolder, skillOrigin] of Object.entries(SKILL_ORIGIN_INDEX)) assertSourcesHaveNameAndUrl(skillFolder, skillOrigin);
});

test('every hook module has a README entry with a description, and every entry a module', () => {
  assert.deepEqual(KNOWN_MODULE_IDS.filter((moduleId) => !HOOK_README_INDEX[moduleId]), [], 'add the module to HOOK_README_INDEX in src/core/readme-index.mjs');
  assert.deepEqual(Object.keys(HOOK_README_INDEX).filter((moduleId) => !KNOWN_MODULE_IDS.includes(moduleId)), []);
  for (const [moduleId, hookEntry] of Object.entries(HOOK_README_INDEX)) {
    assert.ok(hookEntry.description, `${moduleId}: a description`);
    assertSourcesHaveNameAndUrl(moduleId, hookEntry);
  }
});

test('the skills table of README.md and the hooks table of docs/reference.md are up to date (npm run readme-tables)', () => {
  // A Windows checkout may have CRLF line endings; the generated tables have LF.
  const readDocument = (documentPath) => readFileSync(join(REPO_ROOT, documentPath), 'utf8').replace(/\r\n/g, '\n');
  for (const { documentPath, currentText, updatedText } of renderReadmeTables(REPO_ROOT, readDocument)) {
    assert.equal(updatedText, currentText, `${documentPath} is out of date: run npm run readme-tables`);
  }
});

test('the summary is the first sentence of the description, without the feature prefix', () => {
  assert.equal(summarizeSkillDescription('Later — Note it down (called by number, "later 0003"). Use when the person asks.'), 'Note it down (called by number, "later 0003").');
  assert.equal(summarizeSkillDescription('OKF — Check a bundle\n  against the v0.2 spec (§11). Use when asked.'), 'Check a bundle against the v0.2 spec (§11).');
  assert.equal(summarizeSkillDescription('Core — No sentence end'), 'No sentence end');
});

test('the origin cell: written in ai1, imported from, based on', () => {
  const source = { name: 'Example', url: 'https://example.com' };
  assert.equal(renderOrigin({ importedFrom: [], basedOn: [] }), 'Written in ai1');
  assert.equal(renderOrigin({ importedFrom: [{ ...source, license: 'MIT', what: 'the skill' }], basedOn: [{ ...source, what: 'its method' }] }),
    'Imported from [Example](https://example.com) (MIT; the skill); based on [Example](https://example.com) (its method)');
  assert.equal(renderOrigin({ importedFrom: [], basedOn: [source] }), 'Based on [Example](https://example.com)');
});

test('replacing a table keeps the text around its markers and needs both markers', () => {
  const { startMarker, endMarker } = tableMarkers('hooks');
  const readmeText = `intro\n${startMarker}\nold\n${endMarker}\noutro\n`;
  assert.equal(replaceReadmeTable(readmeText, 'hooks', 'new'), `intro\n${startMarker}\nnew\n${endMarker}\noutro\n`);
  assert.throws(() => replaceReadmeTable('no markers', 'hooks', 'new'), /hooks table markers/);
});
