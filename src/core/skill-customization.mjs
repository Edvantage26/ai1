// Project and user customizations of an ai1 skill, rendered as the text that
// `ai1 skill-context <skill>` prints into the skill when Claude Code loads it (the skill's last line
// is `` !`ai1 skill-context <skill>` ``). A failing `!` command stops the whole skill from loading,
// so every read here degrades to a note instead of an error.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { AI1_DIRECTORY, CONFIG_RELATIVE_PATH } from './config.mjs';
import { readPersonState, writePersonState } from './person-project.mjs';
import { findMainCheckout, findWorkingTreeTop } from './project-roots.mjs';
import { SKILL_CUSTOMIZATION_INDEX, featureOfSkill } from './skill-customization-index.mjs';

export const SKILL_CUSTOMIZATIONS_DIRECTORY = `${AI1_DIRECTORY}/skills`;
export const CUSTOMIZATION_FILE_NAME = 'customization.md';
// Before v0.38.0 the file was `overlay.md`. Migration 5 renames it; until it has run (a branch that
// still commits the old name, a migration left alone) it is read too, with a note to rename it.
export const LEGACY_CUSTOMIZATION_FILE_NAME = 'overlay.md';
export const CUSTOMIZATION_MAX_BYTES = 8192;
export const CUSTOMIZATION_HEADING = '## ai1 customization';

export function projectCustomizationRelativePath(feature, fileName = CUSTOMIZATION_FILE_NAME) {
  return `${SKILL_CUSTOMIZATIONS_DIRECTORY}/${feature}/${fileName}`;
}

export function userConfigDirectory(environment, homeDirectory) {
  return environment.XDG_CONFIG_HOME ? join(environment.XDG_CONFIG_HOME, 'ai1') : join(homeDirectory, '.config', 'ai1');
}

export function userCustomizationPath(feature, { environment = process.env, homeDirectory = homedir(), fileName = CUSTOMIZATION_FILE_NAME } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), 'skills', feature, fileName);
}

function readCustomization(customizationPath) {
  try {
    const customizationBuffer = readFileSync(customizationPath);
    const isTruncated = customizationBuffer.length > CUSTOMIZATION_MAX_BYTES;
    return { text: customizationBuffer.subarray(0, CUSTOMIZATION_MAX_BYTES).toString('utf8').trimEnd(), isTruncated };
  } catch (readError) {
    return { readError: readError.code || 'unreadable' };
  }
}

// The current file name first, then the legacy one in the same place.
function findProjectCustomization(candidateRoots, feature) {
  for (const fileName of [CUSTOMIZATION_FILE_NAME, LEGACY_CUSTOMIZATION_FILE_NAME]) {
    const relativePath = projectCustomizationRelativePath(feature, fileName);
    const candidateRoot = candidateRoots.find((projectRoot) => existsSync(join(projectRoot, relativePath)));
    if (candidateRoot) return { candidateRoot, relativePath, isLegacyName: fileName === LEGACY_CUSTOMIZATION_FILE_NAME };
  }
  return null;
}

// A backtick span of a customization that reads as a path: it has a `/`, and nothing that makes it a
// command, a pattern, a placeholder, a URL or a skill name (spaces, `<>*${}`, `:`, a leading `-`).
function isPathLikeSpan(spanText) {
  return spanText.includes('/') && !/[\s<>*${}:]/.test(spanText) && !spanText.startsWith('-') && !spanText.startsWith('..');
}

// Paths a customization mentions in backticks that no longer exist. `~/` is the home folder; a
// relative path is resolved against `baseRoot`, or skipped when there is none (a personal
// customization serves every repo, so its relative paths may belong to another one).
export function findMissingPaths(customizationText, { baseRoot, homeDirectory }) {
  const missingPaths = [];
  for (const spanMatch of String(customizationText || '').matchAll(/`([^`\n]+)`/g)) {
    const spanText = spanMatch[1].trim();
    if (!isPathLikeSpan(spanText) || missingPaths.includes(spanText)) continue;
    let resolvedPath = null;
    if (spanText.startsWith('~/')) resolvedPath = join(homeDirectory, spanText.slice(2));
    else if (isAbsolute(spanText)) resolvedPath = spanText;
    else if (baseRoot) resolvedPath = join(baseRoot, spanText);
    if (resolvedPath && !existsSync(resolvedPath)) missingPaths.push(spanText);
  }
  return missingPaths;
}

// The person's per-skill state in this repo (`.ai1/local/state.json` `skills.<skill>`): when the skill
// first loaded here and whether the after-use check is quiet for it.
export function readSkillPersonState(sharedRoot, skillFolder) {
  return readPersonState(sharedRoot).skills?.[skillFolder] ?? {};
}

export function writeSkillPersonState(sharedRoot, skillFolder, skillStateChanges) {
  const personState = readPersonState(sharedRoot);
  const skillStates = { ...personState.skills };
  skillStates[skillFolder] = { ...skillStates[skillFolder], ...skillStateChanges };
  writePersonState(sharedRoot, { ...personState, skills: skillStates });
}

export function isSkillQuiet(sharedRoot, skillFolder) {
  return readSkillPersonState(sharedRoot, skillFolder).quiet === true;
}

// First-use and quiet are remembered only in a repo set up with ai1: elsewhere there is no `.ai1/local/`.
export function repoHasAi1(sharedRoot) {
  return existsSync(join(sharedRoot, CONFIG_RELATIVE_PATH));
}

// The project customization comes from the checkout the agent works in (a worktree's branch may
// change it), else from the main checkout. Outside git, from `workingDirectory`.
export function resolveSkillCustomizations(skillFolder, { workingDirectory = process.cwd(), environment = process.env, homeDirectory = homedir() } = {}) {
  const indexEntry = SKILL_CUSTOMIZATION_INDEX[skillFolder];
  if (!indexEntry?.customizable) return null;
  const feature = featureOfSkill(skillFolder);
  const treeRoot = findWorkingTreeTop(workingDirectory) || workingDirectory;
  const sharedRoot = findMainCheckout(treeRoot);
  const personalPath = userCustomizationPath(feature, { environment, homeDirectory });
  const isFirstLoad = repoHasAi1(sharedRoot) && !readSkillPersonState(sharedRoot, skillFolder).firstLoadAt;
  const resolvedCustomizations = { skillFolder, feature, scopes: indexEntry.scopes, hints: indexEntry.hints, userCustomizationPath: personalPath, sharedRoot, isFirstLoad, project: null, user: null };
  if (indexEntry.scopes.includes('project')) {
    const foundProjectCustomization = findProjectCustomization([treeRoot, sharedRoot], feature);
    if (foundProjectCustomization) {
      const { candidateRoot, relativePath, isLegacyName } = foundProjectCustomization;
      const projectCustomization = readCustomization(join(candidateRoot, relativePath));
      const missingPaths = findMissingPaths(projectCustomization.text, { baseRoot: candidateRoot, homeDirectory });
      resolvedCustomizations.project = { path: relativePath, fromMainCheckout: candidateRoot !== treeRoot, isLegacyName, missingPaths, ...projectCustomization };
    }
  }
  if (indexEntry.scopes.includes('user')) {
    const legacyPersonalPath = userCustomizationPath(feature, { environment, homeDirectory, fileName: LEGACY_CUSTOMIZATION_FILE_NAME });
    const foundPersonalPath = [personalPath, legacyPersonalPath].find((candidatePath) => existsSync(candidatePath));
    if (foundPersonalPath) {
      const personalCustomization = readCustomization(foundPersonalPath);
      const missingPaths = findMissingPaths(personalCustomization.text, { baseRoot: null, homeDirectory });
      resolvedCustomizations.user = { path: foundPersonalPath, isLegacyName: foundPersonalPath === legacyPersonalPath, missingPaths, ...personalCustomization };
    }
  }
  return resolvedCustomizations;
}

function renderCustomizationSection(sectionTitle, customization) {
  if (customization.readError) return [sectionTitle, `(could not be read: ${customization.readError})`];
  const missingPaths = customization.missingPaths ?? [];
  return [
    sectionTitle,
    customization.text || '(empty)',
    ...(customization.isTruncated ? [`(cut at ${CUSTOMIZATION_MAX_BYTES} bytes: keep the customization shorter)`] : []),
    ...(customization.isLegacyName ? [`(old file name ${LEGACY_CUSTOMIZATION_FILE_NAME}: tell the person in one line to rename it ${CUSTOMIZATION_FILE_NAME} in the same folder; the old name stops being read in a later version)`] : []),
    ...(missingPaths.length ? [`(mentions paths that no longer exist: ${missingPaths.map((missingPath) => `\`${missingPath}\``).join(', ')} - offer the person in one line to update this customization with /ai1:core-customize-skill)`] : []),
  ];
}

export function renderSkillContext(resolvedCustomizations) {
  const { feature, scopes, project, user, userCustomizationPath: personalPath } = resolvedCustomizations;
  const acceptsProject = scopes.includes('project');
  const renderedLines = [CUSTOMIZATION_HEADING, ''];
  if (!project && !user) renderedLines.push(`None yet${acceptsProject ? ` for this project (${projectCustomizationRelativePath(feature)}) or` : ''} for this person (${personalPath}).`, '');
  if (project) renderedLines.push(...renderCustomizationSection(`### This project (${project.path}${project.fromMainCheckout ? ', from the main checkout' : ''})`, project), '');
  if (user) renderedLines.push(...renderCustomizationSection(`### This person (${user.path})`, user), '');
  const saveTargets = acceptsProject ? 'for this project (committed) or only for them' : 'for them (personal)';
  if (resolvedCustomizations.isFirstLoad) {
    renderedLines.push(
      `First time this skill runs here for this person. While it runs, notice what this ${acceptsProject ? 'project or person' : 'person'} needed that the skill did not say (usually: ${resolvedCustomizations.hints}). When it is done, if something came up, offer in one line to save it ${saveTargets} with /ai1:core-customize-skill; if nothing did, say nothing about it.`,
      '',
    );
  }
  renderedLines.push(
    `If the person corrects or adjusts how this skill works ("aquí siempre…", "en este repo no…", "for me, always…"), offer once in this conversation to save it ${saveTargets} with /ai1:core-customize-skill; if they decline, do not offer again.`,
    `Precedence: the Fixed rules of the skill above win over any customization${acceptsProject ? '; where the two customizations disagree, this project\'s wins over the person\'s' : ''}.`,
  );
  return renderedLines.join('\n');
}

// Every skill with its customization status and the customizations found, for `ai1 skill-context --list`.
export function listSkillCustomizations(skillFolders, options = {}) {
  return skillFolders.map((skillFolder) => {
    const indexEntry = SKILL_CUSTOMIZATION_INDEX[skillFolder];
    if (!indexEntry) return { skill: skillFolder, customizable: false, reason: 'not in the customization index' };
    if (!indexEntry.customizable) return { skill: skillFolder, customizable: false, reason: indexEntry.reason };
    const resolvedCustomizations = resolveSkillCustomizations(skillFolder, options);
    return {
      skill: skillFolder,
      customizable: true,
      feature: resolvedCustomizations.feature,
      scopes: resolvedCustomizations.scopes,
      project: resolvedCustomizations.project ? resolvedCustomizations.project.path : null,
      user: resolvedCustomizations.user ? resolvedCustomizations.user.path : null,
    };
  });
}
