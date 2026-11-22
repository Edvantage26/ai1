// Customizations of ai1 skills shipped by another plugin: a plugin that is enabled for this checkout
// and carries `ai1/skills/<feature>/customization.md` adds it to the skill, after the project's and the
// person's. So a person's private plugin brings their rules to ai1's skills on any machine where it is
// installed. Where a plugin lives on disk comes from Claude Code's `installed_plugins.json`, an internal
// file: anything unexpected there means no plugin customizations, never an error.

import { join } from 'node:path';
import { readJsonFileIfValid } from './json-file.mjs';
import { readEnabledPlugins } from './plugin-overlaps.mjs';
import { findMainCheckout } from './project-roots.mjs';

export const PLUGIN_CUSTOMIZATIONS_DIRECTORY = join('ai1', 'skills');

export function installedPluginsPath(homeDirectory) {
  return join(homeDirectory, '.claude', 'plugins', 'installed_plugins.json');
}

const samePath = (firstPath, secondPath) => typeof firstPath === 'string' && typeof secondPath === 'string'
  && join(firstPath).replace(/[\\/]+$/, '').toLowerCase() === join(secondPath).replace(/[\\/]+$/, '').toLowerCase();

// The install folder Claude Code uses for a plugin in this checkout: its project entry for the main
// checkout, else its user entry; among several, the most recently updated. null when there is none.
export function findPluginInstallPath(pluginEntries, mainCheckout) {
  if (!Array.isArray(pluginEntries)) return null;
  const validEntries = pluginEntries.filter((pluginEntry) => pluginEntry && typeof pluginEntry.installPath === 'string');
  const byLatestUpdate = (firstEntry, secondEntry) => String(secondEntry.lastUpdated || '').localeCompare(String(firstEntry.lastUpdated || ''));
  const projectEntries = validEntries.filter((pluginEntry) => pluginEntry.scope === 'project' && samePath(pluginEntry.projectPath, mainCheckout)).sort(byLatestUpdate);
  const userEntries = validEntries.filter((pluginEntry) => pluginEntry.scope === 'user').sort(byLatestUpdate);
  return (projectEntries[0] || userEntries[0])?.installPath ?? null;
}

// [{ pluginId, pluginName, installPath }] of the enabled plugins other than ai1 with a known install
// folder, by plugin id. `status`: ok, or unreadable when installed_plugins.json is missing or not the
// expected shape (then no plugins).
export function listEnabledPluginInstalls(checkoutRoot, { homeDirectory }) {
  const installedPlugins = readJsonFileIfValid(installedPluginsPath(homeDirectory));
  const pluginEntriesById = installedPlugins && typeof installedPlugins.plugins === 'object' && installedPlugins.plugins;
  if (!pluginEntriesById) return { status: 'unreadable', plugins: [] };
  const mainCheckout = findMainCheckout(checkoutRoot);
  const userSettingsPath = join(homeDirectory, '.claude', 'settings.json');
  const plugins = readEnabledPlugins(checkoutRoot, userSettingsPath)
    .filter((pluginId) => !pluginId.startsWith('ai1@'))
    .sort()
    .map((pluginId) => ({ pluginId, pluginName: pluginId.split('@')[0], installPath: findPluginInstallPath(pluginEntriesById[pluginId], mainCheckout) }))
    .filter((pluginInstall) => pluginInstall.installPath);
  return { status: 'ok', plugins };
}

// Where a plugin keeps its customization of an ai1 feature.
export function pluginCustomizationPath(installPath, feature, fileName) {
  return join(installPath, PLUGIN_CUSTOMIZATIONS_DIRECTORY, feature, fileName);
}
