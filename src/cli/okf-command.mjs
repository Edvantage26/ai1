// `ai1 okf ...`: the OKF toolkit's scripts (validate, init, visualize), called by the
// okf skills and by hand. The logic lives in src/okf/; the okf-upkeep hook imports the same validator.

import { runOkfValidateCommand, OKF_VALIDATE_USAGE } from '../okf/okf-validate.mjs';
import { runOkfInitCommand, OKF_INIT_USAGE } from '../okf/okf-init.mjs';
import { runOkfVisualizeCommand, OKF_VISUALIZE_USAGE } from '../okf/okf-visualize.mjs';

export const OKF_USAGE = `${OKF_VALIDATE_USAGE} | ${OKF_INIT_USAGE} | ${OKF_VISUALIZE_USAGE}`;

// Prints the result and returns the exit code.
export function runOkfCommand(commandArguments) {
  const [subcommandName, ...subcommandArguments] = commandArguments;
  if (subcommandName === 'validate') return runOkfValidateCommand(subcommandArguments);
  if (subcommandName === 'init') return runOkfInitCommand(subcommandArguments);
  if (subcommandName === 'visualize') return runOkfVisualizeCommand(subcommandArguments);
  console.error(`usage: ${OKF_USAGE}`);
  return 2;
}
