import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readJson = (relativePath) => JSON.parse(readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8'));

test('plugin, marketplace and package versions are in sync', () => {
  const pluginVersion = readJson('.claude-plugin/plugin.json').version;
  assert.equal(readJson('.claude-plugin/marketplace.json').metadata.version, pluginVersion);
  assert.equal(readJson('package.json').version, pluginVersion);
});

test('every hook command points to the single entrypoint with a known event', () => {
  const hooksConfig = readJson('hooks/hooks.json').hooks;
  for (const [eventName, matcherGroups] of Object.entries(hooksConfig)) {
    for (const hookCommand of matcherGroups.flatMap((matcherGroup) => matcherGroup.hooks)) {
      assert.equal(hookCommand.command, `node "\${CLAUDE_PLUGIN_ROOT}/bin/ai1-hook.mjs" ${eventName}`);
    }
  }
  assert.ok(existsSync(fileURLToPath(new URL('../bin/ai1-hook.mjs', import.meta.url))));
});

test('the OKF toolkit ships without the backfill skill, its agents or Python [okf-node:S5]', () => {
  const repoPath = (relativePath) => fileURLToPath(new URL(`../${relativePath}`, import.meta.url));
  assert.equal(existsSync(repoPath('skills/okf-backfill-from-history')), false);
  assert.equal(existsSync(repoPath('agents')), false);
  assert.doesNotMatch(readJson('package.json').scripts.test, /python/);
  assert.equal(existsSync(repoPath('vendor/yaml')), false);
  assert.match(readFileSync(repoPath('skills/okf-maintain-knowledge/reference/sources.md'), 'utf8'), /git log --oneline --no-merges/);
});
