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
