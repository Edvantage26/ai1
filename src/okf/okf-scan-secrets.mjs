// `ai1 okf scan-secrets <path>...`: the lines of the given files (folders walked) that look like they
// hold a literal secret, as `file:line`, never the value (same heuristic as the CLAUDE.md check,
// src/core/secret-lines.mjs). Produce mode runs it on the sources it cites, so the person hears which
// committed files hold a secret in clear text and none is ever copied into a concept. Exit 1 when a
// line is found, 0 when none, 2 on bad usage.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { findSecretLines } from '../core/secret-lines.mjs';

export const OKF_SCAN_SECRETS_USAGE = 'ai1 okf scan-secrets <path>... [--json]';
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'venv', '.venv', '__pycache__', 'dist', 'build']);
const MAX_FILE_BYTES = 1024 * 1024;

function listFiles(startPath) {
  const stats = statSync(startPath);
  if (stats.isFile()) return stats.size <= MAX_FILE_BYTES ? [startPath] : [];
  const files = [];
  for (const directoryEntry of readdirSync(startPath, { withFileTypes: true })) {
    if (directoryEntry.isDirectory() && SKIPPED_DIRECTORIES.has(directoryEntry.name)) continue;
    const entryPath = join(startPath, directoryEntry.name);
    if (directoryEntry.isDirectory()) files.push(...listFiles(entryPath));
    else if (directoryEntry.isFile() && statSync(entryPath).size <= MAX_FILE_BYTES) files.push(entryPath);
  }
  return files;
}

// [{ file, lines: [n...] }] for the files with at least one secret-looking line.
export function scanSecrets(paths, workingDirectory = process.cwd()) {
  const findings = [];
  for (const scannedPath of paths) {
    for (const filePath of listFiles(resolve(workingDirectory, scannedPath))) {
      let fileText;
      try {
        fileText = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      if (fileText.includes('\u0000')) continue;
      const secretLines = findSecretLines(fileText);
      if (secretLines.length) findings.push({ file: relative(workingDirectory, filePath) || filePath, lines: secretLines });
    }
  }
  return findings;
}

export function runOkfScanSecretsCommand(workingDirectory, scanArguments, writeOutput = console.log, writeError = console.error) {
  const paths = scanArguments.filter((scanArgument) => !scanArgument.startsWith('--'));
  if (!paths.length) {
    writeError(`usage: ${OKF_SCAN_SECRETS_USAGE}`);
    return 2;
  }
  let findings;
  try {
    findings = scanSecrets(paths, workingDirectory);
  } catch (scanError) {
    writeError(`ai1 okf scan-secrets: ${scanError.message}`);
    return 2;
  }
  if (scanArguments.includes('--json')) writeOutput(JSON.stringify(findings, null, 2));
  else if (!findings.length) writeOutput('no secret-looking lines');
  else for (const finding of findings) writeOutput(`${finding.file}:${finding.lines.join(',')}`);
  return findings.length ? 1 : 0;
}
