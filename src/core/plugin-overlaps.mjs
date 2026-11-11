// Other plugins that do part of ai1's job. Enabled side by side, the agent gets two sets of skills
// or two workflows giving opposite orders. ai1 never switches them off by itself: `ai1 status`
// lists them, /ai1:core-setup-repo asks the person, `ai1 init --disable-plugins` writes the choice
// to .claude/settings.local.json, and the session brief warns while a `disable` one stays enabled.
// `features: null` means it overlaps with ai1 as a whole. `action`: disable (recommended) or warn.

import { readJsonFileIfValid } from './json-file.mjs';
import { findMainCheckout } from './project-roots.mjs';
import { join } from 'node:path';

export const PLUGIN_OVERLAPS = [
  {
    pluginPattern: /^okf@/,
    features: ['okf'],
    action: 'disable',
    reason: 'it ships the same OKF skills ai1 bundles, so they are listed twice',
  },
  {
    pluginPattern: /^jig@/,
    features: null,
    action: 'disable',
    reason: 'it is ai1 under its old name: its hooks would run twice',
  },
  {
    pluginPattern: /^superpowers@/,
    features: ['sizing', 'worktrees', 'verify', 'craft'],
    action: 'disable',
    reason: 'its session start makes the agent run its own skills on every task (brainstorming, writing-plans, using-git-worktrees, test-driven-development, verification-before-completion), which compete with the sizing, worktrees and verify gate of ai1',
  },
  {
    pluginPattern: /^feature-dev@/,
    features: ['sizing'],
    action: 'warn',
    reason: 'its /feature-dev command runs its own phased workflow, which duplicates the plan and deep sizes; harmless unless invoked',
  },
];

// Where Claude Code keeps .claude/settings.local.json for a checkout: since v2.1.211, at the main
// checkout's root even in a worktree; on Windows, next to .claude/settings.json.
export function localSettingsPathFor(checkoutRoot, platform = process.platform) {
  return join(platform === 'win32' ? checkoutRoot : findMainCheckout(checkoutRoot), '.claude', 'settings.local.json');
}

// Plugins enabled for this checkout, applying Claude Code's precedence: local over project over
// user. The shared settings come from the checkout itself; a local file left in a worktree by an
// older Claude Code is still read, below the main checkout's.
export function readEnabledPlugins(checkoutRoot, userSettingsPath) {
  const pluginStates = {};
  const settingsPaths = [userSettingsPath, join(checkoutRoot, '.claude', 'settings.json'), join(checkoutRoot, '.claude', 'settings.local.json'), localSettingsPathFor(checkoutRoot)];
  for (const settingsPath of [...new Set(settingsPaths)]) {
    Object.assign(pluginStates, readJsonFileIfValid(settingsPath)?.enabledPlugins);
  }
  return Object.keys(pluginStates).filter((pluginId) => pluginStates[pluginId] === true);
}

// [{ pluginId, features, action, reason }] for each enabled plugin that overlaps with one of the
// given features (or with ai1 as a whole).
export function findOverlappingPlugins(enabledPluginIds, enabledFeatureIds) {
  return enabledPluginIds.flatMap((pluginId) => {
    const overlap = PLUGIN_OVERLAPS.find((candidateOverlap) => candidateOverlap.pluginPattern.test(pluginId));
    if (!overlap) return [];
    const overlappingFeatures = overlap.features ? overlap.features.filter((featureId) => enabledFeatureIds.includes(featureId)) : null;
    if (overlappingFeatures && !overlappingFeatures.length) return [];
    return [{ pluginId, features: overlappingFeatures, action: overlap.action, reason: overlap.reason }];
  });
}

export function describeOverlap(overlappingPlugin) {
  const overlapScope = overlappingPlugin.features ? `overlaps with ${overlappingPlugin.features.join(', ')}` : 'overlaps with ai1';
  return `${overlappingPlugin.pluginId} ${overlapScope}: ${overlappingPlugin.reason}`;
}
