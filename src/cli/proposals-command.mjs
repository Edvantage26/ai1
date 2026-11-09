// `ai1 proposals ...`: the only way proposal files get numbered, moved between statuses and indexed, so the
// agent never does it by hand. Reads the okf feature from .ai1/config.json (defaults when the repo
// has none) to word the index and check bundle citations.

import { loadHarnessConfig } from '../core/config.mjs';
import { createProposal, setProposalStatus, writeProposalIndex, checkProposals, listProposals, resolveCitingBundle, resolveKnowledgePath, PROPOSALS_DIRECTORY } from '../proposals/proposals-documents.mjs';

export const PROPOSALS_USAGE = 'ai1 proposals new <slug> [--idea] [--title "<title>"] | ai1 proposals set <number> <status> [--by <number>] | ai1 proposals index | ai1 proposals check';

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
export function runProposalCommand(repoRoot, commandArguments, { readOption }) {
  const [subcommandName, firstArgument, secondArgument] = listPositionalArguments(commandArguments);
  const config = loadRepoConfig(repoRoot);
  const knowledgePath = resolveKnowledgePath(config);
  if (subcommandName === 'new') {
    const { relativePath, indexPath } = createProposal(repoRoot, {
      slug: firstArgument, title: readOption('--title'), size: commandArguments.includes('--idea') ? 'idea' : 'full', knowledgePath,
    });
    console.log(`created ${relativePath}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'set') {
    if (!firstArgument || !secondArgument) throw new Error('usage: ai1 proposals set <number> <status> [--by <number>]');
    const { relativePath, indexPath } = setProposalStatus(repoRoot, firstArgument, secondArgument, { supersededBy: readOption('--by'), knowledgePath });
    console.log(`${relativePath}: status ${secondArgument}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'index') {
    console.log(`wrote ${writeProposalIndex(repoRoot, knowledgePath)}`);
    return 0;
  }
  if (subcommandName === 'check') {
    const proposalProblems = checkProposals(repoRoot, { knowledgePath, bundleDirectory: resolveCitingBundle(repoRoot, config) });
    if (!proposalProblems.length) {
      console.log(`ai1: ${listProposals(repoRoot).length} proposal(s) in ${PROPOSALS_DIRECTORY}/, all consistent`);
      return 0;
    }
    for (const proposalProblem of proposalProblems) console.error(`- ${proposalProblem}`);
    return 1;
  }
  console.log(`usage: ${PROPOSALS_USAGE}`);
  return subcommandName ? 1 : 0;
}
