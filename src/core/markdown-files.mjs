// Every markdown file under a folder, recursively; [] when the folder does not exist.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function listMarkdownFiles(directoryPath) {
  if (!existsSync(directoryPath)) return [];
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((directoryEntry) => {
    const entryPath = join(directoryPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) return listMarkdownFiles(entryPath);
    return directoryEntry.name.endsWith('.md') ? [entryPath] : [];
  });
}
