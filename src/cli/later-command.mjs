// `ai1 later ...`: the only way later entry files get numbered, moved between statuses and indexed, so the
// agent never does it by hand. Reads the okf feature from .ai1/config.json (defaults when the repo
// has none) to word the index and check bundle citations.

import { loadHarnessConfig } from '../core/config.mjs';
import { createLaterEntry, setLaterEntryStatus, writeLaterIndex, checkLaterEntries, listLaterEntries, resolveCitingBundle, resolveKnowledgePath, LATER_DIRECTORY } from '../later/later-documents.mjs';

export const LATER_USAGE = 'ai1 later new <slug> [--idea] [--title "<title>"] | ai1 later set <number> <status> [--by <number>] | ai1 later index | ai1 later check';

const OPTIONS_WITH_VALUE = new Set(['--title', '--by']);

// The arguments that are not options nor option values, so `new --title "X" my-slug` finds the slug.
function listPositionalArguments(commandArguments) {
  const positionalArguments = [];
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (OPTIONS_WITH_VALUE.has(commandArgument)) argumentIndex += 1;
    else if (!commandArgument.startsWith('--')) positionalArguments.push(commandArgument);
  }
  return positionalArguments;
}

function loadRepoConfig(repoRoot) {
  const loadedConfig = loadHarnessConfig(repoRoot);
  return loadedConfig.status === 'ok' ? loadedConfig.config : { features: {} };
}

// Prints the result and returns the exit code.
export function runLaterCommand(repoRoot, commandArguments, { readOption }) {
  const [subcommandName, firstArgument, secondArgument] = listPositionalArguments(commandArguments);
  const config = loadRepoConfig(repoRoot);
  const knowledgePath = resolveKnowledgePath(config);
  if (subcommandName === 'new') {
    const { relativePath, indexPath } = createLaterEntry(repoRoot, {
      slug: firstArgument, title: readOption('--title'), size: commandArguments.includes('--idea') ? 'idea' : 'full', knowledgePath,
    });
    console.log(`created ${relativePath}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'set') {
    if (!firstArgument || !secondArgument) throw new Error('usage: ai1 later set <number> <status> [--by <number>]');
    const { relativePath, indexPath } = setLaterEntryStatus(repoRoot, firstArgument, secondArgument, { supersededBy: readOption('--by'), knowledgePath });
    console.log(`${relativePath}: status ${secondArgument}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'index') {
    console.log(`wrote ${writeLaterIndex(repoRoot, knowledgePath)}`);
    return 0;
  }
  if (subcommandName === 'check') {
    const laterProblems = checkLaterEntries(repoRoot, { knowledgePath, bundleDirectory: resolveCitingBundle(repoRoot, config) });
    if (!laterProblems.length) {
      console.log(`ai1: ${listLaterEntries(repoRoot).length} later entr(y/ies) in ${LATER_DIRECTORY}/, all consistent`);
      return 0;
    }
    for (const laterProblem of laterProblems) console.error(`- ${laterProblem}`);
    return 1;
  }
  console.log(`usage: ${LATER_USAGE}`);
  return subcommandName ? 1 : 0;
}
