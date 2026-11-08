// Disk side of the worktree engine: sizes, free space, copy-on-write, copies and links.
// Everything is synchronous and local; sizes never follow symlinks.

import { constants, copyFileSync, cpSync, lstatSync, mkdirSync, readdirSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function measurePathBytes(targetPath) {
  let pathStats;
  try {
    pathStats = lstatSync(targetPath);
  } catch {
    return 0;
  }
  if (!pathStats.isDirectory()) return pathStats.isSymbolicLink() ? 0 : pathStats.size;
  let totalBytes = 0;
  for (const entryName of readdirSync(targetPath)) totalBytes += measurePathBytes(join(targetPath, entryName));
  return totalBytes;
}

// { freeBytes, totalBytes } of the volume holding `targetPath` (or its nearest existing parent),
// or null when the platform cannot tell.
export function readDiskSpace(targetPath) {
  let existingPath = targetPath;
  for (;;) {
    try {
      const volumeStats = statfsSync(existingPath);
      return { freeBytes: volumeStats.bavail * volumeStats.bsize, totalBytes: volumeStats.blocks * volumeStats.bsize };
    } catch (statError) {
      const parentPath = dirname(existingPath);
      if (statError.code !== 'ENOENT' || parentPath === existingPath) return null;
      existingPath = parentPath;
    }
  }
}

// True when files copied inside `directoryPath` can share blocks (btrfs, XFS, APFS...).
export function supportsCopyOnWrite(directoryPath) {
  const probeDirectory = join(directoryPath, `.ai1-cow-probe-${process.pid}`);
  try {
    mkdirSync(probeDirectory, { recursive: true });
    const sourcePath = join(probeDirectory, 'source');
    writeFileSync(sourcePath, 'probe');
    copyFileSync(sourcePath, join(probeDirectory, 'clone'), constants.COPYFILE_FICLONE_FORCE);
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
}

// Copies a file or directory, sharing blocks when the filesystem allows it.
export function copyPath(sourcePath, destinationPath) {
  mkdirSync(dirname(destinationPath), { recursive: true });
  cpSync(sourcePath, destinationPath, { recursive: true, mode: constants.COPYFILE_FICLONE, verbatimSymlinks: true, force: true });
}

// A directory link to `targetPath`: a junction on Windows (no admin rights needed), else a symlink.
export function linkDirectory(targetPath, linkPath) {
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

export function formatBytes(byteCount) {
  if (byteCount >= 1024 ** 3) return `${(byteCount / 1024 ** 3).toFixed(1)} GB`;
  if (byteCount >= 1024 ** 2) return `${(byteCount / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(byteCount / 1024)} KB`;
}
