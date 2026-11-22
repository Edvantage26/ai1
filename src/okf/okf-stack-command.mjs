// `ai1 okf stack ...`: the stack (src/okf/okf-stack.mjs) from the command line, called by
// /ai1:okf-interview-project and by hand. Every write to a stack file goes here.

import { findRepoRoot } from '../cli/setup-repo.mjs';
import { resolveBundleDirectory } from './okf-bundle.mjs';
import { addStackPiece, adoptStackPieces, buildStackCatalog, listProjectStackPieces, setStackPieceState, userStackPath } from './okf-stack.mjs';

export const OKF_STACK_USAGE = 'ai1 okf stack catalog [--json] | list [--json] | add --scope user|project --id <slug> --title "..." [--area "..."] [--applies "..."] [--setup "..."] [--check "..."] [--state integrated|pending|none] [--note "..."] | adopt <id>... | set <id> integrated|pending|none [--note "..."]';
const OPTIONS_WITH_VALUE = new Set(['--scope', '--id', '--title', '--area', '--applies', '--setup', '--check', '--state', '--note']);

function parseArguments(commandArguments) {
  const positionalArguments = [];
  const options = {};
  for (let argumentIndex = 0; argumentIndex < commandArguments.length; argumentIndex += 1) {
    const commandArgument = commandArguments[argumentIndex];
    if (OPTIONS_WITH_VALUE.has(commandArgument)) {
      options[commandArgument.slice(2)] = commandArguments[argumentIndex + 1] ?? '';
      argumentIndex += 1;
    } else if (commandArgument.startsWith('--')) {
      options[commandArgument.slice(2)] = true;
    } else {
      positionalArguments.push(commandArgument);
    }
  }
  return { positionalArguments, options };
}

function describePiece(piece) {
  const fieldText = ['area', 'applies', 'setup', 'check'].filter((fieldName) => piece[fieldName]).map((fieldName) => `${fieldName}: ${piece[fieldName]}`).join(' | ');
  const stateText = piece.state ? ` [${piece.state}${piece.note ? `: ${piece.note}` : ''}]` : '';
  const sourceText = piece.source ? ` (${piece.source})` : '';
  return `${piece.id}: ${piece.title}${stateText}${sourceText}${fieldText ? `\n    ${fieldText}` : ''}`;
}

// Prints the result and returns the exit code.
export function runOkfStackCommand(workingDirectory, commandArguments, { environment = process.env, homeDirectory, writeOutput = console.log, writeError = console.error } = {}) {
  const projectRoot = findRepoRoot(workingDirectory);
  const bundleDirectory = resolveBundleDirectory(projectRoot);
  const homeOptions = { environment, ...(homeDirectory ? { homeDirectory } : {}) };
  const { positionalArguments, options } = parseArguments(commandArguments);
  const [subcommandName, ...restArguments] = positionalArguments;
  const printJson = (value) => writeOutput(JSON.stringify(value, null, 2));
  try {
    if (subcommandName === 'catalog') {
      const catalog = buildStackCatalog(projectRoot, homeOptions);
      if (options.json) printJson(catalog);
      else if (!catalog.pieces.length) writeOutput(`no stack yet: add pieces with ai1 okf stack add --scope user (${userStackPath(homeOptions)})`);
      else writeOutput([...catalog.pieces.map(describePiece), ...catalog.shadowed.map((shadowedPiece) => `note: ${shadowedPiece.id} from ${shadowedPiece.source} is hidden by the one from ${shadowedPiece.by}`)].join('\n'));
      return 0;
    }
    if (subcommandName === 'list') {
      const projectPieces = listProjectStackPieces(bundleDirectory);
      if (options.json) printJson(projectPieces);
      else writeOutput(projectPieces.length ? projectPieces.map(describePiece).join('\n') : 'this project has no stack yet (ai1 okf stack adopt <id>... from ai1 okf stack catalog)');
      return 0;
    }
    if (subcommandName === 'add') {
      const writtenPath = addStackPiece({ scope: options.scope, bundleDirectory, piece: { id: options.id, title: options.title, area: options.area, applies: options.applies, setup: options.setup, check: options.check, state: options.state, note: options.note }, ...homeOptions });
      writeOutput(`${options.id}: added to ${writtenPath}`);
      return 0;
    }
    if (subcommandName === 'adopt') {
      if (!restArguments.length) throw new Error('adopt needs the ids of the catalog pieces to bring in');
      const { adopted, skipped } = adoptStackPieces(bundleDirectory, restArguments, buildStackCatalog(projectRoot, homeOptions));
      writeOutput([
        ...(adopted.length ? [`adopted as pending: ${adopted.join(', ')}`] : []),
        ...skipped.map((skippedPiece) => `skipped ${skippedPiece.id}: ${skippedPiece.why}`),
      ].join('\n'));
      return adopted.length || !skipped.length ? 0 : 1;
    }
    if (subcommandName === 'set') {
      const [pieceId, state] = restArguments;
      setStackPieceState(bundleDirectory, pieceId, state, { note: options.note });
      writeOutput(`${pieceId}: ${state}`);
      return 0;
    }
  } catch (commandError) {
    writeError(`ai1 okf stack: ${commandError.message}`);
    return 1;
  }
  writeError(`usage: ${OKF_STACK_USAGE}`);
  return 2;
}
