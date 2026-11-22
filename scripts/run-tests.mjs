#!/usr/bin/env node
// Runs the test suite inside a temporary folder of its own and deletes it afterwards.
// The tests create their fixtures with mkdtempSync(join(tmpdir(), ...)) and do not remove them;
// the leftovers once filled a server's disk. Pointing TMPDIR, TMP and TEMP at a per-run folder
// makes os.tmpdir() resolve there, in the tests and in every process they start, so one rmSync
// at the end cleans everything.
// HOME (USERPROFILE on Windows) points at an empty folder of the run too: hooks that act on the
// person's own config (config-sync-*) must never touch the real one. Git keeps the real global config
// (GIT_CONFIG_GLOBAL) for its identity.
// Usage: node scripts/run-tests.mjs [test files...] (no arguments: every test/*.test.mjs).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const test_folder = join(dirname(dirname(fileURLToPath(import.meta.url))), 'test');
const requested_files = process.argv.slice(2);
const test_files = requested_files.length > 0
  ? requested_files
  : readdirSync(test_folder).filter((file_name) => file_name.endsWith('.test.mjs')).sort()
    .map((file_name) => join(test_folder, file_name));

const run_temp_folder = mkdtempSync(join(tmpdir(), 'ai1-test-run-'));
const run_home_folder = join(run_temp_folder, 'home');
mkdirSync(run_home_folder);
const real_git_config = process.env.GIT_CONFIG_GLOBAL || join(homedir(), '.gitconfig');
const { XDG_CONFIG_HOME: _real_xdg_config_home, ...inherited_environment } = process.env;
let exit_code = 1;
try {
  const test_run = spawnSync(process.execPath, ['--test', ...test_files], {
    stdio: 'inherit',
    env: {
      ...inherited_environment,
      TMPDIR: run_temp_folder, TMP: run_temp_folder, TEMP: run_temp_folder,
      HOME: run_home_folder, USERPROFILE: run_home_folder,
      ...(existsSync(real_git_config) ? { GIT_CONFIG_GLOBAL: real_git_config } : {}),
    },
  });
  if (test_run.error) console.error(`run-tests: could not start node --test: ${test_run.error.message}`);
  exit_code = test_run.status ?? 1;
} finally {
  rmSync(run_temp_folder, { recursive: true, force: true });
}
process.exit(exit_code);
