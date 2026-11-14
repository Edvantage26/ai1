// `ai1 okf ...`: the OKF toolkit's scripts (validate, init; visualize joins them), called by the
// okf skills and by hand. The logic lives in src/okf/; the okf-upkeep hook imports the same validator.

import { runOkfValidateCommand, OKF_VALIDATE_USAGE } from '../okf/okf-validate.mjs';
import { runOkfInitCommand, OKF_INIT_USAGE } from '../okf/okf-init.mjs';

export const OKF_USAGE = `${OKF_VALIDATE_USAGE} | ${OKF_INIT_USAGE}`;

// Prints the result and returns the exit code.
export function runOkfCommand(commandArguments) {
  const [subcommandName, ...subcommandArguments] = commandArguments;
  if (subcommandName === 'validate') return runOkfValidateCommand(subcommandArguments);
  if (subcommandName === 'init') return runOkfInitCommand(subcommandArguments);
  console.error(`usage: ${OKF_USAGE}`);
  return 2;
}
