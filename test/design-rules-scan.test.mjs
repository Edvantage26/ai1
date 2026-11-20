import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatScanReport, parseScanArguments, scanRepositories } from '../scripts/design-rules-scan.mjs';

function createRepositoryWithUiFiles() {
  const repositoryPath = mkdtempSync(join(tmpdir(), 'ai1-scan-'));
  mkdirSync(join(repositoryPath, 'src'));
  writeFileSync(join(repositoryPath, 'src', 'styles.css'), '.legal { font-size: 9px; }\nbody { font-family: Inter; }\n');
  writeFileSync(join(repositoryPath, 'src', 'notes.md'), 'font-size: 9px\n');
  writeFileSync(join(repositoryPath, 'untracked.css'), '.legal { font-size: 9px; }\n');
  execFileSync('git', ['init', '-q'], { cwd: repositoryPath });
  execFileSync('git', ['add', 'src'], { cwd: repositoryPath });
  return repositoryPath;
}

test('design-rules-scan: counts hits per rule on tracked UI files only, with examples and timing', () => {
  const repositoryPath = createRepositoryWithUiFiles();
  const scanResult = scanRepositories(parseScanArguments([repositoryPath, '--rules', 'tiny-text,overused-font,emoji-icon']));
  assert.equal(scanResult.scannedFiles, 1, 'only the tracked stylesheet');
  const ruleById = Object.fromEntries(scanResult.rules.map((ruleReport) => [ruleReport.id, ruleReport]));
  assert.deepEqual(Object.keys(ruleById).sort(), ['emoji-icon', 'overused-font', 'tiny-text']);
  assert.equal(ruleById['tiny-text'].hits, 1);
  assert.match(ruleById['tiny-text'].examples[0].file, /src\/styles\.css$/);
  assert.equal(ruleById['tiny-text'].examples[0].line, 1);
  assert.equal(ruleById['emoji-icon'].hits, 0, 'a markup-only rule does not run on a stylesheet');
  assert.ok(ruleById['overused-font'].totalMilliseconds >= 0);
  assert.match(formatScanReport(scanResult), /tiny-text \| 1 \|/);
});

test('design-rules-scan: rejects unknown rule ids and a missing repository', () => {
  assert.throws(() => parseScanArguments(['.', '--rules', 'no-such-rule']), /unknown rule ids: no-such-rule/);
  assert.throws(() => parseScanArguments([]), /usage/);
});
