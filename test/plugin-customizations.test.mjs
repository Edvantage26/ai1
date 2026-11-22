import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTemporaryProject } from './helpers.mjs';
import { findPluginInstallPath, listEnabledPluginInstalls } from '../src/core/plugin-customizations.mjs';
import { runSkillContextCommand } from '../src/cli/skill-context-command.mjs';

const noEnvironment = {};

function writeJson(filePath, jsonValue) {
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(jsonValue, null, 2)}\n`);
}

// A home with a plugin `team-stack@team-stack` installed at user scope, carrying a customization of
// the okf feature; `enabled` decides whether the user settings switch it on.
function createHomeWithPlugin({ enabled = true, installedPluginsText } = {}) {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  const installPath = join(homeDirectory, '.claude', 'plugins', 'cache', 'team-stack', 'team-stack', '1.0.0');
  mkdirSync(join(installPath, 'ai1', 'skills', 'okf'), { recursive: true });
  writeFileSync(join(installPath, 'ai1', 'skills', 'okf', 'customization.md'), '- Operations: describe them with the team-stack skill.\n');
  const installedPluginsPath = join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json');
  if (installedPluginsText !== undefined) {
    writeFileSync(installedPluginsPath, installedPluginsText);
  } else {
    writeJson(installedPluginsPath, { version: 2, plugins: { 'team-stack@team-stack': [{ scope: 'user', installPath, version: '1.0.0', lastUpdated: '2026-11-22T10:00:00.000Z' }] } });
  }
  writeJson(join(homeDirectory, '.claude', 'settings.json'), { enabledPlugins: { 'ai1@ai1': true, 'team-stack@team-stack': enabled } });
  return { homeDirectory, installPath };
}

function skillContextText(commandArguments, workingDirectory, homeDirectory) {
  const printedTexts = [];
  const exitCode = runSkillContextCommand(commandArguments, { workingDirectory, environment: noEnvironment, homeDirectory, writeOutput: (printedText) => printedTexts.push(printedText) });
  return { exitCode, printedText: printedTexts.join('\n') };
}

test('an enabled plugin brings its customization of an ai1 skill, after the project and the person, named by the plugin [prod-stack:S1]', () => {
  const projectRoot = createTemporaryProject();
  mkdirSync(join(projectRoot, '.ai1', 'skills', 'okf'), { recursive: true });
  writeFileSync(join(projectRoot, '.ai1', 'skills', 'okf', 'customization.md'), '- Project rule.\n');
  const { homeDirectory } = createHomeWithPlugin();
  mkdirSync(join(homeDirectory, '.config', 'ai1', 'skills', 'okf'), { recursive: true });
  writeFileSync(join(homeDirectory, '.config', 'ai1', 'skills', 'okf', 'customization.md'), '- Personal rule.\n');
  const { exitCode, printedText } = skillContextText(['okf-interview-project'], projectRoot, homeDirectory);
  assert.equal(exitCode, 0);
  const projectIndex = printedText.indexOf('### This project');
  const personIndex = printedText.indexOf('### This person');
  const pluginIndex = printedText.indexOf('### From plugin team-stack (');
  assert.ok(projectIndex > 0 && personIndex > projectIndex && pluginIndex > personIndex, printedText);
  assert.match(printedText, /describe them with the team-stack skill/);
  assert.match(printedText, /both win over a plugin's/);
  const { printedText: listText } = skillContextText(['--list'], projectRoot, homeDirectory);
  assert.match(listText, /okf-interview-project: .*plugin team-stack /);
});

test('a plugin customization alone replaces "none yet", with the precedence that names it [prod-stack:S1]', () => {
  const projectRoot = createTemporaryProject();
  const { homeDirectory } = createHomeWithPlugin();
  const { printedText } = skillContextText(['okf-maintain-knowledge'], projectRoot, homeDirectory);
  assert.match(printedText, /### From plugin team-stack/);
  assert.doesNotMatch(printedText, /None yet/);
  assert.match(printedText, /this project's wins over the person's; both win over a plugin's\./);
});

test('an installed plugin that is not enabled, or switched off by the repo, brings nothing [prod-stack:S2]', () => {
  const projectRoot = createTemporaryProject();
  const { homeDirectory: disabledHome } = createHomeWithPlugin({ enabled: false });
  assert.doesNotMatch(skillContextText(['okf-interview-project'], projectRoot, disabledHome).printedText, /From plugin/);
  const { homeDirectory } = createHomeWithPlugin();
  writeJson(join(projectRoot, '.claude', 'settings.json'), { enabledPlugins: { 'team-stack@team-stack': false } });
  assert.doesNotMatch(skillContextText(['okf-interview-project'], projectRoot, homeDirectory).printedText, /From plugin/);
});

test('a missing, broken or unexpected installed_plugins.json: no plugin customizations, the rest still prints, exit 0, and --list says so [prod-stack:S3]', () => {
  const projectRoot = createTemporaryProject();
  for (const installedPluginsText of ['{ not json', '[]', '{"plugins": {"team-stack@team-stack": "odd"}}']) {
    const { homeDirectory } = createHomeWithPlugin({ installedPluginsText });
    const { exitCode, printedText } = skillContextText(['okf-interview-project'], projectRoot, homeDirectory);
    assert.equal(exitCode, 0);
    assert.match(printedText, /## ai1 customization/);
    assert.doesNotMatch(printedText, /From plugin/);
  }
  const homeWithoutFile = mkdtempSync(join(tmpdir(), 'ai1-home-'));
  assert.equal(listEnabledPluginInstalls(projectRoot, { homeDirectory: homeWithoutFile }).status, 'unreadable');
  const { homeDirectory: brokenHome } = createHomeWithPlugin({ installedPluginsText: '{ not json' });
  assert.match(skillContextText(['--list'], projectRoot, brokenHome).printedText, /could not read ~\/\.claude\/plugins\/installed_plugins\.json/);
});

test('install path: the project entry of this checkout wins over the user one; among several, the latest; paths compare by folder [prod-stack:S2]', () => {
  const mainCheckout = join(tmpdir(), 'Repo');
  const pluginEntries = [
    { scope: 'user', installPath: '/cache/p/1.0.0', lastUpdated: '2026-11-01T00:00:00Z' },
    { scope: 'user', installPath: '/cache/p/1.1.0', lastUpdated: '2026-11-20T00:00:00Z' },
    { scope: 'project', projectPath: join(tmpdir(), 'Other'), installPath: '/cache/p/0.9.0', lastUpdated: '2026-11-21T00:00:00Z' },
  ];
  assert.equal(findPluginInstallPath(pluginEntries, mainCheckout), '/cache/p/1.1.0');
  assert.equal(findPluginInstallPath([...pluginEntries, { scope: 'project', projectPath: `${mainCheckout.toUpperCase()}/`, installPath: '/cache/p/0.8.0' }], mainCheckout), '/cache/p/0.8.0');
  assert.equal(findPluginInstallPath('odd', mainCheckout), null);
  assert.equal(findPluginInstallPath([{ scope: 'user' }], mainCheckout), null);
});
