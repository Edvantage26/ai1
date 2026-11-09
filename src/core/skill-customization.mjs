// Project and user overlays of a customizable ai1 skill, rendered as the text that
// `ai1 skill-context <skill>` prints into the skill when Claude Code loads it (the skill's last line
// is `` !`ai1 skill-context <skill>` ``). A failing `!` command stops the whole skill from loading,
// so every read here degrades to a note instead of an error.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AI1_DIRECTORY } from './config.mjs';
import { findMainCheckout, findWorkingTreeTop } from './project-roots.mjs';
import { SKILL_CUSTOMIZATION_INDEX, featureOfSkill } from './skill-customization-index.mjs';

export const SKILL_OVERLAYS_DIRECTORY = `${AI1_DIRECTORY}/skills`;
export const OVERLAY_FILE_NAME = 'overlay.md';
export const OVERLAY_MAX_BYTES = 8192;
export const CUSTOMIZATION_HEADING = '## ai1 customization';

export function projectOverlayRelativePath(feature) {
  return `${SKILL_OVERLAYS_DIRECTORY}/${feature}/${OVERLAY_FILE_NAME}`;
}

function userConfigDirectory(environment, homeDirectory) {
  return environment.XDG_CONFIG_HOME ? join(environment.XDG_CONFIG_HOME, 'ai1') : join(homeDirectory, '.config', 'ai1');
}

export function userOverlayPath(feature, { environment = process.env, homeDirectory = homedir() } = {}) {
  return join(userConfigDirectory(environment, homeDirectory), 'skills', feature, OVERLAY_FILE_NAME);
}

function readOverlay(overlayPath) {
  try {
    const overlayBuffer = readFileSync(overlayPath);
    const isTruncated = overlayBuffer.length > OVERLAY_MAX_BYTES;
    return { text: overlayBuffer.subarray(0, OVERLAY_MAX_BYTES).toString('utf8').trimEnd(), isTruncated };
  } catch (readError) {
    return { readError: readError.code || 'unreadable' };
  }
}

// The project overlay comes from the checkout the agent works in (a worktree's branch may change it),
// else from the main checkout. Outside git, from `workingDirectory`.
export function resolveSkillOverlays(skillFolder, { workingDirectory = process.cwd(), environment = process.env, homeDirectory = homedir() } = {}) {
  const indexEntry = SKILL_CUSTOMIZATION_INDEX[skillFolder];
  if (!indexEntry?.customizable) return null;
  const feature = featureOfSkill(skillFolder);
  const treeRoot = findWorkingTreeTop(workingDirectory) || workingDirectory;
  const sharedRoot = findMainCheckout(treeRoot);
  const resolvedOverlays = { skillFolder, feature, scopes: indexEntry.scopes, userOverlayPath: userOverlayPath(feature, { environment, homeDirectory }), project: null, user: null };
  if (indexEntry.scopes.includes('project')) {
    const relativePath = projectOverlayRelativePath(feature);
    const projectRootWithOverlay = [treeRoot, sharedRoot].find((candidateRoot) => existsSync(join(candidateRoot, relativePath)));
    if (projectRootWithOverlay) {
      resolvedOverlays.project = { path: relativePath, fromMainCheckout: projectRootWithOverlay !== treeRoot, ...readOverlay(join(projectRootWithOverlay, relativePath)) };
    }
  }
  if (indexEntry.scopes.includes('user')) {
    if (existsSync(resolvedOverlays.userOverlayPath)) resolvedOverlays.user = { path: resolvedOverlays.userOverlayPath, ...readOverlay(resolvedOverlays.userOverlayPath) };
  }
  return resolvedOverlays;
}

function renderOverlaySection(sectionTitle, overlay) {
  if (overlay.readError) return [sectionTitle, `(could not be read: ${overlay.readError})`];
  return [sectionTitle, overlay.text || '(empty)', ...(overlay.isTruncated ? [`(cut at ${OVERLAY_MAX_BYTES} bytes: keep the overlay shorter)`] : [])];
}

export function renderSkillContext(resolvedOverlays) {
  const { feature, scopes, project, user, userOverlayPath: personalOverlayPath } = resolvedOverlays;
  const acceptsProject = scopes.includes('project');
  const renderedLines = [CUSTOMIZATION_HEADING, ''];
  if (!project && !user) renderedLines.push(`None yet${acceptsProject ? ` for this project (${projectOverlayRelativePath(feature)}) or` : ''} for this person (${personalOverlayPath}).`, '');
  if (project) renderedLines.push(...renderOverlaySection(`### This project (${project.path}${project.fromMainCheckout ? ', from the main checkout' : ''})`, project), '');
  if (user) renderedLines.push(...renderOverlaySection(`### This person (${user.path})`, user), '');
  const saveTargets = acceptsProject ? 'for this project (committed) or only for them' : 'for them (personal)';
  renderedLines.push(
    `If the person corrects or adjusts how this skill works ("aquí siempre…", "en este repo no…", "for me, always…"), offer once in this conversation to save it ${saveTargets} with /ai1:core-customize-skill; if they decline, do not offer again.`,
    `Precedence: the Fixed rules of the skill above win over any customization${acceptsProject ? '; where the two customizations disagree, this project\'s wins over the person\'s' : ''}.`,
  );
  return renderedLines.join('\n');
}

// Every skill with its customization status and the overlays found, for `ai1 skill-context --list`.
export function listSkillCustomizations(skillFolders, options = {}) {
  return skillFolders.map((skillFolder) => {
    const indexEntry = SKILL_CUSTOMIZATION_INDEX[skillFolder];
    if (!indexEntry) return { skill: skillFolder, customizable: false, reason: 'not in the customization index' };
    if (!indexEntry.customizable) return { skill: skillFolder, customizable: false, reason: indexEntry.reason };
    const resolvedOverlays = resolveSkillOverlays(skillFolder, options);
    return {
      skill: skillFolder,
      customizable: true,
      feature: resolvedOverlays.feature,
      scopes: resolvedOverlays.scopes,
      project: resolvedOverlays.project ? resolvedOverlays.project.path : null,
      user: resolvedOverlays.user ? resolvedOverlays.user.path : null,
    };
  });
}
