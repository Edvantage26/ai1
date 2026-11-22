// ~/.claude/settings.json in the config repo, key by key. Claude Code writes in that file too (plugins,
// marketplaces, its own state), so the repo keeps only the person's keys (`settingsKeys` of
// ai1-config.json): `claude/settings.json` (common) and `machines/<host>/claude/settings.json` (a key there
// replaces the common one whole). Each key is compared on its own, like a file: repo, target and the
// value recorded at the last sync; a key changed on one side goes to the other, changed on both is a
// conflict that touches nothing. Keys that are not the person's are never read into the repo nor removed
// from the target.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MACHINES_DIRECTORY, SETTINGS_RELATIVE_PATH, machineName, readConfigOptions, readConfigState, writeConfigState } from './config-repo.mjs';

// JSON with object keys sorted, so the same value always gives the same fingerprint.
function stableStringify(jsonValue) {
  if (Array.isArray(jsonValue)) return `[${jsonValue.map(stableStringify).join(',')}]`;
  if (jsonValue && typeof jsonValue === 'object') return `{${Object.keys(jsonValue).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(jsonValue[key])}`).join(',')}}`;
  return JSON.stringify(jsonValue ?? null);
}

const fingerprintValue = (jsonValue) => (jsonValue === undefined ? null : createHash('sha256').update(stableStringify(jsonValue)).digest('hex'));

function readJsonObject(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonObject(filePath, jsonObject) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(jsonObject, null, 2)}\n`);
}

export function settingsTargetPath(pathOptions = {}) {
  return join(pathOptions.homeDirectory || homedir(), '.claude', 'settings.json');
}

function settingsRepoPaths(repoDirectory, machine) {
  return {
    common: join(repoDirectory, ...SETTINGS_RELATIVE_PATH.split('/')),
    machine: join(repoDirectory, MACHINES_DIRECTORY, machine, ...SETTINGS_RELATIVE_PATH.split('/')),
  };
}

// [{ key, kind, source, repoValue, targetValue }] with kind in-sync | install | apply | capture | conflict.
// `targetUnreadable`: the target exists but is not a JSON object (nothing is planned then).
export function planSettingsSync(repoDirectory, { pathOptions = {}, state = readConfigState(pathOptions), options = readConfigOptions(repoDirectory) } = {}) {
  const machine = machineName(state);
  const repoPaths = settingsRepoPaths(repoDirectory, machine);
  const commonSettings = readJsonObject(repoPaths.common) || {};
  const machineSettings = readJsonObject(repoPaths.machine) || {};
  const targetPath = settingsTargetPath(pathOptions);
  const targetSettings = existsSync(targetPath) ? readJsonObject(targetPath) : {};
  if (!targetSettings) return { machine, targetUnreadable: true, actions: [] };
  const recordedFingerprints = state.settings || {};
  const actions = [];
  for (const key of options.settingsKeys) {
    const source = key in machineSettings ? 'machine' : 'common';
    const repoValue = source === 'machine' ? machineSettings[key] : commonSettings[key];
    const targetValue = targetSettings[key];
    const repoFingerprint = fingerprintValue(repoValue);
    const targetFingerprint = fingerprintValue(targetValue);
    const recordedFingerprint = recordedFingerprints[key] ?? null;
    let kind;
    if (repoFingerprint === targetFingerprint) kind = 'in-sync';
    else if (recordedFingerprint === null) kind = repoValue === undefined ? 'capture' : 'install';
    else if (targetFingerprint === recordedFingerprint) kind = 'apply';
    else if (repoFingerprint === recordedFingerprint) kind = 'capture';
    else kind = 'conflict';
    actions.push({ key, kind, source, repoValue, targetValue, repoFingerprint, targetFingerprint });
  }
  return { machine, actions };
}

// Carries out the settings plan in the given directions; returns { done, conflicts }.
export function runSettingsSync(repoDirectory, plan, { directions = ['apply', 'capture'], pathOptions = {}, state = readConfigState(pathOptions) } = {}) {
  const repoPaths = settingsRepoPaths(repoDirectory, plan.machine);
  const targetPath = settingsTargetPath(pathOptions);
  const targetSettings = (existsSync(targetPath) ? readJsonObject(targetPath) : {}) || {};
  const commonSettings = readJsonObject(repoPaths.common) || {};
  const machineSettings = readJsonObject(repoPaths.machine) || {};
  const settingsFingerprints = { ...(state.settings || {}) };
  const done = [];
  const conflicts = [];
  let targetChanged = false;
  const changedRepoSources = new Set();
  for (const action of plan.actions) {
    if (action.kind === 'in-sync') {
      settingsFingerprints[action.key] = action.repoFingerprint;
      continue;
    }
    if (action.kind === 'conflict') {
      conflicts.push(action);
      continue;
    }
    const isApply = action.kind === 'install' || action.kind === 'apply';
    if (!directions.includes(isApply ? 'apply' : 'capture')) continue;
    if (isApply) {
      if (action.repoValue === undefined) delete targetSettings[action.key];
      else targetSettings[action.key] = action.repoValue;
      targetChanged = true;
      settingsFingerprints[action.key] = action.repoFingerprint;
    } else {
      const sourceSettings = action.source === 'machine' ? machineSettings : commonSettings;
      if (action.targetValue === undefined) delete sourceSettings[action.key];
      else sourceSettings[action.key] = action.targetValue;
      changedRepoSources.add(action.source);
      settingsFingerprints[action.key] = action.targetFingerprint;
    }
    done.push(action);
  }
  if (targetChanged) writeJsonObject(targetPath, targetSettings);
  if (changedRepoSources.has('common')) writeJsonObject(repoPaths.common, commonSettings);
  if (changedRepoSources.has('machine')) writeJsonObject(repoPaths.machine, machineSettings);
  writeConfigState({ ...readConfigState(pathOptions), settings: settingsFingerprints }, pathOptions);
  return { done, conflicts };
}
