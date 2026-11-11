// The storyboard of a change: `.ai1/walkthroughs/<slug>/` in the main checkout (git-ignored), with
// `steps.json` (the contract every publisher reads) and the copied screenshots in `images/`.
// The agent captures with whatever browser tool it has; ai1 only receives the image files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { tryGit } from '../core/git.mjs';
import { WALKTHROUGHS_DIRECTORY } from '../core/config.mjs';
import { readGitDirectories } from '../core/project-roots.mjs';
import { readJsonFileIfValid, writeJsonFile } from '../core/json-file.mjs';
import { ensureDirectoryIgnoredByItself, listWorkPlans, isPlanFinished } from '../sizing/sizing-work.mjs';
import { listWorktreeStates } from '../worktrees/worktree-state.mjs';

export const STORYBOARD_VERSION = 1;
export const STEPS_FILE_NAME = 'steps.json';
export const IMAGES_FOLDER_NAME = 'images';
export const VARIANTS = ['before', 'after'];
export const VIEWPORTS = ['desktop', 'mobile'];
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const BEFORE_WORKTREE_SUFFIX = '-before';
const MAX_STEP_ID_LENGTH = 48;

export function storyboardDirectory(mainRoot, slug) {
  return join(mainRoot, WALKTHROUGHS_DIRECTORY, slug);
}

// The worktree this checkout is, by its recorded state or its folder name; null in the main checkout.
function currentWorktreeName(treeRoot, mainRoot) {
  if (treeRoot === mainRoot) return null;
  const commonDirectory = readGitDirectories(mainRoot)?.commonDirectory;
  const recordedWorktree = commonDirectory
    ? listWorktreeStates(commonDirectory).find((worktreeState) => worktreeState.path === treeRoot)
    : null;
  return recordedWorktree?.name ?? basename(treeRoot);
}

// --slug, else the current worktree (a `<name>-before` worktree feeds `<name>`), else the only open plan.
export function resolveStoryboardSlug({ treeRoot, mainRoot, requestedSlug }) {
  if (requestedSlug) return requestedSlug;
  const worktreeName = currentWorktreeName(treeRoot, mainRoot);
  if (worktreeName) {
    return worktreeName.endsWith(BEFORE_WORKTREE_SUFFIX) ? worktreeName.slice(0, -BEFORE_WORKTREE_SUFFIX.length) : worktreeName;
  }
  const openPlans = listWorkPlans(mainRoot).filter((workPlan) => !isPlanFinished(workPlan));
  if (openPlans.length === 1) return openPlans[0].slug;
  throw new Error('cannot tell which storyboard this is: pass --slug <name> (the worktree or plan name)');
}

export function stepIdFromCaption(stepCaption) {
  return stepCaption.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_STEP_ID_LENGTH).replace(/-+$/, '');
}

export function readStoryboard(storyboardPath) {
  return readJsonFileIfValid(join(storyboardPath, STEPS_FILE_NAME));
}

function emptyStoryboard(slug) {
  return { version: STORYBOARD_VERSION, title: slug, created_at: new Date().toISOString(), steps: [] };
}

function requireChoice(optionName, optionValue, allowedValues) {
  if (!allowedValues.includes(optionValue)) throw new Error(`${optionName} must be one of ${allowedValues.join(', ')} (got "${optionValue}")`);
}

// Adds one capture to the step with that id (created at the end when new). The same step, variant and
// viewport again replaces the image. Returns { storyboard, step, imagePath }.
export function addCapture(storyboardPath, slug, { caption, imageFile, variant = 'after', viewport = 'desktop', detail, stepId, title, base }) {
  if (!caption?.trim()) throw new Error('--step "<what the user does or sees>" is required');
  if (!imageFile || !existsSync(imageFile) || !statSync(imageFile).isFile()) throw new Error(`--image must be an existing image file (got "${imageFile ?? ''}")`);
  const imageExtension = extname(imageFile).toLowerCase();
  requireChoice('--image extension', imageExtension, IMAGE_EXTENSIONS);
  requireChoice('--variant', variant, VARIANTS);
  requireChoice('--viewport', viewport, VIEWPORTS);

  ensureDirectoryIgnoredByItself(dirname(storyboardPath));
  const storyboard = readStoryboard(storyboardPath) ?? emptyStoryboard(slug);
  if (title) storyboard.title = title;
  if (base) storyboard.base = base;
  const resolvedStepId = stepId || stepIdFromCaption(caption) || `step-${storyboard.steps.length + 1}`;
  let storyboardStep = storyboard.steps.find((existingStep) => existingStep.id === resolvedStepId);
  if (!storyboardStep) {
    storyboardStep = { id: resolvedStepId, caption: caption.trim(), captures: [] };
    storyboard.steps.push(storyboardStep);
  } else if (variant === 'after') {
    storyboardStep.caption = caption.trim();
  }
  if (variant === 'before') storyboardStep.before_caption = caption.trim();
  if (detail) storyboardStep.detail = detail;

  const imageRelativePath = `${IMAGES_FOLDER_NAME}/${resolvedStepId}-${variant}-${viewport}${imageExtension}`;
  const sourcePath = resolve(imageFile);
  const sourceStats = statSync(sourcePath);
  mkdirSync(join(storyboardPath, IMAGES_FOLDER_NAME), { recursive: true });
  copyFileSync(imageFile, join(storyboardPath, imageRelativePath));
  storyboardStep.captures = storyboardStep.captures
    .filter((existingCapture) => !(existingCapture.variant === variant && existingCapture.viewport === viewport))
    .concat({ variant, viewport, image: imageRelativePath, source: { path: sourcePath, size: sourceStats.size, mtime_ms: sourceStats.mtimeMs } });
  storyboard.updated_at = new Date().toISOString();
  writeJsonFile(join(storyboardPath, STEPS_FILE_NAME), storyboard);
  return { storyboard, step: storyboardStep, imagePath: imageRelativePath };
}

// 'new' when a step has only after-captures in a storyboard that has before-captures, 'removed' when
// it has only before-captures, null otherwise.
export function stepChange(storyboardStep, storyboardHasBefore) {
  if (!storyboardHasBefore) return null;
  const capturedVariants = new Set(storyboardStep.captures.map((stepCapture) => stepCapture.variant));
  if (!capturedVariants.has('before')) return 'new';
  if (!capturedVariants.has('after')) return 'removed';
  return null;
}

export function storyboardHasBefore(storyboard) {
  return storyboard.steps.some((storyboardStep) => storyboardStep.captures.some((stepCapture) => stepCapture.variant === 'before'));
}

export function readImageBytes(storyboardPath, imageRelativePath) {
  return readFileSync(join(storyboardPath, imageRelativePath));
}

function isTrackedByGit(filePath) {
  return tryGit(dirname(filePath), ['ls-files', '--error-unmatch', '--', basename(filePath)]) !== null;
}

// Deletes the screenshots `add` copied from, when they are still the same file (size and mtime), an
// image, outside the storyboard and not tracked by git: the residue a closed change leaves around the
// repo. The storyboard itself is kept. Returns { deleted, kept: [{ path, reason }] }.
export function cleanResidualScreenshots(storyboardPath) {
  const storyboard = readStoryboard(storyboardPath);
  const cleanResult = { deleted: [], kept: [] };
  if (!storyboard) return cleanResult;
  const storyboardPrefix = resolve(storyboardPath) + sep;
  for (const stepCapture of storyboard.steps.flatMap((storyboardStep) => storyboardStep.captures)) {
    const recordedSource = stepCapture.source;
    if (!recordedSource) continue;
    const sourcePath = recordedSource.path;
    const keepReason = !existsSync(sourcePath) ? null
      : sourcePath.startsWith(storyboardPrefix) ? 'inside the storyboard'
        : !IMAGE_EXTENSIONS.includes(extname(sourcePath).toLowerCase()) ? 'not an image'
          : (() => {
            const currentStats = statSync(sourcePath);
            if (!currentStats.isFile() || currentStats.size !== recordedSource.size || currentStats.mtimeMs !== recordedSource.mtime_ms) return 'changed since it was added';
            return isTrackedByGit(sourcePath) ? 'tracked by git' : null;
          })();
    if (keepReason) {
      cleanResult.kept.push({ path: sourcePath, reason: keepReason });
      continue;
    }
    if (existsSync(sourcePath)) {
      rmSync(sourcePath, { force: true });
      cleanResult.deleted.push(sourcePath);
    }
    delete stepCapture.source;
  }
  writeJsonFile(join(storyboardPath, STEPS_FILE_NAME), storyboard);
  return cleanResult;
}
