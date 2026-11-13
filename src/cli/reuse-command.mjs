// `ai1 reuse search "<keywords>"` and `ai1 reuse dismiss <slug> --keywords "<words>" "<why>"`: the
// deterministic half of the reuse feature (src/reuse/reuse-history.mjs). Only this repo's sessions.

import { findMainCheckout } from '../core/project-roots.mjs';
import { searchTerms, searchRepoSessions, searchProjectInventory, matchingDismissals, recordDismissal, formatSearchReport, DEFAULT_SEARCH_DAYS, REUSE_FILE } from '../reuse/reuse-history.mjs';

export const REUSE_USAGE = 'ai1 reuse search "<keywords>" [--days <n>] [--json] | ai1 reuse dismiss <slug> --keywords "<words>" "<why>"';

const OPTIONS_WITH_VALUE = new Set(['--days', '--keywords']);

function listPositionalArguments(commandArguments) {
  const positionalArguments = [];
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    if (OPTIONS_WITH_VALUE.has(commandArguments[argumentIndex])) argumentIndex += 1;
    else if (!commandArguments[argumentIndex].startsWith('--')) positionalArguments.push(commandArguments[argumentIndex]);
  }
  return positionalArguments;
}

// Prints the result and returns the exit code.
export function runReuseCommand(repoRoot, commandArguments, { readOption, environment = process.env, homeDirectory } = {}) {
  const [subcommandName, ...restArguments] = listPositionalArguments(commandArguments);
  const mainCheckout = findMainCheckout(repoRoot);
  if (subcommandName === 'search') {
    const terms = searchTerms(restArguments.join(' '));
    const days = Number(readOption('--days')) || DEFAULT_SEARCH_DAYS;
    const searchResult = {
      terms,
      days,
      sessionMatches: searchRepoSessions(mainCheckout, terms, { homeDirectory, currentSessionId: environment.CLAUDE_CODE_SESSION_ID, days }),
      inventoryMatches: searchProjectInventory(repoRoot, terms),
      dismissalMatches: matchingDismissals(repoRoot, terms),
    };
    console.log(commandArguments.includes('--json') ? JSON.stringify(searchResult, null, 2) : formatSearchReport(searchResult));
    return 0;
  }
  if (subcommandName === 'dismiss') {
    const [slug, reason] = restArguments;
    const keywords = readOption('--keywords');
    if (!slug || !reason || !searchTerms(keywords).length) {
      console.log(`usage: ${REUSE_USAGE}`);
      return 1;
    }
    recordDismissal(repoRoot, { slug, keywords, reason });
    console.log(`dismissed ${slug} in ${REUSE_FILE}; it will not be proposed again`);
    return 0;
  }
  console.log(`usage: ${REUSE_USAGE}`);
  return 1;
}
