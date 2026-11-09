// `ai1 skill-context <skill>`: the project and user customization of an ai1 skill, printed into the
// skill when Claude Code loads it (its last line is `` !`ai1 skill-context <skill>` ``).
// `ai1 skill-context --list`: every skill, customizable or why not, and the overlays found.
// Never fails: a non-zero exit or an error here would stop the skill from loading, so anything
// unexpected prints nothing and exits 0.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listSkillCustomizations, renderSkillContext, resolveSkillOverlays } from '../core/skill-customization.mjs';

export const SKILL_CONTEXT_USAGE = 'ai1 skill-context <skill> | ai1 skill-context --list [--json]';

const PLUGIN_SKILLS_DIRECTORY = fileURLToPath(new URL('../../skills/', import.meta.url));

function describeSkillCustomization(skillCustomization) {
  if (!skillCustomization.customizable) return `${skillCustomization.skill}: not customizable (${skillCustomization.reason})`;
  const foundOverlays = [
    skillCustomization.project && `project ${skillCustomization.project}`,
    skillCustomization.user && `yours ${skillCustomization.user}`,
  ].filter(Boolean);
  return `${skillCustomization.skill}: customizable [${skillCustomization.scopes.join(', ')}] as "${skillCustomization.feature}"; ${foundOverlays.length ? foundOverlays.join('; ') : 'no overlay yet'}`;
}

export function runSkillContextCommand(commandArguments, { workingDirectory = process.cwd(), environment = process.env, homeDirectory, skillsDirectory = PLUGIN_SKILLS_DIRECTORY, writeOutput = console.log } = {}) {
  const overlayOptions = { workingDirectory, environment, ...(homeDirectory ? { homeDirectory } : {}) };
  try {
    if (commandArguments.includes('--list')) {
      const skillFolders = readdirSync(skillsDirectory, { withFileTypes: true }).filter((directoryEntry) => directoryEntry.isDirectory()).map((directoryEntry) => directoryEntry.name).sort();
      const skillCustomizations = listSkillCustomizations(skillFolders, overlayOptions);
      writeOutput(commandArguments.includes('--json') ? JSON.stringify(skillCustomizations, null, 2) : skillCustomizations.map(describeSkillCustomization).join('\n'));
      return 0;
    }
    const [skillFolder] = commandArguments;
    if (!skillFolder) {
      writeOutput(`usage: ${SKILL_CONTEXT_USAGE}`);
      return 0;
    }
    const resolvedOverlays = resolveSkillOverlays(skillFolder, overlayOptions);
    if (resolvedOverlays) writeOutput(renderSkillContext(resolvedOverlays));
  } catch {
    // Fail open: the skill loads without its customization.
  }
  return 0;
}
