// `ai1 skill-context <skill>`: the project and user customization of an ai1 skill, printed into the
// skill when Claude Code loads it (its last line is `` !`ai1 skill-context <skill>` ``).
// `ai1 skill-context --list`: every skill, customizable or why not, and the customizations found.
// `ai1 skill-context quiet <skill> [--off]`: no after-use question about its customization (customization-check).
// Loading a skill never fails: a non-zero exit or an error there would stop the skill from loading, so anything
// unexpected prints nothing and exits 0.

import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { listSkillCustomizations, renderSkillContext, repoHasAi1, resolveSkillCustomizations, writeSkillPersonState } from '../core/skill-customization.mjs';

export const SKILL_CONTEXT_USAGE = 'ai1 skill-context <skill> | ai1 skill-context --list [--json] | ai1 skill-context quiet <skill> [--off]';

const PLUGIN_SKILLS_DIRECTORY = fileURLToPath(new URL('../../skills/', import.meta.url));

function describeSkillCustomization(skillCustomization) {
  if (!skillCustomization.customizable) return `${skillCustomization.skill}: not customizable (${skillCustomization.reason})`;
  const foundCustomizations = [
    skillCustomization.project && `project ${skillCustomization.project}`,
    skillCustomization.user && `yours ${skillCustomization.user}`,
  ].filter(Boolean);
  return `${skillCustomization.skill}: customizable [${skillCustomization.scopes.join(', ')}] as "${skillCustomization.feature}"; ${foundCustomizations.length ? foundCustomizations.join('; ') : 'no customization yet'}`;
}

// Best effort: the skill already printed; a failed write only means the paragraph shows once more.
function recordFirstLoad(resolvedCustomizations) {
  try {
    writeSkillPersonState(resolvedCustomizations.sharedRoot, resolvedCustomizations.skillFolder, { firstLoadAt: new Date().toISOString() });
  } catch {
    // Fail open.
  }
}

// `ai1 skill-context quiet <skill> [--off]`: no after-use question (customization-check) for this skill,
// for this person in this repo; `--off` brings it back.
function runQuietCommand(quietArguments, customizationOptions, writeOutput) {
  const skillFolder = quietArguments.find((argumentText) => !argumentText.startsWith('--'));
  const resolvedCustomizations = skillFolder && resolveSkillCustomizations(skillFolder, customizationOptions);
  if (!resolvedCustomizations) {
    writeOutput(`usage: ai1 skill-context quiet <customizable skill> [--off]`);
    return 1;
  }
  if (!repoHasAi1(resolvedCustomizations.sharedRoot)) {
    writeOutput('ai1 is not set up in this repo: there is no after-use question to quiet here.');
    return 1;
  }
  const isQuiet = !quietArguments.includes('--off');
  writeSkillPersonState(resolvedCustomizations.sharedRoot, skillFolder, { quiet: isQuiet });
  writeOutput(isQuiet
    ? `${skillFolder}: no after-use question about its customization, for you in this repo (\`ai1 skill-context quiet ${skillFolder} --off\` brings it back).`
    : `${skillFolder}: the after-use question about its customization is back.`);
  return 0;
}

export function runSkillContextCommand(commandArguments, { workingDirectory = process.cwd(), environment = process.env, homeDirectory, skillsDirectory = PLUGIN_SKILLS_DIRECTORY, writeOutput = console.log } = {}) {
  const customizationOptions = { workingDirectory, environment, ...(homeDirectory ? { homeDirectory } : {}) };
  try {
    if (commandArguments.includes('--list')) {
      const skillFolders = readdirSync(skillsDirectory, { withFileTypes: true }).filter((directoryEntry) => directoryEntry.isDirectory()).map((directoryEntry) => directoryEntry.name).sort();
      const skillCustomizations = listSkillCustomizations(skillFolders, customizationOptions);
      writeOutput(commandArguments.includes('--json') ? JSON.stringify(skillCustomizations, null, 2) : skillCustomizations.map(describeSkillCustomization).join('\n'));
      return 0;
    }
    if (commandArguments[0] === 'quiet') return runQuietCommand(commandArguments.slice(1), customizationOptions, writeOutput);
    const [skillFolder] = commandArguments;
    if (!skillFolder) {
      writeOutput(`usage: ${SKILL_CONTEXT_USAGE}`);
      return 0;
    }
    const resolvedCustomizations = resolveSkillCustomizations(skillFolder, customizationOptions);
    if (!resolvedCustomizations) return 0;
    writeOutput(renderSkillContext(resolvedCustomizations));
    if (resolvedCustomizations.isFirstLoad) recordFirstLoad(resolvedCustomizations);
  } catch {
    // Fail open: the skill loads without its customization.
  }
  return 0;
}
