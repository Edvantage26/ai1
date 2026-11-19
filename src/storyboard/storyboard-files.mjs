// `ai1 storyboard file`: a file the flow takes in (input: an uploaded spreadsheet) or gives out
// (output: a downloaded report, a sent email) attached to a step as evidence, with a three-line card
// (what it contains, what it is used for, what to check) and a preview worked out when it is added,
// so `steps.json` carries it for publishers. The evidence file itself is never deleted: it may be the
// user's own. With --mask the raw file is not copied and the preview values are masked.

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { writeJsonFile } from '../core/json-file.mjs';
import { ensureDirectoryIgnoredByItself } from '../sizing/sizing-work.mjs';
import { buildFilePreview } from './storyboard-file-preview.mjs';
import {
  emptyStoryboard, findOrCreateStep, IMAGE_EXTENSIONS, longTextWarnings, readStoryboard, stepIdFromCaption, STEPS_FILE_NAME,
} from './storyboard-steps.mjs';

export const FILES_FOLDER_NAME = 'files';
export const FILE_ROLES = ['input', 'output'];
export const MAX_COPIED_FILE_BYTES = 20 * 1024 * 1024;

function evidenceFileId(fileName) {
  return stepIdFromCaption(fileName) || 'file';
}

// Adds (or replaces: same step, file name and role) one evidence file on the step named by the caption
// or --id, created at the end when new. Returns { storyboard, step, evidenceFile, warnings }.
export function addEvidenceFile(storyboardPath, slug, { caption, filePath, role, contains, use, check, previewImage, mask = false, section, stepId, title }) {
  if (!caption?.trim()) throw new Error('--step "<what the user does or sees>" is required');
  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) throw new Error(`--file must be an existing file (got "${filePath ?? ''}")`);
  if (!FILE_ROLES.includes(role)) throw new Error(`--role must be one of ${FILE_ROLES.join(', ')} (got "${role ?? ''}")`);
  if (previewImage !== undefined) {
    if (!existsSync(previewImage) || !statSync(previewImage).isFile()) throw new Error(`--preview must be an existing image file (got "${previewImage}")`);
    if (!IMAGE_EXTENSIONS.includes(extname(previewImage).toLowerCase())) throw new Error(`--preview must be one of ${IMAGE_EXTENSIONS.join(', ')}`);
  }

  ensureDirectoryIgnoredByItself(dirname(storyboardPath));
  const storyboard = readStoryboard(storyboardPath) ?? emptyStoryboard(slug);
  if (title) storyboard.title = title;
  const { storyboardStep } = findOrCreateStep(storyboard, { caption, stepId, section });

  const fileName = basename(filePath);
  const fileExtension = extname(fileName).toLowerCase();
  const fileSize = statSync(filePath).size;
  const filePrefix = `${FILES_FOLDER_NAME}/${storyboardStep.id}-${role}-${evidenceFileId(fileName)}`;
  const evidenceFile = { id: evidenceFileId(fileName), role, name: fileName, type: fileExtension.replace(/^\./, '') || 'file', size: fileSize };
  if (contains?.trim()) evidenceFile.contains = contains.trim();
  if (use?.trim()) evidenceFile.use = use.trim();
  if (check?.trim()) evidenceFile.check = check.trim();
  if (mask) evidenceFile.masked = true;

  try {
    evidenceFile.preview = buildFilePreview(filePath, { mask });
  } catch (previewError) {
    evidenceFile.preview = { kind: 'generic' };
    evidenceFile.preview_error = String(previewError?.message ?? previewError).split('\n')[0];
  }

  mkdirSync(join(storyboardPath, FILES_FOLDER_NAME), { recursive: true });
  if (!mask && fileSize <= MAX_COPIED_FILE_BYTES) {
    evidenceFile.path = `${filePrefix}${fileExtension}`;
    copyFileSync(filePath, join(storyboardPath, evidenceFile.path));
  }
  if (previewImage !== undefined) {
    const previewPath = resolve(previewImage);
    const previewStats = statSync(previewPath);
    const previewRelativePath = `${filePrefix}-preview${extname(previewImage).toLowerCase()}`;
    copyFileSync(previewPath, join(storyboardPath, previewRelativePath));
    evidenceFile.preview_image = { image: previewRelativePath, source: { path: previewPath, size: previewStats.size, mtime_ms: previewStats.mtimeMs } };
  }

  storyboardStep.files = (storyboardStep.files ?? [])
    .filter((existingFile) => !(existingFile.name === fileName && existingFile.role === role))
    .concat(evidenceFile);
  storyboard.updated_at = new Date().toISOString();
  writeJsonFile(join(storyboardPath, STEPS_FILE_NAME), storyboard);
  return {
    storyboard, step: storyboardStep, evidenceFile,
    warnings: longTextWarnings({ '--contains': contains, '--use': use, '--check': check, '--section': section }),
  };
}
