#!/usr/bin/env node
// Fit map of the ai1 skills, for the ai1-skill-design project skill: per skill, its description size,
// its allowed-tools, the hook or brief files that name it (its route), the skills that hand over to it
// or that it hands over to, and whether its frontmatter is strict YAML. Run from the repo root:
//   node .claude/skills/ai1-skill-design/fit-map.mjs [--json]

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { load } from '../../../vendor/js-yaml/js-yaml.mjs';
import { splitFrontmatter } from '../../../src/core/frontmatter.mjs';

// Files that list every skill or rename old ones: naming a skill there is not a route to it.
const FILES_THAT_ARE_NOT_ROUTES = new Set(['src/core/features.mjs', 'src/core/migrations.mjs', 'src/cli/legacy-migration.mjs', 'src/core/skill-customization-index.mjs']);

const repositoryRoot = process.cwd();

function listSourceFiles(directoryPath) {
  return readdirSync(directoryPath).flatMap((entryName) => {
    const entryPath = join(directoryPath, entryName);
    if (statSync(entryPath).isDirectory()) return listSourceFiles(entryPath);
    return entryPath.endsWith('.mjs') || !entryName.includes('.') ? [entryPath] : [];
  });
}

// A top-level field read line by line, tolerant like Claude Code: a plain value, or a folded `>-` /
// `|` block of indented lines joined with spaces.
function readLooseField(frontmatterText, fieldName) {
  const frontmatterLines = frontmatterText.split(/\r?\n/);
  const fieldLineIndex = frontmatterLines.findIndex((frontmatterLine) => frontmatterLine.startsWith(`${fieldName}:`));
  if (fieldLineIndex < 0) return '';
  const inlineValue = frontmatterLines[fieldLineIndex].slice(fieldName.length + 1).trim();
  if (!/^[>|]-?$/.test(inlineValue)) return inlineValue.replace(/^(['"])(.*)\1$/, '$2');
  const blockLines = [];
  for (const blockLine of frontmatterLines.slice(fieldLineIndex + 1)) {
    if (!/^\s/.test(blockLine)) break;
    blockLines.push(blockLine.trim());
  }
  return blockLines.join(' ');
}

function isStrictYaml(frontmatterText) {
  try {
    load(frontmatterText);
    return true;
  } catch {
    return false;
  }
}

function readSkills(skillsDirectory, invocationPrefix) {
  if (!existsSync(skillsDirectory)) return [];
  return readdirSync(skillsDirectory)
    .filter((folderName) => existsSync(join(skillsDirectory, folderName, 'SKILL.md')))
    .map((folderName) => {
      const { frontmatterText, bodyText } = splitFrontmatter(readFileSync(join(skillsDirectory, folderName, 'SKILL.md'), 'utf8'));
      const description = readLooseField(frontmatterText ?? '', 'description');
      return {
        name: folderName,
        invocation: `${invocationPrefix}${folderName}`,
        description,
        descriptionWords: description.split(/\s+/).filter(Boolean).length,
        allowedTools: readLooseField(frontmatterText ?? '', 'allowed-tools'),
        strictYaml: isStrictYaml(frontmatterText ?? ''),
        bodyText,
      };
    });
}

const pluginSkills = readSkills(join(repositoryRoot, 'skills'), '/ai1:');
const projectSkills = readSkills(join(repositoryRoot, '.claude', 'skills'), '/');
const allSkills = [...pluginSkills, ...projectSkills];
const sourceFiles = ['src', 'bin'].flatMap((directoryName) => listSourceFiles(join(repositoryRoot, directoryName)))
  .map((filePath) => ({ file: relative(repositoryRoot, filePath).split('\\').join('/'), text: readFileSync(filePath, 'utf8') }));

function mentionsSkill(text, skill) {
  return new RegExp(`${skill.invocation.replace(/[/:]/g, '\\$&')}(?![\\w-])`).test(text);
}

const fitMap = allSkills.map((skill) => ({
  name: skill.name,
  scope: pluginSkills.includes(skill) ? 'plugin' : 'project',
  descriptionWords: skill.descriptionWords,
  strictYaml: skill.strictYaml,
  allowedTools: skill.allowedTools,
  routes: sourceFiles.filter((source) => !FILES_THAT_ARE_NOT_ROUTES.has(source.file) && mentionsSkill(source.text, skill)).map((source) => source.file),
  handedOverBy: allSkills.filter((otherSkill) => otherSkill !== skill && mentionsSkill(otherSkill.bodyText + otherSkill.description, skill)).map((otherSkill) => otherSkill.name),
  handsOverTo: allSkills.filter((otherSkill) => otherSkill !== skill && mentionsSkill(skill.bodyText + skill.description, otherSkill)).map((otherSkill) => otherSkill.name),
  description: skill.description,
}));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(fitMap, null, 2));
} else {
  for (const entry of fitMap) {
    console.log(`== ${entry.name} (${entry.scope}, description ${entry.descriptionWords} words${entry.strictYaml ? '' : ', frontmatter NOT strict YAML'})`);
    console.log(`   allowed-tools: ${entry.allowedTools || '-'}`);
    console.log(`   routes:        ${entry.routes.join(' ') || '-'}`);
    console.log(`   handed by:     ${entry.handedOverBy.join(' ') || '-'}`);
    console.log(`   hands to:      ${entry.handsOverTo.join(' ') || '-'}`);
    console.log(`   ${entry.description}`);
  }
}
