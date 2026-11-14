import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installStableLauncher, quoteForShell } from '../src/core/stable-launcher.mjs';

const HOOK_ENTRYPOINT = fileURLToPath(new URL('../bin/ai1-hook.mjs', import.meta.url));

// A fake plugin cache: one folder per version, each with a bin/ai1 that prints its version.
function createFakeCache(versionNames) {
  const cacheDirectory = mkdtempSync(join(tmpdir(), 'ai1-cache-'));
  for (const versionName of versionNames) {
    mkdirSync(join(cacheDirectory, versionName, 'bin'), { recursive: true });
    writeFileSync(join(cacheDirectory, versionName, 'bin', 'ai1'), `console.log('ai1 ${versionName}', process.argv.slice(2).join(' '));\n`);
  }
  return cacheDirectory;
}

function runLauncher(pluginData, extraEnvironment = {}) {
  return spawnSync('sh', [join(pluginData, 'bin', 'ai1'), 'skill-context', 'later-write'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...extraEnvironment },
  });
}

test('the launcher runs the version that wrote it while that folder exists', () => {
  const cacheDirectory = createFakeCache(['0.9.0', '0.10.0']);
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  const installReport = installStableLauncher({ CLAUDE_PLUGIN_ROOT: join(cacheDirectory, '0.9.0'), CLAUDE_PLUGIN_DATA: pluginData });
  assert.equal(installReport.launcher, 'written');
  assert.ok(statSync(join(pluginData, 'bin', 'ai1')).mode & 0o100, 'the launcher is executable');
  const launcherRun = runLauncher(pluginData);
  assert.equal(launcherRun.status, 0, launcherRun.stderr);
  assert.equal(launcherRun.stdout.trim(), 'ai1 0.9.0 skill-context later-write');
});

test('the launcher prefers AI1_PLUGIN_ROOT, the version of the session running it', () => {
  const cacheDirectory = createFakeCache(['0.9.0', '0.10.0']);
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  installStableLauncher({ CLAUDE_PLUGIN_ROOT: join(cacheDirectory, '0.10.0'), CLAUDE_PLUGIN_DATA: pluginData });
  const launcherRun = runLauncher(pluginData, { AI1_PLUGIN_ROOT: join(cacheDirectory, '0.9.0') });
  assert.equal(launcherRun.stdout.trim(), 'ai1 0.9.0 skill-context later-write');
});

test('after an update removes the session version, the launcher runs the newest one left', () => {
  const cacheDirectory = createFakeCache(['0.36.0', '0.9.0', '0.38.0']);
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  installStableLauncher({ CLAUDE_PLUGIN_ROOT: join(cacheDirectory, '0.36.0'), CLAUDE_PLUGIN_DATA: pluginData });
  rmSync(join(cacheDirectory, '0.36.0'), { recursive: true });
  const launcherRun = runLauncher(pluginData, { AI1_PLUGIN_ROOT: join(cacheDirectory, '0.36.0') });
  assert.equal(launcherRun.status, 0, launcherRun.stderr);
  assert.equal(launcherRun.stdout.trim(), 'ai1 0.38.0 skill-context later-write');
});

test('with no version left the launcher says so and exits 127', () => {
  const cacheDirectory = createFakeCache(['0.36.0']);
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  installStableLauncher({ CLAUDE_PLUGIN_ROOT: join(cacheDirectory, '0.36.0'), CLAUDE_PLUGIN_DATA: pluginData });
  rmSync(join(cacheDirectory, '0.36.0'), { recursive: true });
  const launcherRun = runLauncher(pluginData);
  assert.equal(launcherRun.status, 127);
  assert.match(launcherRun.stderr, /no installed ai1 found/);
});

test('a --plugin-dir root (not a version folder) never falls back to its siblings', () => {
  const parentDirectory = createFakeCache(['1.0.0']);
  const pluginRoot = join(parentDirectory, 'ai1-checkout');
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  installStableLauncher({ CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: pluginData });
  assert.equal(runLauncher(pluginData).status, 127);
});

test('the session environment file gets PATH and AI1_PLUGIN_ROOT once, and a rerun changes nothing', () => {
  const cacheDirectory = createFakeCache(['0.9.0']);
  const pluginData = mkdtempSync(join(tmpdir(), "ai1 data's-"));
  const sessionEnvironmentFile = join(mkdtempSync(join(tmpdir(), 'ai1-env-')), 'session.sh');
  const environment = { CLAUDE_PLUGIN_ROOT: join(cacheDirectory, '0.9.0'), CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_ENV_FILE: sessionEnvironmentFile };
  assert.deepEqual(installStableLauncher(environment), { launcher: 'written', sessionEnvironment: 'written' });
  assert.deepEqual(installStableLauncher(environment), { launcher: 'unchanged', sessionEnvironment: 'unchanged' });
  const sourcedRun = spawnSync('sh', ['-c', `. ${quoteForShell(sessionEnvironmentFile)} && ai1 status && printf '%s' "$AI1_PLUGIN_ROOT"`], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(sourcedRun.status, 0, sourcedRun.stderr);
  assert.equal(sourcedRun.stdout, `ai1 0.9.0 status\n${join(cacheDirectory, '0.9.0')}`);
  assert.equal(readFileSync(sessionEnvironmentFile, 'utf8').split('\n').filter(Boolean).length, 2);
});

test('without the plugin variables nothing is written', () => {
  assert.deepEqual(installStableLauncher({}), { launcher: 'skipped', sessionEnvironment: 'skipped' });
});

test('the hook entry point installs the launcher at SessionStart, even in a repo without ai1', () => {
  const pluginData = mkdtempSync(join(tmpdir(), 'ai1-data-'));
  const projectRoot = mkdtempSync(join(tmpdir(), 'ai1-bare-'));
  const hookRun = spawnSync(process.execPath, [HOOK_ENTRYPOINT, 'SessionStart'], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: projectRoot, session_id: 'launcher-test' }),
    encoding: 'utf8',
    env: { PATH: process.env.PATH, AI1_DECISION_LOG: '0', HOME: mkdtempSync(join(tmpdir(), 'ai1-home-')), CLAUDE_PLUGIN_ROOT: fileURLToPath(new URL('..', import.meta.url)), CLAUDE_PLUGIN_DATA: pluginData },
  });
  assert.equal(hookRun.status, 0, hookRun.stderr);
  const launcherRun = spawnSync('sh', [join(pluginData, 'bin', 'ai1'), 'skill-context', '--list'], { encoding: 'utf8', cwd: projectRoot, env: { PATH: process.env.PATH, HOME: mkdtempSync(join(tmpdir(), 'ai1-home-')) } });
  assert.equal(launcherRun.status, 0, launcherRun.stderr);
  assert.match(launcherRun.stdout, /later-write/);
});
