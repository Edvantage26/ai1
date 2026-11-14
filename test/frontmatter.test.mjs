import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitFrontmatter, readFrontmatterField, writeFrontmatterField } from '../src/core/frontmatter.mjs';
import { readPlanStatus, readPlanTitle } from '../src/sizing/sizing-work.mjs';
import { readBundleSpecVersion } from '../src/okf/okf-bundle.mjs';

const CRLF_CONCEPT = '---\r\ntype: Decision\r\ntitle: Use CRLF\r\ntags:\r\n  - windows\r\n  - git\r\n---\r\n\r\n# Body\r\n';

test('splitFrontmatter and readFrontmatterField read CRLF files', () => {
  const { frontmatterText, bodyText } = splitFrontmatter(CRLF_CONCEPT);
  assert.notEqual(frontmatterText, null);
  assert.equal(readFrontmatterField(frontmatterText, 'type'), 'Decision');
  assert.equal(readFrontmatterField(frontmatterText, 'title'), 'Use CRLF');
  assert.equal(readFrontmatterField(frontmatterText, 'tags'), 'windows git');
  assert.equal(bodyText, '\r\n# Body\r\n');
});

test('plan and bundle readers read CRLF frontmatter', () => {
  assert.equal(readPlanStatus('---\r\nstatus: approved\r\ntitle: Ship it\r\n---\r\n'), 'approved');
  assert.equal(readPlanTitle('---\r\nstatus: approved\r\ntitle: Ship it\r\n---\r\n', 'fallback'), 'Ship it');
  assert.equal(readBundleSpecVersion('---\r\nokf_version: "0.2"\r\n---\r\n'), '0.2');
});

test('writeFrontmatterField keeps CRLF and writes $ patterns as they are', () => {
  const replacedText = writeFrontmatterField(CRLF_CONCEPT, 'title', 'Save $& and $$');
  assert.match(replacedText, /^---\r\ntype: Decision\r\ntitle: Save \$& and \$\$\r\n/);
  const appendedText = writeFrontmatterField(CRLF_CONCEPT, 'status', 'done');
  assert.match(appendedText, /  - git\r\nstatus: done\r\n---\r\n\r\n# Body\r\n$/);
  assert.equal(writeFrontmatterField('---\nstatus: draft\n---\nbody\n', 'status', 'ready'), '---\nstatus: ready\n---\nbody\n');
});

test('readFrontmatterField reads block lists and leaves empty fields empty', () => {
  assert.equal(readFrontmatterField('type: x\ntags:\n  - windows\n  - git\nowner: y', 'tags'), 'windows git');
  assert.equal(readFrontmatterField('tags: [a, b]', 'tags'), 'a, b');
  assert.equal(readFrontmatterField('title:\nowner: y', 'title'), '');
});

test('splitFrontmatter closes only on a line that is --- (trailing spaces allowed): one splitter for hooks and the OKF toolkit', () => {
  assert.deepEqual(splitFrontmatter('---\ntype: A\n---x\nstill: frontmatter\n---\nbody\n'), { frontmatterText: 'type: A\n---x\nstill: frontmatter\n', bodyText: 'body\n' });
  assert.deepEqual(splitFrontmatter('---  \nstatus: ready\n---\t\nbody'), { frontmatterText: 'status: ready\n', bodyText: 'body' });
  assert.equal(readPlanStatus('---  \nstatus: ready\n---\n'), 'ready');
  assert.equal(splitFrontmatter('---\nstatus: ready\n').frontmatterText, null, 'an unclosed block is not frontmatter');
});
