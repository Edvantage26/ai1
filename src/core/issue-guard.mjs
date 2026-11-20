// issue-guard (PreToolUse Bash, feature `core`): refuses publishing to the public ai1 repo
// (`gh issue|pr create|comment|edit` aimed at Edvantage26/ai1, `ai1 issue url`) while the title or the
// body holds private data - the person's repo names, home paths, emails, IPs, hostnames, secrets,
// contacts or clients (src/core/issue-privacy.mjs). Issue #6: an agent wrote an issue by hand, without
// the skill, naming a private repo that revealed a client; the cleaning rule was only an instruction.
// A body it cannot read (`$(...)`, stdin, a file not written yet) is refused too: it could hold anything.
// Every other command returns at once. `modules.issue-guard: false` silences it.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { allowDecision, denyDecision } from './hook-io.mjs';
import { baseName, splitSimpleCommands } from './shell-parse.mjs';
import { findGitRoot, readRemoteSlugs, isAi1Slug, parseRemoteSlug, collectPrivateNames, findPrivateData, formatPrivateHits, listSessionPaths, AI1_REPOSITORY } from './issue-privacy.mjs';

const MODULE_ID = 'issue-guard';
const PUBLISHING_SUBCOMMANDS = new Set(['create', 'comment', 'edit']);
const TITLE_OPTIONS = ['-t', '--title'];
const BODY_OPTIONS = ['-b', '--body'];
const BODY_FILE_OPTIONS = ['-F', '--body-file'];
const REPO_OPTIONS = ['-R', '--repo'];
// A shell expansion in a body: what gh receives is not what the command shows.
const SHELL_EXPANSION_PATTERN = /\$\(|`|\$\{?[A-Za-z_]/;

// The value of an option given as `--name value`, `--name=value` or `-Xvalue` (short options), or undefined.
export function readOptionValue(commandWords, optionNames) {
  for (let wordIndex = 0; wordIndex < commandWords.length; wordIndex += 1) {
    const commandWord = commandWords[wordIndex];
    for (const optionName of optionNames) {
      if (commandWord === optionName) return commandWords[wordIndex + 1] ?? '';
      if (optionName.startsWith('--') && commandWord.startsWith(`${optionName}=`)) return commandWord.slice(optionName.length + 1);
      if (!optionName.startsWith('--') && commandWord.startsWith(optionName) && commandWord.length > optionName.length && !commandWord.startsWith('--')) return commandWord.slice(optionName.length);
    }
  }
  return undefined;
}

function isAi1RepoValue(repoValue) {
  return isAi1Slug(parseRemoteSlug(`/${String(repoValue).replace(/^https?:\/\/[^/]+\//, '')}`));
}

function workingDirectoryIsAi1(workingDirectory) {
  const gitRoot = findGitRoot(workingDirectory);
  return Boolean(gitRoot) && readRemoteSlugs(gitRoot).some(isAi1Slug);
}

// { title, body, bodyFile } of a command that publishes to the ai1 repo, or null for any other command.
export function findAi1Publication(commandWords, commandLine, workingDirectory) {
  const commandName = baseName(commandWords[0]);
  if (commandName === 'gh' && ['issue', 'pr'].includes(commandWords[1]) && PUBLISHING_SUBCOMMANDS.has(commandWords[2])) {
    const repoValue = readOptionValue(commandWords, REPO_OPTIONS) ?? /\bGH_REPO=['"]?([^\s'"]+)/.exec(commandLine)?.[1];
    const targetsAi1 = repoValue !== undefined ? isAi1RepoValue(repoValue) : workingDirectoryIsAi1(workingDirectory);
    if (!targetsAi1) return null;
    return { title: readOptionValue(commandWords, TITLE_OPTIONS), body: readOptionValue(commandWords, BODY_OPTIONS), bodyFile: readOptionValue(commandWords, BODY_FILE_OPTIONS) };
  }
  const issueIndex = commandWords.indexOf('issue');
  const runsAi1 = commandName === 'ai1' || commandWords.slice(0, issueIndex).some((commandWord) => baseName(commandWord) === 'ai1');
  if (runsAi1 && issueIndex > 0 && commandWords[issueIndex + 1] === 'url') {
    return { title: readOptionValue(commandWords, ['--title']), body: undefined, bodyFile: readOptionValue(commandWords, ['--body-file']) };
  }
  return null;
}

// The body text to check, or { unreadable: why } when the hook cannot know what will be published.
function readPublishedBody(publication, workingDirectory) {
  if (publication.body !== undefined) {
    return SHELL_EXPANSION_PATTERN.test(publication.body) ? { unreadable: 'the body is built by a shell expansion' } : { text: publication.body };
  }
  if (publication.bodyFile === undefined) return { text: '' };
  if (publication.bodyFile === '-' || publication.bodyFile === '' || SHELL_EXPANSION_PATTERN.test(publication.bodyFile)) return { unreadable: 'the body comes from stdin or a shell expansion' };
  const bodyPath = isAbsolute(publication.bodyFile) ? publication.bodyFile : resolve(workingDirectory, publication.bodyFile);
  if (!existsSync(bodyPath)) return { unreadable: `the body file \`${publication.bodyFile}\` does not exist yet` };
  return { text: readFileSync(bodyPath, 'utf8') };
}

export default {
  id: MODULE_ID,
  event: 'PreToolUse',
  feature: 'core',
  toolNames: ['Bash'],
  description: `Refuses publishing to ${AI1_REPOSITORY} while the title or body holds private data.`,
  run({ hookInput, projectRoot, sharedRoot = projectRoot, environment }) {
    const commandLine = hookInput.tool_input?.command;
    if (typeof commandLine !== 'string' || !/\b(?:gh|ai1)\b/.test(commandLine)) return allowDecision();
    const workingDirectory = hookInput.cwd || projectRoot;
    const publications = splitSimpleCommands(commandLine)
      .map((simpleCommand) => findAi1Publication(simpleCommand.words, commandLine, workingDirectory))
      .filter(Boolean);
    if (publications.length === 0) return allowDecision();
    let privateNames = null;
    for (const publication of publications) {
      const publishedBody = readPublishedBody(publication, workingDirectory);
      if (publishedBody.unreadable) {
        return denyDecision(MODULE_ID, `This publishes to the public repo ${AI1_REPOSITORY}, but ${publishedBody.unreadable}, so it cannot be checked for private data. Write the body to a file first, then publish in a separate command with \`--body-file <file>\`.`);
      }
      privateNames ??= collectPrivateNames({ projectRoot, sharedRoot, sessionPaths: [workingDirectory, ...listSessionPaths(hookInput.transcript_path)], homeDirectory: environment?.HOME });
      const privateHits = findPrivateData({ title: publication.title ?? '', body: publishedBody.text }, privateNames);
      if (privateHits.length) {
        return denyDecision(MODULE_ID, [
          `This publishes to the public repo ${AI1_REPOSITORY}, and the title or body holds private data of the person:`,
          formatPrivateHits(privateHits),
          'Replace each with its placeholder (or remove it) in the title and the body file, then publish again. `ai1 issue check <file> --title "<title>"` checks a draft before that.',
        ].join('\n'));
      }
    }
    return allowDecision();
  },
};
