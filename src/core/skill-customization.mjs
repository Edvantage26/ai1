// Project and user customizations of an ai1 skill, rendered as the text that
// `ai1 skill-context <skill>` prints into the skill when Claude Code loads it (the skill's last line
// is `` !`ai1 skill-context <skill>` ``). A failing `!` command stops the whole skill from loading,
// so every read here degrades to a note instead of an error.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AI1_DIRECTORY } from './config.mjs';
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

// The project customization comes from the checkout the agent works in (a worktree's branch may
// change it), else from the main checkout. Outside git, from `workingDirectory`.
export function resolveSkillCustomizations(skillFolder, { workingDirectory = process.cwd(), environment = process.env, homeDirectory = homedir() } = {}) {
  const indexEntry = SKILL_CUSTOMIZATION_INDEX[skillFolder];
  if (!indexEntry?.customizable) return null;
  const feature = featureOfSkill(skillFolder);
  const treeRoot = findWorkingTreeTop(workingDirectory) || workingDirectory;
  const sharedRoot = findMainCheckout(treeRoot);
  const personalPath = userCustomizationPath(feature, { environment, homeDirectory });
  const resolvedCustomizations = { skillFolder, feature, scopes: indexEntry.scopes, userCustomizationPath: personalPath, project: null, user: null };
  if (indexEntry.scopes.includes('project')) {
    const foundProjectCustomization = findProjectCustomization([treeRoot, sharedRoot], feature);
    if (foundProjectCustomization) {
      const { candidateRoot, relativePath, isLegacyName } = foundProjectCustomization;
      resolvedCustomizations.project = { path: relativePath, fromMainCheckout: candidateRoot !== treeRoot, isLegacyName, ...readCustomization(join(candidateRoot, relativePath)) };
    }
  }
  if (indexEntry.scopes.includes('user')) {
    const legacyPersonalPath = userCustomizationPath(feature, { environment, homeDirectory, fileName: LEGACY_CUSTOMIZATION_FILE_NAME });
    const foundPersonalPath = [personalPath, legacyPersonalPath].find((candidatePath) => existsSync(candidatePath));
    if (foundPersonalPath) resolvedCustomizations.user = { path: foundPersonalPath, isLegacyName: foundPersonalPath === legacyPersonalPath, ...readCustomization(foundPersonalPath) };
  }
  return resolvedCustomizations;
}

function renderCustomizationSection(sectionTitle, customization) {
  if (customization.readError) return [sectionTitle, `(could not be read: ${customization.readError})`];
  return [
    sectionTitle,
    customization.text || '(empty)',
    ...(customization.isTruncated ? [`(cut at ${CUSTOMIZATION_MAX_BYTES} bytes: keep the customization shorter)`] : []),
    ...(customization.isLegacyName ? [`(old file name ${LEGACY_CUSTOMIZATION_FILE_NAME}: tell the person in one line to rename it ${CUSTOMIZATION_FILE_NAME} in the same folder; the old name stops being read in a later version)`] : []),
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
