import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runOkfScanSecretsCommand, scanSecrets } from '../src/okf/okf-scan-secrets.mjs';
import { findSecretLines } from '../src/core/secret-lines.mjs';

const fakeKey = ['abc', 'DEF', '123', 'ghi', 'JKL', '456'].join('');

test('scan-secrets lists file:line of secret-looking lines in files and folders, never the value [okf-findings-2:S5]', () => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'ai1-scan-'));
  mkdirSync(join(projectRoot, 'docker'));
  mkdirSync(join(projectRoot, 'node_modules', 'pkg'), { recursive: true });
  writeFileSync(join(projectRoot, 'docker', 'compose.yml'), `services:\n  worker:\n    environment:\n      PG_PASSWORD: \${PG_PASSWORD:-${fakeKey}}\n      PG_USER: app\n`);
  writeFileSync(join(projectRoot, 'notes.md'), `# Notes\nAPI key: ${fakeKey}\nThe token lives in op://Vault/item/token.\n`);
  writeFileSync(join(projectRoot, 'node_modules', 'pkg', 'x.js'), `const apiKey = "${fakeKey}";\n`);
  assert.deepEqual(scanSecrets(['docker', 'notes.md'], projectRoot), [{ file: join('docker', 'compose.yml'), lines: [4] }, { file: 'notes.md', lines: [2] }]);
  const printedLines = [];
  assert.equal(runOkfScanSecretsCommand(projectRoot, ['.'], (line) => printedLines.push(line)), 1);
  assert.ok(printedLines.every((line) => !line.includes(fakeKey)), 'the value is never printed');
  assert.ok(!printedLines.some((line) => line.includes('node_modules')), 'dependency folders are skipped');
  assert.equal(runOkfScanSecretsCommand(projectRoot, ['docker/../notes.md', '--json'], () => {}), 1);
  writeFileSync(join(projectRoot, 'clean.md'), 'nothing here\n');
  assert.equal(runOkfScanSecretsCommand(projectRoot, ['clean.md'], () => {}), 0);
  assert.equal(runOkfScanSecretsCommand(projectRoot, [], () => {}, () => {}), 2);
});

test('a shell default after a secret label is a literal; an env reference alone is not [okf-findings-2:S5]', () => {
  assert.deepEqual(findSecretLines(`PG_PASSWORD: \${PG_PASSWORD:-${fakeKey}}\nPG_PASSWORD: \${PG_PASSWORD}\nTOKEN=\${TOKEN:-changeme}\n`), [1]);
});
