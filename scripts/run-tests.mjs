#!/usr/bin/env node
// Runs the test suite inside a temporary folder of its own and deletes it afterwards.
// The tests create their fixtures with mkdtempSync(join(tmpdir(), ...)) and do not remove them;
// the leftovers once filled a server's disk. Pointing TMPDIR, TMP and TEMP at a per-run folder
// makes os.tmpdir() resolve there, in the tests and in every process they start, so one rmSync
// at the end cleans everything.
// Usage: node scripts/run-tests.mjs [test files...] (no arguments: every test/*.test.mjs).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const test_folder = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test');
const requested_files = process.argv.slice(2);
const test_files = requested_files.length > 0
  ? requested_files
  : readdirSync(test_folder).filter((file_name) => file_name.endsWith('.test.mjs')).sort()
    .map((file_name) => join(test_folder, file_name));

const run_temp_folder = mkdtempSync(join(tmpdir(), 'ai1-test-run-'));
let exit_code = 1;
try {
  const test_run = spawnSync(process.execPath, ['--test', ...test_files], {
    stdio: 'inherit',
    env: { ...process.env, TMPDIR: run_temp_folder, TMP: run_temp_folder, TEMP: run_temp_folder },
  });
  if (test_run.error) console.error(`run-tests: could not start node --test: ${test_run.error.message}`);
  exit_code = test_run.status ?? 1;
} finally {
  rmSync(run_temp_folder, { recursive: true, force: true });
}
process.exit(exit_code);
