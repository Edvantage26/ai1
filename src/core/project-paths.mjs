// Paths the agent's tools name, seen from the project root (used by sizing and design), and where
// Claude Code keeps a directory's sessions and memory.

import { isAbsolute, relative, resolve } from 'node:path';

// Path relative to the project root, or null when it falls outside the project.
export function projectRelativePath(projectRoot, targetPath, workingDirectory = projectRoot) {
  if (typeof targetPath !== 'string' || !targetPath) return null;
  const absolutePath = isAbsolute(targetPath) ? targetPath : resolve(workingDirectory, targetPath);
  const relativePath = relative(projectRoot, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return relativePath;
}

// Folder name Claude Code gives a working directory under ~/.claude/projects (/ and . as -).
export function claudeProjectFolderName(directoryPath) {
  return String(directoryPath).replace(/[/.]/g, '-');
}
