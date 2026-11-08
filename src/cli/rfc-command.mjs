// `jig rfc ...`: the only way RFC files get numbered, moved between statuses and indexed, so the
// agent never does it by hand. Reads the knowledge path and the okf feature from .claude/jig.json
// (defaults when the repo has none) to word the index and check bundle citations.

import { loadHarnessConfig } from '../core/config.mjs';
import { createRfc, setRfcStatus, writeRfcIndex, checkRfcs, listRfcs, resolveCitingBundle, resolveKnowledgePath, RFC_DIRECTORY } from '../rfc/rfc-documents.mjs';

export const RFC_USAGE = 'jig rfc new <slug> [--idea] [--title "<title>"] | jig rfc set <number> <status> [--by <number>] | jig rfc index | jig rfc check';

function loadRepoConfig(repoRoot) {
  const loadedConfig = loadHarnessConfig(repoRoot);
  return loadedConfig.status === 'ok' ? loadedConfig.config : { features: {}, knowledge: '.okf' };
}

// Prints the result and returns the exit code.
export function runRfcCommand(repoRoot, commandArguments, { readOption }) {
  const [subcommandName, firstArgument, secondArgument] = commandArguments;
  const config = loadRepoConfig(repoRoot);
  const knowledgePath = resolveKnowledgePath(config);
  if (subcommandName === 'new') {
    const { relativePath, indexPath } = createRfc(repoRoot, {
      slug: firstArgument, title: readOption('--title'), size: commandArguments.includes('--idea') ? 'idea' : 'full', knowledgePath,
    });
    console.log(`created ${relativePath}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'set') {
    if (!firstArgument || !secondArgument) throw new Error('usage: jig rfc set <number> <status> [--by <number>]');
    const { relativePath, indexPath } = setRfcStatus(repoRoot, firstArgument, secondArgument, { supersededBy: readOption('--by'), knowledgePath });
    console.log(`${relativePath}: status ${secondArgument}`);
    console.log(`updated ${indexPath}`);
    return 0;
  }
  if (subcommandName === 'index') {
    console.log(`wrote ${writeRfcIndex(repoRoot, knowledgePath)}`);
    return 0;
  }
  if (subcommandName === 'check') {
    const rfcProblems = checkRfcs(repoRoot, { knowledgePath, bundleDirectory: resolveCitingBundle(repoRoot, config) });
    if (!rfcProblems.length) {
      console.log(`jig: ${listRfcs(repoRoot).length} RFC(s) in ${RFC_DIRECTORY}/, all consistent`);
      return 0;
    }
    for (const rfcProblem of rfcProblems) console.error(`- ${rfcProblem}`);
    return 1;
  }
  console.log(`usage: ${RFC_USAGE}`);
  return subcommandName ? 1 : 0;
}
