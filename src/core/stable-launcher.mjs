// A version-independent `ai1` for the session. Claude Code fixes ${CLAUDE_PLUGIN_ROOT} and puts the
// plugin's bin/ on PATH when a session starts; an autoupdate later removes that version's cache folder
// while the session still points at it, and every `ai1 …` (skill injections, Bash) then fails.
// At SessionStart (bin/ai1-hook.mjs, active repo or not) this writes a POSIX launcher at
// ${CLAUDE_PLUGIN_DATA}/bin/ai1 (the data folder survives updates) and, through CLAUDE_ENV_FILE, puts
// that folder first on the session's PATH and exports AI1_PLUGIN_ROOT. The launcher runs, in order:
// $AI1_PLUGIN_ROOT (this session's version), the version that wrote it, else the newest version left
// next to it in the cache. The session's Bash has no CLAUDE_PLUGIN_DATA, so the launcher exports its own
// data folder as AI1_PLUGIN_DATA to the CLI: state the CLI writes lands where the hooks read it (issue #2).
// Fails open: a missing variable or an unwritable file only skips this.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const LAUNCHER_RELATIVE_PATH = join('bin', 'ai1');
const VERSION_FOLDER_PATTERN = /^\d+\.\d+\.\d+$/;

// Single-quoted for sh: ' becomes '\''.
export function quoteForShell(textValue) {
  return `'${String(textValue).replaceAll("'", "'\\''")}'`;
}

export function buildLauncherScript(pluginRoot, pluginData) {
  // Falling back to a sibling version only makes sense inside the versioned cache, not for --plugin-dir.
  const versionsDirectoryLine = VERSION_FOLDER_PATTERN.test(basename(pluginRoot))
    ? `versions_directory=$(dirname "$written_by_root")`
    : 'versions_directory=';
  return `#!/bin/sh
# ai1 launcher, written at session start by ai1 (src/core/stable-launcher.mjs). Do not edit: it is
# rewritten. It survives plugin updates, unlike the version folder a running session started from.
written_by_root=${quoteForShell(pluginRoot)}
${versionsDirectoryLine}
export AI1_PLUGIN_DATA=${quoteForShell(pluginData)}
for candidate_root in "\${AI1_PLUGIN_ROOT:-}" "$written_by_root"; do
  if [ -n "$candidate_root" ] && [ -f "$candidate_root/bin/ai1" ]; then
    exec node "$candidate_root/bin/ai1" "$@"
  fi
done
if [ -n "$versions_directory" ] && [ -d "$versions_directory" ]; then
  newest_version=$(ls -1 "$versions_directory" | grep -E '^[0-9]+\\.[0-9]+\\.[0-9]+$' | sort -t. -k1,1n -k2,2n -k3,3n | tail -n 1)
  if [ -n "$newest_version" ] && [ -f "$versions_directory/$newest_version/bin/ai1" ]; then
    exec node "$versions_directory/$newest_version/bin/ai1" "$@"
  fi
fi
echo "ai1: no installed ai1 found (looked at \${AI1_PLUGIN_ROOT:-unset}, $written_by_root). Update or reinstall the ai1 plugin." >&2
exit 127
`;
}

export function buildSessionEnvironmentLines(pluginRoot, pluginData) {
  return [
    `export AI1_PLUGIN_ROOT=${quoteForShell(pluginRoot)}`,
    `export PATH=${quoteForShell(join(pluginData, 'bin'))}:"$PATH"`,
  ];
}

// Returns what it did, for tests; never throws.
export function installStableLauncher(environment = process.env) {
  const pluginRoot = environment.CLAUDE_PLUGIN_ROOT;
  const pluginData = environment.CLAUDE_PLUGIN_DATA;
  if (!pluginRoot || !pluginData) return { launcher: 'skipped', sessionEnvironment: 'skipped' };
  const installReport = { launcher: 'unchanged', sessionEnvironment: 'skipped' };
  try {
    const launcherPath = join(pluginData, LAUNCHER_RELATIVE_PATH);
    const launcherScript = buildLauncherScript(pluginRoot, pluginData);
    const currentScript = existsSync(launcherPath) ? readFileSync(launcherPath, 'utf8') : null;
    if (currentScript !== launcherScript) {
      mkdirSync(join(pluginData, 'bin'), { recursive: true });
      // Write then rename, so a session running the launcher meanwhile never reads half a file.
      const temporaryPath = `${launcherPath}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, launcherScript, { mode: 0o755 });
      chmodSync(temporaryPath, 0o755);
      renameSync(temporaryPath, launcherPath);
      installReport.launcher = 'written';
    }
  } catch {
    installReport.launcher = 'failed';
  }
  const sessionEnvironmentFile = environment.CLAUDE_ENV_FILE;
  if (sessionEnvironmentFile) {
    try {
      const currentLines = existsSync(sessionEnvironmentFile) ? readFileSync(sessionEnvironmentFile, 'utf8').split('\n') : [];
      const missingLines = buildSessionEnvironmentLines(pluginRoot, pluginData).filter((environmentLine) => !currentLines.includes(environmentLine));
      if (missingLines.length) appendFileSync(sessionEnvironmentFile, `${missingLines.join('\n')}\n`);
      installReport.sessionEnvironment = missingLines.length ? 'written' : 'unchanged';
    } catch {
      installReport.sessionEnvironment = 'failed';
    }
  }
  return installReport;
}
