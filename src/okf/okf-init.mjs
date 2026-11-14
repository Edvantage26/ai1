// `ai1 okf init <dir> [--title "..."] [--force]`: a conformant starter OKF v0.2 bundle - a root
// index.md (frontmatter with only okf_version), a log.md with the creation entry under today's date,
// and one getting-started.md concept with every recommended field. `ai1 okf validate --strict`
// passes it with no warnings. Ported from okf_init.py (okf-skills, MIT).

import { existsSync, statSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, basename, relative } from 'node:path';
import { OKF_VERSION } from './okf-validate.mjs';

const STARTER_CONCEPT = 'getting-started.md';
// §7 actor: an automated process, not an agent with a version.
const INIT_ACTOR = 'process:okf_init';
// A value YAML would read back as something else (or that breaks the line) is written double-quoted.
const PLAIN_YAML_SCALAR_PATTERN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^\n]*$/;
const YAML_SPECIAL_WORD_PATTERN = /^(?:~|null|true|false|yes|no|on|off|[-+.]?\d[\d_.eE+-]*)$/i;

export const OKF_INIT_USAGE = 'ai1 okf init <target-dir> [--title "<title>"] [--force]';

function yamlScalar(text) {
  const isPlainSafe = PLAIN_YAML_SCALAR_PATTERN.test(text) && !/: |\s#|\s$/.test(text) && !YAML_SPECIAL_WORD_PATTERN.test(text);
  return isPlainSafe ? text : JSON.stringify(text);
}

// "my-cool_bundle" -> "My Cool Bundle", like Python's str.title().
function humanizeDirectoryName(directoryName) {
  const words = directoryName.replaceAll('-', ' ').replaceAll('_', ' ').trim();
  return words ? words.replace(/\p{L}+/gu, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase()) : 'Untitled';
}

function buildIndexText(bundleTitle) {
  return `---\nokf_version: '${OKF_VERSION}'\n---\n\n# ${bundleTitle}\n\n* [Getting started](${STARTER_CONCEPT}) - starting point for this bundle.\n`;
}

function buildLogText(todayDate, bundleTitle) {
  return `# Update Log\n\n## ${todayDate}\n* **Creation**: Scaffolded the ${bundleTitle} bundle with \`ai1 okf init\` — see [getting started](${STARTER_CONCEPT}).\n`;
}

function buildStarterConceptText(bundleTitle, nowInstant) {
  return [
    '---',
    'type: Reference',
    `title: ${yamlScalar(`Getting started — ${bundleTitle}`)}`,
    `description: ${yamlScalar(`Starting point for the ${bundleTitle} OKF bundle.`)}`,
    'tags:',
    '- getting-started',
    'status: stable',
    'generated:',
    `  by: ${INIT_ACTOR}`,
    `  at: '${nowInstant}'`,
    '---',
    '',
    '# Overview',
    '',
    'This is the first concept in a freshly scaffolded OKF bundle. Replace it with real knowledge — one concept per file, cross-linked with standard markdown links — and keep `index.md` updated as you go. `log.md` records lifecycle events only: a concept created, deprecated, superseded, regenerated or verified.',
    '',
  ].join('\n');
}

function listMarkdownPaths(directoryPath) {
  return readdirSync(directoryPath, { recursive: true, withFileTypes: true })
    .filter((directoryEntry) => directoryEntry.isFile() && directoryEntry.name.endsWith('.md'))
    .map((directoryEntry) => relative(directoryPath, join(directoryEntry.parentPath ?? directoryEntry.path, directoryEntry.name)))
    .sort();
}

// Writes the scaffold; returns the exit code (0 created, 1 refused, 2 bad usage).
export function runOkfInitCommand(initArguments, writeOutput = console.log, writeError = console.error, now = new Date()) {
  const titleIndex = initArguments.indexOf('--title');
  const targetDirectory = initArguments.find((initArgument, argumentIndex) => !initArgument.startsWith('--') && !(titleIndex >= 0 && argumentIndex === titleIndex + 1));
  if (!targetDirectory || (titleIndex >= 0 && initArguments[titleIndex + 1] === undefined)) {
    writeError(`usage: ${OKF_INIT_USAGE}`);
    return 2;
  }
  if (existsSync(targetDirectory) && !statSync(targetDirectory).isDirectory()) {
    writeError(`error: ${targetDirectory} exists and is not a directory`);
    return 2;
  }
  const existingMarkdown = existsSync(targetDirectory) ? listMarkdownPaths(targetDirectory) : [];
  if (existingMarkdown.length && !initArguments.includes('--force')) {
    writeError(`refusing: ${targetDirectory} already contains .md files (pass --force to scaffold anyway)`);
    for (const markdownPath of existingMarkdown.slice(0, 5)) writeError(`  ${markdownPath}`);
    return 1;
  }
  const bundleTitle = titleIndex >= 0 ? initArguments[titleIndex + 1] : humanizeDirectoryName(basename(resolve(targetDirectory)));
  const nowInstant = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  mkdirSync(targetDirectory, { recursive: true });
  writeFileSync(join(targetDirectory, 'index.md'), buildIndexText(bundleTitle));
  writeFileSync(join(targetDirectory, 'log.md'), buildLogText(nowInstant.slice(0, 10), bundleTitle));
  writeFileSync(join(targetDirectory, STARTER_CONCEPT), buildStarterConceptText(bundleTitle, nowInstant));
  writeOutput(`created OKF bundle scaffold at ${targetDirectory}`);
  writeOutput(`hint: validate it - ai1 okf validate ${targetDirectory} --strict (or /ai1:okf-validate-bundle)`);
  return 0;
}
