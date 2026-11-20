import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SKILL_ORIGIN_INDEX } from '../src/core/skill-origin-index.mjs';
import {
  listSkillFolders, renderSkillOrigin, renderSkillsTable, replaceSkillsTable, summarizeSkillDescription,
  SKILLS_TABLE_END_MARKER, SKILLS_TABLE_START_MARKER,
} from '../scripts/readme-skills.mjs';

// Not import.meta.dirname: it needs Node 20.11, and CI runs Node 18 too.
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

test('every skill folder has an origin entry, and every entry a skill folder', () => {
  const skillFolders = listSkillFolders(REPO_ROOT);
  assert.deepEqual(skillFolders.filter((skillFolder) => !SKILL_ORIGIN_INDEX[skillFolder]), [], 'add the skill to src/core/skill-origin-index.mjs');
  assert.deepEqual(Object.keys(SKILL_ORIGIN_INDEX).filter((skillFolder) => !skillFolders.includes(skillFolder)), []);
  for (const [skillFolder, skillOrigin] of Object.entries(SKILL_ORIGIN_INDEX)) {
    for (const skillSource of [...skillOrigin.importedFrom, ...skillOrigin.basedOn]) {
      assert.ok(skillSource.name && /^https:\/\//.test(skillSource.url), `${skillFolder}: every source has a name and an https url`);
    }
  }
});

test('the README skills table is up to date (npm run readme-skills)', () => {
  // A Windows checkout may have CRLF line endings; the generated table has LF.
  const readmeText = readFileSync(join(REPO_ROOT, 'README.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(replaceSkillsTable(readmeText, renderSkillsTable(REPO_ROOT)), readmeText, 'README.md is out of date: run npm run readme-skills');
});

test('the summary is the first sentence of the description, without the feature prefix', () => {
  assert.equal(summarizeSkillDescription('Later — Note it down (called by number, "later 0003"). Use when the person asks.'), 'Note it down (called by number, "later 0003").');
  assert.equal(summarizeSkillDescription('OKF — Check a bundle\n  against the v0.2 spec (§11). Use when asked.'), 'Check a bundle against the v0.2 spec (§11).');
  assert.equal(summarizeSkillDescription('Core — No sentence end'), 'No sentence end');
});

test('the origin cell: written in ai1, imported from, based on', () => {
  const source = { name: 'Example', url: 'https://example.com' };
  assert.equal(renderSkillOrigin({ importedFrom: [], basedOn: [] }), 'Written in ai1');
  assert.equal(renderSkillOrigin({ importedFrom: [{ ...source, license: 'MIT', what: 'the skill' }], basedOn: [{ ...source, what: 'its method' }] }),
    'Imported from [Example](https://example.com) (MIT; the skill); based on [Example](https://example.com) (its method)');
  assert.equal(renderSkillOrigin({ importedFrom: [], basedOn: [source] }), 'Based on [Example](https://example.com)');
});

test('replacing the table keeps the text around the markers and needs both markers', () => {
  const readmeText = `intro\n${SKILLS_TABLE_START_MARKER}\nold\n${SKILLS_TABLE_END_MARKER}\noutro\n`;
  assert.equal(replaceSkillsTable(readmeText, 'new'), `intro\n${SKILLS_TABLE_START_MARKER}\nnew\n${SKILLS_TABLE_END_MARKER}\noutro\n`);
  assert.throws(() => replaceSkillsTable('no markers', 'new'), /markers/);
});
