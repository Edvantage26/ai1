// `ai1 okf ...`: the OKF toolkit's scripts (validate today; init and visualize join it), called by the
// okf skills and by hand. The logic lives in src/okf/; the okf-upkeep hook imports the same validator.

import { runOkfValidateCommand, OKF_VALIDATE_USAGE } from '../okf/okf-validate.mjs';

export const OKF_USAGE = OKF_VALIDATE_USAGE;

// Prints the result and returns the exit code.
export function runOkfCommand(commandArguments) {
  const [subcommandName, ...subcommandArguments] = commandArguments;
  if (subcommandName === 'validate') return runOkfValidateCommand(subcommandArguments);
  console.error(`usage: ${OKF_USAGE}`);
  return 2;
}
