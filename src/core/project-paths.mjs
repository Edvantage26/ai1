// Paths the agent's tools name, seen from the project root (used by sizing and design).

import { isAbsolute, relative, resolve } from 'node:path';

// Path relative to the project root, or null when it falls outside the project.
export function projectRelativePath(projectRoot, targetPath, workingDirectory = projectRoot) {
  if (typeof targetPath !== 'string' || !targetPath) return null;
  const absolutePath = isAbsolute(targetPath) ? targetPath : resolve(workingDirectory, targetPath);
  const relativePath = relative(projectRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return relativePath;
}
